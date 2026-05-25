// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createInspectorServer } = require('./inspector');
const { renderReportLogo } = require('./report-logo');
const { createSummaryReport } = require('../core/reports/json');
const { renderJunitReport } = require('../core/reports/junit');
const { renderEnhancedHtmlReport } = require('../core/reports/html');
const {
  buildFailureDiagnostics,
  findKnownPageError
} = require('./failure-diagnostics');
const { cleanReports, normalizeReportRetention } = require('./report-cleanup');
const { printCiAnnotations } = require('./ci-annotations');

const tests = [];
const beforeAllHooks = [];
const afterAllHooks = [];
const beforeEachHooks = [];
const afterEachHooks = [];

function test(name, options, fn) {
  const testFn = typeof options === 'function' ? options : fn;
  const testOptions = typeof options === 'function' ? {} : options || {};

  if (typeof testFn !== 'function') {
    throw new Error(`Test "${name}" must include a function.`);
  }

  tests.push({
    name,
    fn: testFn,
    options: testOptions,
    file: process.env.ORBITTEST_LOADING_FILE || null
  });
}

function beforeEach(fn) {
  registerHook(beforeEachHooks, 'beforeEach', fn);
}

function afterEach(fn) {
  registerHook(afterEachHooks, 'afterEach', fn);
}

function beforeAll(fn) {
  registerHook(beforeAllHooks, 'beforeAll', fn);
}

function afterAll(fn) {
  registerHook(afterAllHooks, 'afterAll', fn);
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${formatValue(actual)} to be ${formatValue(expected)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${formatValue(actual)} to equal ${formatValue(expected)}`);
      }
    },
    toContain(expected) {
      if (!String(actual).includes(String(expected))) {
        throw new Error(`Expected ${formatValue(actual)} to contain ${formatValue(expected)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${formatValue(actual)} to be truthy`);
      }
    }
  };
}

function emitStudioEvent(type, payload) {
  if (process.env.ORBITTEST_STUDIO_EVENTS !== '1') return;
  try {
    process.stdout.write('__ORBIT_EV__:' + JSON.stringify({ type, ...payload }) + '\n');
  } catch (_) {}
}

async function run(options = {}) {
  if (process.env.ORBITTEST_COLLECT_ONLY === '1') {
    return;
  }

  return runRegisteredTests(options);
}

async function runRegisteredTests(options = {}) {
  const startedAt = new Date();
  const runId = createRunId(startedAt);
  const reportsDir = options.reportsDir || path.join(process.cwd(), 'reports');
  const runDir = path.join(reportsDir, 'runs', runId);
  const artifactsDir = path.join(runDir, 'artifacts');
  const workers = normalizeWorkers(options.workers || options.parallel, options.maxWorkers);
  const runOptions = normalizeRunOptions(options, workers);
  const testEntries = selectTestsForRun(tests, runOptions.shard);

  emitStudioEvent('run:plan', {
    runId,
    total: testEntries.length,
    tests: testEntries.map(entry => ({
      index: entry.originalIndex + 1,
      name: entry.test.name,
      file: entry.test.file || null
    }))
  });

  const runInfo = createRunInfo({
    runId,
    startedAt,
    reportsDir,
    testEntries,
    workers,
    runOptions,
    options
  });
  let inspector = null;

  if (runOptions.step) {
    inspector = await createInspectorServer({ runId });
    runOptions.inspector = inspector;
    console.log(`\nStep mode enabled. Orbit Inspector: ${inspector.url}`);
  }

  let results;

  try {
    let beforeAllError = null;

    try {
      await runAllHooks(beforeAllHooks, runInfo, runOptions.testTimeout, 'beforeAll');
    } catch (error) {
      beforeAllError = error;
    }

    try {
      if (beforeAllError) {
        results = createBeforeAllFailureResults(testEntries, beforeAllError);
      } else {
        results = runOptions.workers > 1
          ? await runTestsInParallel({ testEntries, artifactsDir, runOptions })
          : await runTestsInSeries({ testEntries, artifactsDir, runOptions });
      }
    } finally {
      runInfo.results = results || [];
      runInfo.status = getRunStatus(runInfo.results);
      runInfo.endedAt = new Date().toISOString();
      runInfo.durationMs = Date.parse(runInfo.endedAt) - Date.parse(runInfo.startedAt);

      try {
        await runAllHooks(afterAllHooks, runInfo, runOptions.testTimeout, 'afterAll');
      } catch (error) {
        const hookFailure = createGlobalHookFailureResult({
          hookName: 'afterAll',
          error,
          index: (results || []).length + 1
        });
        results = [...(results || []), hookFailure];
        runInfo.results = results;
        runInfo.status = getRunStatus(results);
      }
    }
  } finally {
    if (inspector) {
      inspector.finish('finished');
      await inspector.close();
    }
  }

  const endedAt = new Date();
  const report = buildReport({
    startedAt,
    endedAt,
    results,
    runId,
    testFiles: options.testFiles || unique(testEntries.map(entry => entry.test.file).filter(Boolean)),
    workers,
    retries: runOptions.retries,
    testTimeout: runOptions.testTimeout,
    ci: runOptions.ci,
    shard: runOptions.shard,
    browserDisplay: runOptions.browserDisplay,
    totalDiscoveredTests: tests.length,
    selectedTests: testEntries.length
  });

  const reportPaths = writeReports(report, reportsDir);

  if (runOptions.reportRetention.autoCleanup) {
    const cleanup = cleanReports({
      reportsDir,
      retention: runOptions.reportRetention,
      currentRunId: report.meta.runId
    });

    if (cleanup.deleted.length > 0) {
      logVerbose(runOptions, `Cleaned ${cleanup.deleted.length} old report item${cleanup.deleted.length === 1 ? '' : 's'}.`);
    }
  }

  if (report.summary.status !== 'passed') {
    process.exitCode = 1;
  }

  printSummary(report, reportPaths, runOptions);
  printCiAnnotations(report, runOptions);
  await openFailureReportIfNeeded(report, reportPaths, runOptions);

  emitStudioEvent('run:end', {
    runId,
    status: report.summary.status,
    passed: report.summary.passed,
    failed: report.summary.failed,
    flaky: report.summary.flaky || 0,
    total: report.summary.total,
    durationMs: report.meta.durationMs
  });

  return report;
}

async function runTestsInSeries({ testEntries, artifactsDir, runOptions }) {
  const results = new Array(testEntries.length);
  let failureCount = 0;
  let stopped = false;

  for (let index = 0; index < testEntries.length; index++) {
    const entry = testEntries[index];
    results[index] = await runOneTest(entry.test, entry.originalIndex, artifactsDir, runOptions);

    if (results[index].status === 'failed') {
      failureCount++;
    }

    if (shouldStopAfterFailures(failureCount, runOptions)) {
      stopped = true;
      markRemainingTestsSkipped(results, testEntries, index + 1, getFailureStopReason(runOptions));
      break;
    }
  }

  if (!stopped) {
    fillMissingResults(results, testEntries, getFailureStopReason(runOptions));
  }

  return results;
}

async function runTestsInParallel({ testEntries, artifactsDir, runOptions }) {
  const results = new Array(testEntries.length);
  let nextIndex = 0;
  let failureCount = 0;
  let stopScheduling = false;

  logVerbose(runOptions, `\nRunning ${testEntries.length} tests with ${runOptions.workers} workers`);

  async function worker() {
    while (nextIndex < testEntries.length) {
      if (stopScheduling) {
        return;
      }

      const index = nextIndex;
      nextIndex++;
      const entry = testEntries[index];
      results[index] = await runOneTest(entry.test, entry.originalIndex, artifactsDir, runOptions);

      if (results[index].status === 'failed') {
        failureCount++;

        if (shouldStopAfterFailures(failureCount, runOptions)) {
          stopScheduling = true;
        }
      }
    }
  }

  const workerCount = Math.min(runOptions.workers, testEntries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  fillMissingResults(results, testEntries, getFailureStopReason(runOptions));

  return results;
}

function selectTestsForRun(allTests, shard) {
  const entries = allTests.map((testItem, index) => ({
    test: testItem,
    originalIndex: index
  }));

  if (!shard) {
    return entries;
  }

  return entries.filter((entry, index) => index % shard.total === shard.current - 1);
}

function shouldStopAfterFailures(failureCount, runOptions) {
  if (failureCount <= 0) {
    return false;
  }

  if (runOptions.failFast) {
    return true;
  }

  return runOptions.maxFailures > 0 && failureCount >= runOptions.maxFailures;
}

function getFailureStopReason(runOptions) {
  if (runOptions.failFast) {
    return 'Skipped because fail-fast stopped the run after the first failure.';
  }

  if (runOptions.maxFailures > 0) {
    return `Skipped because max failures reached ${runOptions.maxFailures}.`;
  }

  return 'Skipped because the run stopped before this test was scheduled.';
}

function markRemainingTestsSkipped(results, testEntries, startIndex, reason) {
  for (let index = startIndex; index < testEntries.length; index++) {
    if (!results[index]) {
      results[index] = createSkippedResult(testEntries[index], reason);
    }
  }
}

function fillMissingResults(results, testEntries, reason) {
  for (let index = 0; index < testEntries.length; index++) {
    if (!results[index]) {
      results[index] = createSkippedResult(testEntries[index], reason);
    }
  }
}

function createSkippedResult(entry, reason) {
  const timestamp = new Date().toISOString();

  return {
    name: entry.test.name,
    file: entry.test.file,
    index: entry.originalIndex + 1,
    status: 'skipped',
    skipped: true,
    skipReason: reason,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    attempts: 0,
    error: null,
    artifacts: {},
    diagnostics: null,
    trace: null,
    smartReport: null
  };
}

function createRunInfo({ runId, startedAt, reportsDir, testEntries, workers, runOptions, options }) {
  return {
    runId,
    status: 'running',
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: 0,
    reportsDir,
    workers,
    retries: runOptions.retries,
    testTimeout: runOptions.testTimeout,
    browserDisplay: runOptions.browserDisplay,
    ci: runOptions.ci,
    shard: runOptions.shard,
    totalDiscoveredTests: tests.length,
    selectedTests: testEntries.length,
    testFiles: options.testFiles || unique(testEntries.map(entry => entry.test.file).filter(Boolean)),
    tests: testEntries.map(entry => ({
      name: entry.test.name,
      file: entry.test.file,
      index: entry.originalIndex + 1,
      options: entry.test.options || {}
    })),
    results: []
  };
}

function getRunStatus(results = []) {
  return results.some(result => result.status === 'failed') ? 'failed' : 'passed';
}

function createBeforeAllFailureResults(testEntries, error) {
  return testEntries.map(entry => createGlobalHookFailureResult({
    hookName: 'beforeAll',
    error,
    test: entry.test,
    index: entry.originalIndex + 1
  }));
}

function createGlobalHookFailureResult({ hookName, error, test = {}, index }) {
  const timestamp = new Date().toISOString();
  const serialized = serializeError(error);

  return {
    name: test.name || `${hookName} hook`,
    file: test.file || null,
    index,
    status: 'failed',
    globalHook: hookName,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    attempts: 0,
    flaky: false,
    previousErrors: [serialized],
    error: {
      ...serialized,
      message: `${hookName} failed: ${serialized.message}`
    },
    artifacts: {},
    diagnostics: {
      title: `${hookName} hook failed`,
      summary: `The ${hookName} hook failed before the run could complete normally.`,
      likelyCause: 'Shared framework setup or cleanup threw an error.',
      nextActions: [
        `Review the ${hookName} hook implementation.`,
        'Keep run-level hooks focused on shared setup and cleanup.',
        'Move test-specific actions into the test or beforeEach/afterEach.'
      ],
      failedStep: null,
      lastStep: null,
      source: serialized.location || null,
      page: null,
      smartInsight: null
    },
    trace: null,
    smartReport: null
  };
}

async function runOneTest(t, index, artifactsDir, runOptions) {
  logVerbose(runOptions, `\nRunning: ${t.name}`);
  emitStudioEvent('test:start', { index: index + 1, name: t.name, file: t.file || null });

  const testStartedAt = new Date();
  const retries = normalizeInteger(t.options.retries ?? runOptions.retries, 0);
  const testTimeout = runOptions.step
    ? 0
    : normalizeInteger(t.options.timeout ?? t.options.testTimeout ?? runOptions.testTimeout, runOptions.testTimeout);

  const result = {
    name: t.name,
    file: t.file,
    index: index + 1,
    status: 'passed',
    startedAt: testStartedAt.toISOString(),
    endedAt: null,
    durationMs: 0,
    attempts: 0,
    flaky: false,
    previousErrors: [],
    error: null,
    artifacts: {},
    diagnostics: null,
    trace: null,
    smartReport: null
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    result.attempts = attempt + 1;
    const attemptStartedAt = new Date();
    const testInfo = createTestInfo({
      test: t,
      index,
      attempt,
      retries,
      timeout: testTimeout,
      startedAt: attemptStartedAt,
      result
    });

    const Orbit = require('../core/orbit');
    const traceOptions = runOptions.trace
      ? createTraceOptions({ artifactsDir, index, test: t, attempt })
      : null;
    if (runOptions.inspector) {
      runOptions.inspector.setTest(t);
    }
    const orbit = new Orbit({
      actionTimeout: runOptions.actionTimeout,
      browserDisplay: runOptions.browserDisplay,
      trace: traceOptions,
      smartReport: createSmartReportOptions({ runOptions, artifactsDir, index, test: t, attempt }),
      studio: createStudioFrameOptions({ runOptions, artifactsDir, index, test: t, attempt }),
      debug: createDebugOptions(runOptions),
      verbose: runOptions.verbose
    });

    try {
      await orbit.launch();

      let testError = null;

      try {
        testInfo.phase = 'beforeEach';
        await runHooks(beforeEachHooks, orbit, testInfo, testTimeout, 'beforeEach');
      } catch (error) {
        testError = error;
      }

      if (!testError) {
        try {
          testInfo.phase = 'test';
          await withTimeout(t.fn(orbit, testInfo), testTimeout, `Test timed out after ${testTimeout}ms`);
        } catch (error) {
          testError = error;
        }
      }

      updateTestInfoAfterAttempt(testInfo, testError, attemptStartedAt);

      try {
        testInfo.phase = 'afterEach';
        await runHooks(afterEachHooks, orbit, testInfo, testTimeout, 'afterEach');
      } catch (error) {
        testInfo.afterEachError = serializeError(error);
        testError = testError || error;
      }

      if (testError) {
        updateTestInfoAfterAttempt(testInfo, testError, attemptStartedAt);
        throw testError;
      }

      await attachSmartReportEvidence({ orbit, result });
      const smartFailure = createSmartFailure(result.smartReport);

      if (smartFailure) {
        updateTestInfoAfterAttempt(testInfo, smartFailure, attemptStartedAt);
        throw smartFailure;
      }

      updateTestInfoAfterAttempt(testInfo, null, attemptStartedAt);
      result.status = 'passed';
      result.error = null;
      result.diagnostics = null;
      if (result.previousErrors.length > 0) {
        result.status = 'flaky';
        result.flaky = true;
        result.diagnostics = {
          title: 'Recovered after retry',
          summary: `This test passed on attempt ${attempt + 1} after ${result.previousErrors.length} failed attempt${result.previousErrors.length === 1 ? '' : 's'}.`,
          suggestions: [
            'Review the failed attempt trace for timing, locator, or application readiness signals.',
            'Keep the retry, but treat this as a stability issue until the first attempt passes consistently.'
          ]
        };
      }
      logVerbose(runOptions, `Passed: ${t.name}`);
      if (shouldAttachTraceArtifact(runOptions, 'passed')) {
        await attachTraceArtifact({ orbit, result, status: 'passed' });
      }
      await pauseBeforeClose(orbit, result);
      await closeOrbit(orbit, result);
      break;
    } catch (error) {
      updateTestInfoAfterAttempt(testInfo, error, attemptStartedAt);
      result.status = 'failed';
      result.error = serializeError(error);
      result.previousErrors[attempt] = result.error;

      if (attempt >= retries) {
        await attachTraceFailure({ orbit, error });
        await attachFailureScreenshot({ orbit, result, artifactsDir, index, runOptions });
        if (shouldAttachTraceArtifact(runOptions, 'failed')) {
          await attachTraceArtifact({ orbit, result, status: 'failed' });
        }
        await attachSmartReportEvidence({ orbit, result });
        await attachFailureSnapshot({ result, artifactsDir, index });
        result.diagnostics = buildFailureDiagnostics(result);
        logVerbose(runOptions, `Failed: ${t.name}`);
        logVerbose(runOptions, `Reason: ${result.error.message}`);
      } else {
        await attachTraceFailure({ orbit, error });
        if (shouldAttachTraceArtifact(runOptions, 'failed')) {
          await attachTraceArtifact({ orbit, result, status: 'failed' });
        }
        await attachSmartReportEvidence({ orbit, result });
        result.diagnostics = buildFailureDiagnostics(result);
        logVerbose(runOptions, `Retrying: ${t.name} (${attempt + 1}/${retries})`);
        logVerbose(runOptions, `Reason: ${result.error.message}`);
        emitStudioEvent('test:retry', {
          index: index + 1,
          name: t.name,
          attempt: attempt + 2,
          retries: retries + 1,
          error: { message: result.error.message }
        });
      }

      await pauseBeforeClose(orbit, result);
      await closeOrbit(orbit, result);
    }
  }

  const testEndedAt = new Date();
  result.endedAt = testEndedAt.toISOString();
  result.durationMs = testEndedAt.getTime() - testStartedAt.getTime();

  emitStudioEvent('test:end', {
    index: index + 1,
    name: t.name,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error ? {
      message: result.error.message,
      stack: result.error.stack || null
    } : null,
    artifacts: {
      screenshot: (result.artifacts && result.artifacts.screenshot) ? result.artifacts.screenshot : null,
      trace: (result.artifacts && result.artifacts.trace) ? result.artifacts.trace : null
    }
  });

  return result;
}

function createTestInfo({ test, index, attempt, retries, timeout, startedAt, result }) {
  return {
    name: test.name,
    file: test.file,
    index: index + 1,
    attempt: attempt + 1,
    retry: attempt,
    retries,
    timeout,
    status: 'running',
    phase: 'beforeEach',
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: 0,
    error: null,
    afterEachError: null,
    artifacts: result.artifacts,
    result
  };
}

function updateTestInfoAfterAttempt(testInfo, error, startedAt) {
  const endedAt = new Date();
  testInfo.endedAt = endedAt.toISOString();
  testInfo.durationMs = endedAt.getTime() - startedAt.getTime();
  testInfo.status = error ? 'failed' : 'passed';
  testInfo.error = error ? serializeError(error) : null;
}

async function runHooks(hooks, orbit, testInfo, timeoutMs, hookName = 'hook') {
  for (const hook of hooks) {
    await withTimeout(hook(orbit, testInfo), timeoutMs, `${hookName} hook timed out after ${timeoutMs}ms`);
  }
}

async function runAllHooks(hooks, runInfo, timeoutMs, hookName) {
  for (const hook of hooks) {
    await withTimeout(hook(runInfo), timeoutMs, `${hookName} hook timed out after ${timeoutMs}ms`);
  }
}

async function closeOrbit(orbit, result) {
  try {
    await orbit.close();
  } catch (error) {
    const closeError = serializeError(error);

    if (result.status !== 'failed') {
      result.status = 'failed';
      result.error = {
        name: closeError.name,
        message: `Browser cleanup failed: ${closeError.message}`,
        stack: closeError.stack
      };
    } else if (result.error) {
      result.error.message += `; Browser cleanup failed: ${closeError.message}`;
    }
  }
}

async function pauseBeforeClose(orbit, result) {
  if (!orbit || typeof orbit.pauseForDebugger !== 'function') {
    return;
  }

  const status = result.status === 'failed' ? 'failed' : 'passed';
  try {
    await orbit.pauseForDebugger(`Test ${status}. Press Enter to close the browser, or q then Enter to stop.`);
  } catch (error) {
    if (error.message !== 'Step run stopped by user') {
      throw error;
    }
  }
}

function normalizeRunOptions(options, workers) {
  const step = Boolean(options.step);
  const ci = normalizeCiRunOptions(options.ci);
  const traceMode = step
    ? 'on'
    : normalizeTraceMode(options.traceMode ?? (options.trace ? 'on' : ci.enabled ? ci.trace : 'off'), 'off');
  const screenshot = normalizeArtifactMode(options.screenshot ?? (ci.enabled ? ci.screenshot : 'on-failure'), 'on-failure');
  const browserDisplay = step
    ? 'show'
    : normalizeBrowserDisplay(options.browserDisplay, ci.enabled ? 'hide' : 'show');

  return {
    workers: step ? 1 : workers,
    retries: normalizeInteger(options.retries, 0),
    testTimeout: step ? 0 : normalizeInteger(options.testTimeout || options.timeout, 30000),
    actionTimeout: step ? 0 : normalizeInteger(options.actionTimeout, 0),
    trace: traceMode !== 'off',
    traceMode,
    screenshot,
    browserDisplay,
    studioFrames: Boolean(options.studioFrames || process.env.ORBITTEST_STUDIO_FRAMES === '1'),
    smartReport: Boolean(options.smartReport),
    smartReportSlowRequestMs: normalizeInteger(options.smartReportSlowRequestMs, 2000),
    verbose: Boolean(options.verbose),
    step,
    failFast: Boolean(options.failFast ?? ci.failFast),
    maxFailures: normalizeInteger(options.maxFailures ?? ci.maxFailures, 0),
    shard: normalizeShard(options.shard ?? ci.shard),
    ci,
    openReportOnFailure: normalizeOpenReportOnFailure(options.openReportOnFailure),
    reportRetention: normalizeReportRetention(options.reportRetention)
  };
}

function normalizeCiRunOptions(value = {}) {
  if (typeof value === 'boolean') {
    return {
      enabled: value,
      retries: 0,
      trace: 'on-failure',
      screenshot: 'on-failure',
      failFast: false,
      maxFailures: 0,
      shard: null,
      summary: true,
      junit: true,
      githubAnnotations: false
    };
  }

  const source = value && typeof value === 'object' ? value : {};

  return {
    enabled: Boolean(source.enabled),
    retries: normalizeInteger(source.retries, 0),
    trace: normalizeTraceMode(source.trace, 'on-failure'),
    screenshot: normalizeArtifactMode(source.screenshot, 'on-failure'),
    failFast: Boolean(source.failFast),
    maxFailures: normalizeInteger(source.maxFailures, 0),
    shard: normalizeShard(source.shard),
    summary: source.summary !== false,
    junit: source.junit !== false,
    githubAnnotations: Boolean(source.githubAnnotations)
  };
}

function normalizeTraceMode(value, fallback) {
  if (value === true) {
    return 'on';
  }

  if (value === false) {
    return 'off';
  }

  const mode = String(value || fallback || 'off').toLowerCase();

  return ['on', 'off', 'on-failure'].includes(mode) ? mode : fallback;
}

function normalizeArtifactMode(value, fallback) {
  if (value === true) {
    return 'on-failure';
  }

  if (value === false) {
    return 'off';
  }

  const mode = String(value || fallback || 'on-failure').toLowerCase();

  return ['off', 'on-failure'].includes(mode) ? mode : fallback;
}

function normalizeBrowserDisplay(value, fallback = 'show') {
  const display = String(value || fallback || 'show').toLowerCase();

  return display === 'hide' ? 'hide' : 'show';
}

function normalizeShard(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.current && value.total) {
    const current = normalizeInteger(value.current, 0);
    const total = normalizeInteger(value.total, 0);

    if (current >= 1 && total >= 1 && current <= total) {
      return { current, total, value: `${current}/${total}` };
    }
  }

  const match = String(value).trim().match(/^(\d+)\/(\d+)$/);

  if (!match) {
    return null;
  }

  const current = Number(match[1]);
  const total = Number(match[2]);

  if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < 1 || current > total) {
    return null;
  }

  return { current, total, value: `${current}/${total}` };
}

function normalizeOpenReportOnFailure(value = {}) {
  if (typeof value === 'boolean') {
    return {
      enabled: value,
      host: '127.0.0.1',
      port: 0,
      ttlMs: 30 * 60 * 1000,
      openBrowser: true
    };
  }

  const source = value && typeof value === 'object' ? value : {};

  return {
    enabled: Boolean(source.enabled),
    host: normalizeHost(source.host),
    port: normalizePort(source.port),
    ttlMs: normalizeInteger(source.ttlMs ?? source.timeoutMs, 30 * 60 * 1000),
    openBrowser: source.openBrowser !== false
  };
}

function normalizeHost(value) {
  const host = String(value || '127.0.0.1').trim();
  return host || '127.0.0.1';
}

function normalizePort(value) {
  const port = normalizeInteger(value, 0);

  if (port > 65535) {
    return 0;
  }

  return port;
}

function normalizeWorkers(value, maxWorkers) {
  if (value === true) {
    return Math.max(1, Math.min(osWorkerCount(), normalizeInteger(maxWorkers, 4)));
  }

  const workers = Number(value || 1);

  if (!Number.isFinite(workers) || workers < 1) {
    return 1;
  }

  return Math.min(Math.floor(workers), normalizeInteger(maxWorkers, 4));
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function osWorkerCount() {
  try {
    return Math.max(1, require('os').cpus().length);
  } catch (error) {
    return 1;
  }
}

function resetTests() {
  tests.length = 0;
  beforeAllHooks.length = 0;
  afterAllHooks.length = 0;
  beforeEachHooks.length = 0;
  afterEachHooks.length = 0;
}

function getTests() {
  return tests.slice();
}

async function attachTraceFailure({ orbit, error }) {
  if (!orbit || typeof orbit.recordTestFailure !== 'function') {
    return;
  }

  try {
    await orbit.recordTestFailure(error);
  } catch (recordError) {
    // The main failure should stay primary. Trace recording is best-effort evidence.
  }
}

async function attachFailureScreenshot({ orbit, result, artifactsDir, index, runOptions }) {
  if (runOptions?.screenshot === 'off') {
    return;
  }

  if (!orbit || typeof orbit.screenshot !== 'function') {
    return;
  }

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const screenshotPath = path.join(
      artifactsDir,
      `${String(index + 1).padStart(2, '0')}-${slugify(result.name)}.png`
    );

    await orbit.screenshot(screenshotPath, { timeoutMs: 5000 });
    result.artifacts.screenshot = path.relative(process.cwd(), screenshotPath);
  } catch (error) {
    result.artifacts.screenshotError = serializeError(error).message;
  }
}

async function attachFailureSnapshot({ result, artifactsDir, index }) {
  if (result.artifacts.screenshot || !result.smartReport?.enabled) {
    return;
  }

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const snapshotPath = path.join(
      artifactsDir,
      `${String(index + 1).padStart(2, '0')}-${slugify(result.name)}-snapshot.html`
    );

    fs.writeFileSync(snapshotPath, renderFailureSnapshot(result), 'utf8');
    result.artifacts.snapshot = path.relative(process.cwd(), snapshotPath);
  } catch (error) {
    result.artifacts.snapshotError = serializeError(error).message;
  }
}

async function attachTraceArtifact({ orbit, result, status }) {
  if (!orbit || typeof orbit.writeTrace !== 'function') {
    return;
  }

  try {
    const tracePaths = await orbit.writeTrace({ status, error: result.error });

    if (tracePaths) {
      result.artifacts.traces = result.artifacts.traces || [];
      result.artifacts.traces.push({
        status,
        html: path.relative(process.cwd(), tracePaths.html),
        json: path.relative(process.cwd(), tracePaths.json)
      });
      result.artifacts.trace = path.relative(process.cwd(), tracePaths.html);
      result.artifacts.traceJson = path.relative(process.cwd(), tracePaths.json);
      result.trace = readTraceSummary(tracePaths.json);
    }
  } catch (error) {
    result.artifacts.traceError = serializeError(error).message;
  }
}

function shouldAttachTraceArtifact(runOptions, status) {
  if (runOptions.traceMode === 'off') {
    return false;
  }

  if (runOptions.traceMode === 'on') {
    return true;
  }

  return status === 'failed';
}

async function attachSmartReportEvidence({ orbit, result }) {
  if (!orbit || typeof orbit.getSmartReportEvidence !== 'function') {
    return;
  }

  try {
    result.smartReport = await orbit.getSmartReportEvidence();
  } catch (error) {
    result.artifacts.smartReportError = serializeError(error).message;
  }
}

function createSmartFailure(smartReport) {
  if (!smartReport?.enabled) {
    return null;
  }

  const blockingSignals = getSmartFailureSignals(smartReport);

  if (blockingSignals.length === 0) {
    return null;
  }

  const message = `Smart Report detected application failure: ${blockingSignals[0].summary}`;
  const error = new Error(message);
  error.name = 'SmartReportError';
  error.smartSignals = blockingSignals;
  error.stack = `${error.name}: ${message}`;

  return error;
}

function getSmartFailureSignals(smartReport) {
  const signals = [];
  const visibleErrorText = smartReport.pageState?.visibleErrorText || findKnownPageError(smartReport.pageState?.textSnippet);

  if (visibleErrorText && isBlockingVisibleMessage(visibleErrorText)) {
    signals.push({
      type: 'visible-message',
      summary: visibleErrorText
    });
  }

  for (const dialog of smartReport.dialogs || []) {
    if (!isBlockingVisibleMessage(dialog.message)) {
      continue;
    }

    signals.push({
      type: 'browser-dialog',
      summary: `Browser ${dialog.type || 'dialog'}: ${dialog.message || 'Application dialog'}`
    });
  }

  for (const request of smartReport.failedRequests || []) {
    if (!isBlockingFailedRequest(request)) {
      continue;
    }

    const responseText = request.responseBody ? ` - ${request.responseBody}` : '';
    signals.push({
      type: 'failed-request',
      summary: `${request.method || 'GET'} ${request.url || 'unknown URL'} returned ${request.status || request.errorText || 'an error'}${responseText}`
    });
  }

  for (const error of smartReport.pageErrors || []) {
    signals.push({
      type: 'page-error',
      summary: error.message || error.text || 'Page JavaScript error'
    });
  }

  for (const error of smartReport.consoleErrors || []) {
    if (!isBlockingConsoleError(error)) {
      continue;
    }

    signals.push({
      type: 'console-error',
      summary: error.text || 'Browser console error'
    });
  }

  return signals;
}

function isBlockingVisibleMessage(message) {
  return /(invalid|wrong|incorrect|unauthorized|forbidden|denied|failed|failure|error|required|not found|expired)/i.test(String(message || ''));
}

function isBlockingFailedRequest(request) {
  const status = Number(request.status || 0);
  const text = `${request.errorText || ''} ${request.responseBody || ''}`;

  if (status >= 400) {
    return true;
  }

  return /(invalid|wrong|incorrect|unauthorized|forbidden|denied|failed|failure|error)/i.test(text);
}

function isBlockingConsoleError(error) {
  const text = String(error?.text || '');

  return /(error|exception|syntaxerror|typeerror|referenceerror|is not valid json|failed|unauthorized|forbidden|invalid|wrong|incorrect)/i.test(text);
}

function createTraceOptions({ artifactsDir, index, test, attempt }) {
  const testSlug = slugify(test.name);
  const attemptSuffix = attempt > 0 ? `-attempt-${attempt + 1}` : '';

  return {
    enabled: true,
    dir: path.join(
      artifactsDir,
      'traces',
      `${String(index + 1).padStart(2, '0')}-${testSlug}${attemptSuffix}`
    ),
    testName: test.name,
    testFile: test.file,
    attempt: attempt + 1
  };
}

function createSmartReportOptions({ runOptions, artifactsDir, index, test, attempt }) {
  if (!runOptions.smartReport) {
    return null;
  }

  return {
    enabled: true,
    slowRequestMs: runOptions.smartReportSlowRequestMs
  };
}

function createStudioFrameOptions({ runOptions, artifactsDir, index, test, attempt }) {
  if (!runOptions.studioFrames) {
    return null;
  }

  const testSlug = slugify(test.name);
  const attemptSuffix = attempt > 0 ? `-attempt-${attempt + 1}` : '';

  return {
    enabled: true,
    captureFrames: true,
    dir: path.join(
      artifactsDir,
      'studio-frames',
      `${String(index + 1).padStart(2, '0')}-${testSlug}${attemptSuffix}`
    ),
    testIndex: index + 1,
    testName: test.name,
    testFile: test.file,
    attempt: attempt + 1,
    viewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1
    },
    emit: emitStudioEvent
  };
}

function createDebugOptions(runOptions) {
  if (!runOptions.step) {
    return null;
  }

  return {
    enabled: true,
    pauseBeforeActions: true,
    pauseBeforeClose: true,
    inspector: runOptions.inspector
  };
}

function buildReport({ startedAt, endedAt, results, runId, testFiles, workers, retries, testTimeout, ci, shard, browserDisplay, totalDiscoveredTests, selectedTests }) {
  const stablePassed = results.filter(result => result.status === 'passed').length;
  const flaky = results.filter(result => result.status === 'flaky').length;
  const passed = stablePassed + flaky;
  const failed = results.filter(result => result.status === 'failed').length;
  const skipped = results.filter(result => result.status === 'skipped').length;
  const total = results.length;

  return {
    meta: {
      tool: 'OrbitTest',
      version: getPackageVersion(),
      node: process.version,
      platform: process.platform,
      runId,
      testFiles,
      workers,
      retries,
      testTimeout,
      browserDisplay: browserDisplay || 'show',
      ci: ci?.enabled ? {
        enabled: true,
        trace: ci.trace,
        screenshot: ci.screenshot,
        failFast: ci.failFast,
        maxFailures: ci.maxFailures,
        summary: ci.summary,
        junit: ci.junit,
        githubAnnotations: ci.githubAnnotations
      } : { enabled: false },
      shard: shard ? shard.value : null,
      totalDiscoveredTests: normalizeInteger(totalDiscoveredTests, total),
      selectedTests: normalizeInteger(selectedTests, total),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime()
    },
    summary: {
      total,
      passed,
      stablePassed,
      flaky,
      failed,
      skipped,
      status: failed === 0 ? 'passed' : 'failed'
    },
    results
  };
}

function writeReports(report, reportsDir) {
  fs.mkdirSync(reportsDir, { recursive: true });

  const runDir = path.join(reportsDir, 'runs', report.meta.runId);
  fs.mkdirSync(runDir, { recursive: true });

  const jsonPath = path.join(runDir, 'report.json');
  const summaryPath = path.join(runDir, 'summary.json');
  const junitPath = path.join(runDir, 'junit.xml');
  const htmlPath = path.join(runDir, 'report.html');
  const latestJsonPath = path.join(reportsDir, 'latest.json');
  const latestSummaryPath = path.join(reportsDir, 'latest-summary.json');
  const latestJunitPath = path.join(reportsDir, 'latest-junit.xml');
  const latestHtmlPath = path.join(reportsDir, 'latest.html');
  const reportPaths = {
    json: path.relative(process.cwd(), jsonPath),
    summary: path.relative(process.cwd(), summaryPath),
    junit: path.relative(process.cwd(), junitPath),
    html: path.relative(process.cwd(), htmlPath),
    latestJson: path.relative(process.cwd(), latestJsonPath),
    latestSummary: path.relative(process.cwd(), latestSummaryPath),
    latestJunit: path.relative(process.cwd(), latestJunitPath),
    latestHtml: path.relative(process.cwd(), latestHtmlPath)
  };
  const summary = createSummaryReport(report, reportPaths);
  const junit = renderJunitReport(report);

  report.meta.reportPaths = reportPaths;
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestSummaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(junitPath, junit);
  fs.writeFileSync(latestJunitPath, junit);
  fs.writeFileSync(htmlPath, renderEnhancedHtmlReport(report, runDir));
  fs.writeFileSync(latestHtmlPath, renderEnhancedHtmlReport(report, reportsDir));

  return reportPaths;
}

function printSummary(report, reportPaths, options = {}) {
  const { summary, meta } = report;

  if (options.ci?.enabled) {
    console.log('\nOrbitTest CI Summary');
    console.log('--------------------');
    console.log(`Status: ${summary.status.toUpperCase()}`);
    console.log(`Total: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Flaky: ${summary.flaky || 0}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Skipped: ${summary.skipped || 0}`);
    console.log(`Duration: ${formatDuration(meta.durationMs)}`);

    if (meta.shard) {
      console.log(`Shard: ${meta.shard} (${meta.selectedTests}/${meta.totalDiscoveredTests} tests)`);
    }

    console.log(`Report: ${reportPaths.html}`);
    console.log(`Summary: ${reportPaths.summary}`);
    console.log(`JUnit: ${reportPaths.junit}`);

    if (summary.failed > 0) {
      console.log('\nFailures:');
      report.results
        .filter(result => result.status === 'failed')
        .forEach((result, index) => {
          const location = result.error?.location
            ? ` (${result.error.location.file}:${result.error.location.line}:${result.error.location.column})`
            : '';
          console.log(`${index + 1}. ${result.name}${location}`);
          console.log(`   ${result.error?.message || 'Test failed'}`);
        });
    }

    return;
  }

  if (!options.verbose) {
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Report: ${reportPaths.html}`);
    return;
  }

  console.log('\nOrbitTest Report');
  console.log('----------------');
  console.log(`Status: ${summary.status.toUpperCase()}`);
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Flaky: ${summary.flaky || 0}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Skipped: ${summary.skipped || 0}`);
  console.log(`Duration: ${formatDuration(meta.durationMs)}`);

  if (summary.total === 0) {
    console.log('\nNo tests were registered.');
  }

  if (summary.failed > 0) {
    console.log('\nFailures:');
    report.results
      .filter(result => result.status === 'failed')
      .forEach((result, index) => {
        console.log(`${index + 1}. ${result.name}`);
        console.log(`   Reason: ${result.error.message}`);

        if (result.diagnostics) {
          console.log(`   Insight: ${result.diagnostics.title}`);
        }

        if (result.artifacts.screenshot) {
          console.log(`   Screenshot: ${result.artifacts.screenshot}`);
        }

        if (result.artifacts.trace) {
          console.log(`   Trace: ${result.artifacts.trace}`);
        }
      });
  }

  const tracedResults = report.results.filter(result => result.artifacts.trace);

  if (tracedResults.length > 0) {
    console.log('\nTraces:');
    tracedResults.forEach((result, index) => {
      console.log(`${index + 1}. ${result.name}: ${result.artifacts.trace}`);
    });
  }

  console.log(`\nRun report: ${reportPaths.html}`);
  console.log(`\nHTML report: ${reportPaths.latestHtml}`);
  console.log(`JSON report: ${reportPaths.latestJson}`);
  console.log(`Summary report: ${reportPaths.latestSummary}`);
  console.log(`JUnit report: ${reportPaths.latestJunit}`);
}

async function openFailureReportIfNeeded(report, reportPaths, runOptions) {
  if (report.summary.status === 'passed' || !runOptions.openReportOnFailure.enabled) {
    return;
  }

  try {
    const server = await startReportServerProcess(reportPaths.html, runOptions.openReportOnFailure);

    if (runOptions.openReportOnFailure.openBrowser) {
      openUrlInDefaultBrowser(server.url);
    }

    console.log(`Failure report opened: ${server.url}`);
    console.log(`Report server auto-stops in ${formatDuration(runOptions.openReportOnFailure.ttlMs)}.`);
  } catch (error) {
    console.log(`Could not open failure report server: ${error.message || error}`);
  }
}

function startReportServerProcess(reportPath, options) {
  const absoluteReportPath = path.resolve(reportPath);
  const root = path.dirname(absoluteReportPath);
  const reportFile = path.basename(absoluteReportPath);
  const scriptPath = path.join(__dirname, 'report-server.js');
  const args = [
    scriptPath,
    '--root', root,
    '--file', reportFile,
    '--host', options.host,
    '--port', String(options.port),
    '--ttl', String(options.ttlMs)
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let settled = false;
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      finish(reject, new Error('Timed out starting report server.'));
    }, 5000);

    function finish(fn, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (child.stdout) {
        child.stdout.destroy();
      }

      if (child.stderr) {
        child.stderr.destroy();
      }

      if (fn === resolve) {
        child.unref();
      }

      fn(value);
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find(current => current.trim());

      if (!line) {
        return;
      }

      try {
        const message = JSON.parse(line);

        if (message.error) {
          finish(reject, new Error(message.error));
          return;
        }

        if (message.url) {
          finish(resolve, message);
        }
      } catch (error) {
        finish(reject, new Error(`Invalid report server response: ${line}`));
      }
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.once('error', error => {
      finish(reject, error);
    });

    child.once('exit', code => {
      if (!settled) {
        finish(reject, new Error(stderr.trim() || `Report server exited with code ${code}`));
      }
    });
  });
}

function openUrlInDefaultBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32'
    ? 'cmd'
    : platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });

  child.unref();
}

function logVerbose(options, ...args) {
  if (options.verbose) {
    console.log(...args);
  }
}

function serializeError(error) {
  if (error instanceof Error) {
    const location = parseUserStackLocation(error.stack || '');

    return {
      name: error.name,
      message: error.message,
      stack: error.stack || '',
      location,
      codeFrame: location ? readCodeFrame(location.absolutePath, location.line) : null
    };
  }

  return {
    name: 'Error',
    message: String(error),
    stack: '',
    location: null,
    codeFrame: null
  };
}

function parseUserStackLocation(stack) {
  const lines = String(stack || '').split(/\r?\n/).slice(1);
  const candidates = [];

  for (const line of lines) {
    const match = line.match(/(?:\(|\s)([A-Za-z]:\\.*?|\/.*?):(\d+):(\d+)\)?$/);

    if (!match) {
      continue;
    }

    const absolutePath = path.resolve(match[1]);
    const relativePath = path.relative(process.cwd(), absolutePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      continue;
    }

    const normalized = relativePath.replace(/\\/g, '/');

    candidates.push({
      absolutePath,
      file: relativePath,
      line: Number(match[2]),
      column: Number(match[3]),
      score: scoreStackLocation(normalized)
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (!best) {
    return null;
  }

  return {
    file: best.file,
    line: best.line,
    column: best.column,
    absolutePath: best.absolutePath
  };
}

function scoreStackLocation(relativePath) {
  if (relativePath.startsWith('tests/')) {
    return 100;
  }

  if (relativePath.includes('/node_modules/')) {
    return -100;
  }

  if (/^(runner|core|pages)\//.test(relativePath) || relativePath === 'orbit.js' || relativePath === 'cli.js') {
    return 10;
  }

  return 50;
}

function readCodeFrame(filePath, lineNumber) {
  try {
    const source = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const start = Math.max(1, lineNumber - 2);
    const end = Math.min(source.length, lineNumber + 2);
    const lines = [];

    for (let line = start; line <= end; line++) {
      lines.push({
        number: line,
        text: source[line - 1] || '',
        highlight: line === lineNumber
      });
    }

    return lines;
  } catch (error) {
    return null;
  }
}

function readTraceSummary(jsonPath) {
  try {
    const trace = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const steps = Array.isArray(trace.steps) ? trace.steps : [];
    const failedStep = steps.find(step => step.status === 'failed') || null;
    const lastStep = steps[steps.length - 1] || null;

    return {
      status: trace.meta?.status || 'unknown',
      total: steps.length,
      passed: steps.filter(step => step.status === 'passed').length,
      failed: steps.filter(step => step.status === 'failed').length,
      failedStep: compactTraceStep(failedStep),
      lastStep: compactTraceStep(lastStep),
      steps: steps.map(compactTraceStep).filter(Boolean)
    };
  } catch (error) {
    return null;
  }
}

function compactTraceStep(step) {
  if (!step) {
    return null;
  }

  return {
    index: step.index,
    name: step.name,
    status: step.status,
    durationMs: step.durationMs,
    url: step.url,
    title: step.title,
    screenshot: step.screenshot,
    screenshotError: step.screenshotError,
    dialog: step.dialog,
    location: step.location,
    error: step.error ? {
      name: step.error.name || 'Error',
      message: step.error.message || String(step.error)
    } : null
  };
}

function getPackageVersion() {
  try {
    const packageJson = require('../package.json');
    return packageJson.version;
  } catch (error) {
    return 'unknown';
  }
}

function createRunId(date) {
  const timestamp = date.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  const suffix = `${process.pid.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

  return `${timestamp}-${suffix}`;
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

function formatValue(value) {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'test';
}

function unique(values) {
  return Array.from(new Set(values));
}

function registerHook(hooks, name, fn) {
  if (typeof fn !== 'function') {
    throw new Error(`${name} must be a function.`);
  }

  hooks.push(fn);
}

function withTimeout(promise, timeoutMs, message) {
  if (!timeoutMs) {
    return promise;
  }

  let timeout = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

module.exports = {
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  run,
  runRegisteredTests,
  cleanReports,
  createSmartFailure,
  getSmartFailureSignals,
  resetTests,
  getTests
};
