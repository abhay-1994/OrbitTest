const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createInspectorServer } = require('./inspector');
const { renderReportLogo } = require('./report-logo');

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

    const Orbit = require('../orbit');
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
      }

      await pauseBeforeClose(orbit, result);
      await closeOrbit(orbit, result);
    }
  }

  const testEndedAt = new Date();
  result.endedAt = testEndedAt.toISOString();
  result.durationMs = testEndedAt.getTime() - testStartedAt.getTime();

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

function normalizeReportRetention(retention = {}) {
  return {
    keepLatest: retention.keepLatest !== false,
    passedRuns: normalizeInteger(retention.passedRuns, 10),
    failedRuns: normalizeInteger(retention.failedRuns, 30),
    maxAgeDays: normalizeInteger(retention.maxAgeDays, 30),
    autoCleanup: Boolean(retention.autoCleanup)
  };
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

function createSummaryReport(report, reportPaths) {
  return {
    tool: report.meta.tool,
    version: report.meta.version,
    runId: report.meta.runId,
    status: report.summary.status,
    startedAt: report.meta.startedAt,
    endedAt: report.meta.endedAt,
    durationMs: report.meta.durationMs,
    duration: formatDuration(report.meta.durationMs),
    shard: report.meta.shard,
    totalDiscoveredTests: report.meta.totalDiscoveredTests,
    selectedTests: report.meta.selectedTests,
    summary: report.summary,
    reportPaths,
    failures: report.results
      .filter(result => result.status === 'failed')
      .map(result => createCompactResult(result)),
    flaky: report.results
      .filter(result => result.status === 'flaky')
      .map(result => createCompactResult(result)),
    skipped: report.results
      .filter(result => result.status === 'skipped')
      .map(result => createCompactResult(result))
  };
}

function createCompactResult(result) {
  return {
    name: result.name,
    file: result.file,
    status: result.status,
    durationMs: result.durationMs,
    attempts: result.attempts,
    message: result.error?.message || result.skipReason || null,
    location: result.error?.location || null,
    artifacts: result.artifacts || {}
  };
}

function renderJunitReport(report) {
  const tests = report.summary.total;
  const failures = report.summary.failed;
  const skipped = report.summary.skipped;
  const time = toJUnitSeconds(report.meta.durationMs);
  const cases = report.results.map(result => renderJunitTestCase(result)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="${tests}" failures="${failures}" skipped="${skipped}" time="${time}">
  <testsuite name="OrbitTest" tests="${tests}" failures="${failures}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(report.meta.startedAt)}">
${cases}
  </testsuite>
</testsuites>
`;
}

function renderJunitTestCase(result) {
  const classname = escapeXml(toProjectRelativePath(result.file || 'unknown').replace(/\\/g, '/'));
  const name = escapeXml(result.name);
  const time = toJUnitSeconds(result.durationMs);
  const body = [];

  if (result.status === 'failed') {
    const error = result.error || {};
    body.push(`    <failure message="${escapeXml(error.message || 'Test failed')}" type="${escapeXml(error.name || 'Error')}">${escapeXml(error.stack || error.message || 'Test failed')}</failure>`);
  }

  if (result.status === 'skipped') {
    body.push(`    <skipped message="${escapeXml(result.skipReason || 'Skipped')}"/>`);
  }

  if (result.status === 'flaky') {
    body.push(`    <system-out>${escapeXml(renderFlakySystemOut(result))}</system-out>`);
  }

  if (body.length === 0) {
    return `    <testcase classname="${classname}" name="${name}" time="${time}"/>`;
  }

  return `    <testcase classname="${classname}" name="${name}" time="${time}">
${body.join('\n')}
    </testcase>`;
}

function renderFlakySystemOut(result) {
  const failures = (result.previousErrors || [])
    .filter(Boolean)
    .map((error, index) => `Attempt ${index + 1}: ${error.message || 'failed'}`)
    .join('\n');

  return `FLAKY: passed after ${result.attempts} attempts.${failures ? `\n${failures}` : ''}`;
}

function toJUnitSeconds(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(3);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanReports({ reportsDir = path.join(process.cwd(), 'reports'), retention = {}, currentRunId = null, dryRun = false } = {}) {
  const resolvedReportsDir = path.resolve(reportsDir);
  const rules = normalizeReportRetention(retention);
  const entries = collectReportEntries(resolvedReportsDir);
  const now = Date.now();
  const maxAgeMs = rules.maxAgeDays > 0 ? rules.maxAgeDays * 24 * 60 * 60 * 1000 : 0;
  const latestRunId = rules.keepLatest ? readLatestReportRunId(resolvedReportsDir) : null;
  const protectedRunIds = new Set([currentRunId, latestRunId].filter(Boolean));
  const byStatus = {
    passed: [],
    failed: [],
    unknown: []
  };

  for (const entry of entries) {
    if (protectedRunIds.has(entry.runId)) {
      entry.keepReason = entry.runId === currentRunId ? 'current run' : 'latest report';
      continue;
    }

    byStatus[entry.status]?.push(entry);
  }

  for (const list of Object.values(byStatus)) {
    list.sort((a, b) => b.endedAtMs - a.endedAtMs);
  }

  markOverflowForDeletion(byStatus.passed, rules.passedRuns);
  markOverflowForDeletion(byStatus.failed, rules.failedRuns);
  markOverflowForDeletion(byStatus.unknown, Math.max(rules.passedRuns, rules.failedRuns));

  if (maxAgeMs > 0) {
    for (const entry of entries) {
      if (!entry.deleteReason && !entry.keepReason && now - entry.endedAtMs > maxAgeMs) {
        entry.deleteReason = `older than ${rules.maxAgeDays} days`;
      }
    }
  }

  const deleted = [];
  const kept = [];

  for (const entry of entries) {
    if (!entry.deleteReason) {
      kept.push(toCleanReportResult(entry));
      continue;
    }

    if (!dryRun) {
      removeReportEntry(entry, resolvedReportsDir);
    }

    deleted.push(toCleanReportResult(entry));
  }

  return {
    reportsDir: path.relative(process.cwd(), resolvedReportsDir) || '.',
    dryRun,
    deleted,
    kept
  };
}

function readLatestReportRunId(reportsDir) {
  const latestReport = readReportJson(path.join(reportsDir, 'latest.json'));
  const runId = latestReport?.meta?.runId;

  return typeof runId === 'string' && runId.trim() ? runId : null;
}

function collectReportEntries(reportsDir) {
  return [
    ...collectRunDirectoryEntries(reportsDir),
    ...collectLegacyRootReportEntries(reportsDir)
  ];
}

function collectRunDirectoryEntries(reportsDir) {
  const runsDir = path.join(reportsDir, 'runs');

  if (!fs.existsSync(runsDir)) {
    return [];
  }

  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const runDir = path.join(runsDir, entry.name);
      const reportJson = path.join(runDir, 'report.json');
      const report = readReportJson(reportJson);

      return createReportEntry({
        type: 'run',
        runId: entry.name,
        paths: [runDir],
        report,
        fallbackPath: runDir
      });
    });
}

function collectLegacyRootReportEntries(reportsDir) {
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const legacy = new Map();

  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})\.(html|json)$/);

    if (!match) {
      continue;
    }

    const runId = match[1];
    const current = legacy.get(runId) || [];
    current.push(path.join(reportsDir, entry.name));
    legacy.set(runId, current);
  }

  return Array.from(legacy.entries()).map(([runId, paths]) => {
    const jsonPath = paths.find(filePath => filePath.endsWith('.json'));
    const report = jsonPath ? readReportJson(jsonPath) : null;
    const legacyArtifactsDir = path.join(reportsDir, 'artifacts', runId);

    if (fs.existsSync(legacyArtifactsDir)) {
      paths.push(legacyArtifactsDir);
    }

    return createReportEntry({
      type: 'legacy',
      runId,
      paths,
      report,
      fallbackPath: paths[0]
    });
  });
}

function createReportEntry({ type, runId, paths, report, fallbackPath }) {
  const fallbackStat = safeStat(fallbackPath);
  const endedAt = report?.meta?.endedAt || report?.meta?.startedAt || null;
  const endedAtMs = endedAt ? Date.parse(endedAt) : fallbackStat?.mtimeMs || 0;

  return {
    type,
    runId,
    paths,
    status: report?.summary?.status || 'unknown',
    endedAt: endedAt || (fallbackStat ? fallbackStat.mtime.toISOString() : null),
    endedAtMs: Number.isFinite(endedAtMs) && endedAtMs > 0 ? endedAtMs : 0,
    deleteReason: null,
    keepReason: null
  };
}

function readReportJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

function markOverflowForDeletion(entries, keepCount) {
  const keep = Math.max(0, keepCount);

  entries.forEach((entry, index) => {
    if (index >= keep) {
      entry.deleteReason = `exceeds last ${keep} ${entry.status} run${keep === 1 ? '' : 's'}`;
    }
  });
}

function removeReportEntry(entry, reportsDir) {
  for (const filePath of entry.paths) {
    const resolved = path.resolve(filePath);

    if (!isInsideDirectory(resolved, reportsDir)) {
      continue;
    }

    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function isInsideDirectory(target, parent) {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function toCleanReportResult(entry) {
  return {
    runId: entry.runId,
    type: entry.type,
    status: entry.status,
    endedAt: entry.endedAt,
    reason: entry.deleteReason || entry.keepReason || 'kept',
    paths: entry.paths.map(filePath => path.relative(process.cwd(), filePath))
  };
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

function printCiAnnotations(report, options = {}) {
  if (!options.ci?.enabled || !options.ci.githubAnnotations) {
    return;
  }

  for (const result of report.results) {
    if (result.status === 'failed') {
      const location = result.error?.location || {};
      const props = {
        file: toCiFilePath(location.file || result.file || 'unknown'),
        line: location.line || 1,
        col: location.column || 1
      };
      const message = `${result.name}: ${result.error?.message || 'Test failed'}`;
      console.log(`::error ${formatGithubAnnotationProps(props)}::${escapeGithubAnnotation(message)}`);
    }

    if (result.status === 'flaky') {
      const props = {
        file: toCiFilePath(result.file || 'unknown'),
        line: 1,
        col: 1
      };
      const message = `${result.name}: flaky test passed after ${result.attempts} attempts`;
      console.log(`::warning ${formatGithubAnnotationProps(props)}::${escapeGithubAnnotation(message)}`);
    }
  }
}

function formatGithubAnnotationProps(props) {
  return Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${escapeGithubAnnotationProperty(value)}`)
    .join(',');
}

function escapeGithubAnnotation(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function escapeGithubAnnotationProperty(value) {
  return escapeGithubAnnotation(value)
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
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

function buildFailureDiagnostics(result) {
  if (!result || !result.error) {
    return null;
  }

  const failedStep = result.trace?.failedStep || null;
  const lastStep = result.trace?.lastStep || null;
  const insight = createErrorInsight(result.error, failedStep || lastStep);
  const source = result.error.location || failedStep?.location || lastStep?.location || null;
  const smartInsight = createSmartReportInsight(result.smartReport);
  const page = failedStep || lastStep
    ? {
        url: (failedStep || lastStep).url || null,
        title: (failedStep || lastStep).title || null
      }
    : result.smartReport?.pageState
      ? {
          url: result.smartReport.pageState.url || null,
          title: result.smartReport.pageState.title || null
        }
    : null;

  return {
    title: smartInsight?.title || insight.title,
    summary: insight.summary,
    likelyCause: smartInsight
      ? `${smartInsight.likelyCause} ${insight.likelyCause}`
      : insight.likelyCause,
    nextActions: smartInsight
      ? unique([...smartInsight.nextActions, ...insight.nextActions])
      : insight.nextActions,
    failedStep,
    lastStep,
    source,
    page,
    smartInsight
  };
}

function createSmartReportInsight(smartReport) {
  if (!smartReport?.enabled) {
    return null;
  }

  const visibleErrorText = smartReport.pageState?.visibleErrorText || findKnownPageError(smartReport.pageState?.textSnippet);

  if (visibleErrorText) {
    return {
      title: 'Page showed an error message',
      likelyCause: `The page displayed this message after the action: ${visibleErrorText}.`,
      nextActions: [
        'Use the visible page message as the primary failure reason.',
        'Check the submitted credentials, form data, or validation rule for this flow.'
      ]
    };
  }

  const formPost = findRecentFormSubmission(smartReport.recentRequests);

  if (formPost && smartReport.pageState?.url && /\/auth\/login/i.test(smartReport.pageState.url)) {
    return {
      title: 'Login did not complete',
      likelyCause: `OrbitTest saw a form submission to ${formPost.url}, then the page stayed on the login screen.`,
      nextActions: [
        'Check whether the username/password are correct.',
        'Review Recent network activity in Smart Report Evidence for the login submission and redirect.',
        'Assert the visible login error message when testing negative login cases.'
      ]
    };
  }

  const pageError = smartReport.pageErrors?.[smartReport.pageErrors.length - 1];

  if (pageError) {
    return {
      title: 'Browser error detected',
      likelyCause: `A page JavaScript error happened during the run: ${pageError.message || pageError.text}.`,
      nextActions: [
        'Check the Smart Report Evidence section for the page error stack location.',
        'Fix or handle the browser-side error before trusting later assertions.'
      ]
    };
  }

  const failedRequest = smartReport.failedRequests?.[smartReport.failedRequests.length - 1];

  if (failedRequest) {
    return {
      title: 'Network failure detected',
      likelyCause: `A request failed during the run: ${failedRequest.method || 'GET'} ${failedRequest.url || 'unknown URL'} ${failedRequest.errorText || failedRequest.status || ''}.`.trim(),
      nextActions: [
        'Check whether this failed request powers the UI state the test expected.',
        'Confirm the test environment, credentials, and API availability.'
      ]
    };
  }

  const consoleError = smartReport.consoleErrors?.[smartReport.consoleErrors.length - 1];

  if (consoleError) {
    return {
      title: 'Console error detected',
      likelyCause: `The browser console reported an error: ${consoleError.text || consoleError.type}.`,
      nextActions: [
        'Review the console error in Smart Report Evidence.',
        'Check whether the console error appears before the failed assertion or action.'
      ]
    };
  }

  const slowRequest = smartReport.slowRequests?.[smartReport.slowRequests.length - 1];

  if (slowRequest) {
    return {
      title: 'Slow request detected',
      likelyCause: `A request took ${formatDuration(slowRequest.durationMs || 0)} during the run: ${slowRequest.method || 'GET'} ${slowRequest.url || 'unknown URL'}.`,
      nextActions: [
        'Check whether the UI was still waiting for this slow request.',
        'Prefer waiting for the visible final state before asserting.'
      ]
    };
  }

  return null;
}

function findKnownPageError(text) {
  const value = String(text || '');
  const patterns = [
    /invalid credentials/i,
    /invalid username/i,
    /invalid password/i,
    /required/i,
    /unauthorized/i,
    /access denied/i,
    /login failed/i
  ];
  const match = patterns.find(pattern => pattern.test(value));

  if (!match) {
    return null;
  }

  const lines = value
    .split(/[.\n|]/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines.find(line => match.test(line)) || match.source.replace(/\\/g, '');
}

function findRecentFormSubmission(requests = []) {
  return requests
    .slice()
    .reverse()
    .find(request => {
      const method = String(request.method || '').toUpperCase();
      const url = String(request.url || '');
      return ['POST', 'PUT', 'PATCH'].includes(method) &&
        /(login|auth|validate|session|token)/i.test(url);
    }) || null;
}

function createErrorInsight(error, step) {
  const message = String(error?.message || '');
  const stepName = String(step?.name || '');
  const combined = `${message} ${stepName}`.toLowerCase();

  if (error?.name === 'SmartReportError' || combined.includes('smart report detected application failure')) {
    return {
      title: 'Smart Report detected an application failure',
      summary: 'The test script finished, but Smart Report found browser evidence that the application failed during the run.',
      likelyCause: 'A browser-side error, visible error message, or failed network request occurred even though the test did not assert on it.',
      nextActions: [
        'Review Smart Report Evidence for the exact browser signal.',
        'Add an assertion for the expected successful state after the action.',
        'Fix the application/data issue or update the test to cover this as a negative scenario.'
      ]
    };
  }

  if (combined.includes('no clickable element') || combined.includes('click')) {
    return {
      title: 'Click target was not actionable',
      summary: 'The click step failed because OrbitTest could not find a visible, clickable point for the requested locator.',
      likelyCause: 'The element may be hidden, covered by another element, disabled, off-screen, or the locator text may not match the page exactly.',
      nextActions: [
        'Inspect the failure screenshot and verify that the button/link is visible.',
        'Use a more stable locator such as CSS, role, or attribute.',
        'Add waitFor/waitForText before clicking if the element appears after loading.'
      ]
    };
  }

  if (combined.includes('timed out') || combined.includes('timeout')) {
    return {
      title: 'Timeout reached',
      summary: 'OrbitTest waited for the expected condition, but the page did not reach it before the timeout.',
      likelyCause: 'The app may still be loading, the target text/selector may be different, or the previous action did not trigger the expected navigation/state change.',
      nextActions: [
        'Check the screenshot to confirm the current page state.',
        'Increase the specific wait timeout only if the page is genuinely slow.',
        'Prefer a stable locator or text that appears after the page is ready.'
      ]
    };
  }

  if (combined.includes('no visible element') || combined.includes('no element found') || combined.includes('not found')) {
    return {
      title: 'Element was not found',
      summary: 'OrbitTest could not resolve the locator to a visible element on the current page.',
      likelyCause: 'The selector may be wrong, the page may not have navigated yet, or the element may be rendered later by the app.',
      nextActions: [
        'Compare the locator with the screenshot and current URL.',
        'Use waitFor() or waitForText() before the action.',
        'Avoid exact text locators when the page text contains extra spaces.'
      ]
    };
  }

  if (combined.startsWith('expected') || combined.includes('expected ')) {
    return {
      title: 'Assertion failed',
      summary: 'The test ran, but the actual value did not match the expected assertion.',
      likelyCause: 'The app state is different from what the test expects, or the assertion is checking too early.',
      nextActions: [
        'Use the last screenshot and trace steps to identify the actual page state.',
        'Wait for the user-visible state before asserting.',
        'Check whether the expected value changed in the application.'
      ]
    };
  }

  if (combined.includes('navigation failed')) {
    return {
      title: 'Navigation failed',
      summary: 'The browser could not complete navigation to the requested URL.',
      likelyCause: 'The URL may be unavailable, blocked, redirected unexpectedly, or the network may be unstable.',
      nextActions: [
        'Open the URL manually or rerun after checking network availability.',
        'Confirm the application URL and environment configuration.',
        'Use trace to see whether the browser reached an intermediate page.'
      ]
    };
  }

  if (combined.includes('invalid css') || combined.includes('invalid xpath')) {
    return {
      title: 'Invalid locator syntax',
      summary: 'The locator could not be parsed by the browser.',
      likelyCause: 'The CSS selector or XPath expression contains invalid syntax.',
      nextActions: [
        'Validate the selector in browser developer tools.',
        'Keep XPath text matches exact, including spaces.',
        'Prefer CSS or role locators when possible.'
      ]
    };
  }

  if (combined.includes('chrome') || combined.includes('connection')) {
    return {
      title: 'Browser connection problem',
      summary: 'The browser or DevTools connection closed while the test was running.',
      likelyCause: 'The browser may have crashed, been closed, or become unreachable.',
      nextActions: [
        'Rerun the test to check whether the issue is reproducible.',
        'Close extra browser processes if the machine is under load.',
        'Use --trace to capture the last successful browser state.'
      ]
    };
  }

  return {
    title: 'Test failed',
    summary: 'OrbitTest captured the failure, screenshot, stack trace, and trace context available for this run.',
    likelyCause: 'Review the failed step, current URL, and screenshot to identify the first unexpected state.',
    nextActions: [
      'Start with the failed step and the screenshot.',
      'Check the source line shown in the report.',
      'Rerun with --step if you want to control the test live.'
    ]
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

function renderHtmlReport(report, reportsDir) {
  const statusClass = report.summary.status === 'passed' ? 'passed' : 'failed';
  const rows = report.results.map(result => {
    const error = result.error
      ? `<details><summary>${escapeHtml(result.error.message)}</summary><pre>${escapeHtml(result.error.stack)}</pre></details>`
      : '<span class="muted">None</span>';
    const screenshot = result.artifacts.screenshot
      ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}">View screenshot</a>`
      : '<span class="muted">None</span>';
    const trace = result.artifacts.trace
      ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.trace, reportsDir))}">Open trace</a>`
      : '<span class="muted">None</span>';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(result.name)}</strong>
          ${result.file ? `<div class="muted small">${escapeHtml(path.relative(process.cwd(), result.file))}</div>` : ''}
        </td>
        <td><span class="badge ${result.status}">${result.status}</span></td>
        <td>${formatDuration(result.durationMs)}</td>
        <td>${screenshot}</td>
        <td>${trace}</td>
        <td>${error}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitTest Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9e0e8;
      --pass: #127a43;
      --pass-bg: #e7f6ee;
      --fail: #b42318;
      --fail-bg: #fde8e7;
      --link: #175cd3;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }

    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 32px;
      letter-spacing: 0;
    }

    a {
      color: var(--link);
      font-weight: 700;
    }

    .muted {
      color: var(--muted);
    }

    .small {
      font-size: 12px;
      margin-top: 4px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 24px 0;
    }

    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }

    .metric strong {
      font-size: 26px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }

    th,
    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      background: #eef2f7;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 10px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
    }

    .badge.passed {
      color: var(--pass);
      background: var(--pass-bg);
    }

    .badge.failed {
      color: var(--fail);
      background: var(--fail-bg);
    }

    .status {
      color: ${statusClass === 'passed' ? 'var(--pass)' : 'var(--fail)'};
    }

    details summary {
      color: var(--fail);
      cursor: pointer;
      font-weight: 700;
    }

    pre {
      max-width: 620px;
      overflow: auto;
      white-space: pre-wrap;
      background: #101828;
      color: #f9fafb;
      border-radius: 8px;
      padding: 12px;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>OrbitTest Report</h1>
      <div class="muted">
        ${escapeHtml(report.meta.startedAt)} to ${escapeHtml(report.meta.endedAt)}
      </div>
    </header>

    <section class="summary">
      <div class="metric"><span>Status</span><strong class="status">${escapeHtml(report.summary.status.toUpperCase())}</strong></div>
      <div class="metric"><span>Total</span><strong>${report.summary.total}</strong></div>
      <div class="metric"><span>Passed</span><strong>${report.summary.passed}</strong></div>
      <div class="metric"><span>Failed</span><strong>${report.summary.failed}</strong></div>
      <div class="metric"><span>Duration</span><strong>${formatDuration(report.meta.durationMs)}</strong></div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Test</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Screenshot</th>
          <th>Trace</th>
          <th>Failure Reason</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" class="muted">No tests were registered.</td></tr>'}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

function renderEnhancedHtmlReport(report, reportsDir) {
  const statusClass = report.summary.status === 'passed' ? 'passed' : 'failed';
  const rows = report.results.map(result => renderEnhancedResultRow(result, reportsDir)).join('');
  const failureSection = renderEnhancedFailureSection(report, reportsDir);
  const smartReportSection = renderEnhancedSmartReportSection(report);
  const traceSection = renderEnhancedTraceSection(report, reportsDir);
  const summarySection = renderRunSummary(report);
  const allTestsSection = renderAllTestsSection(rows);
  const jsonSection = renderJsonReportTab(report, reportsDir);
  const interactionScript = renderReportInteractionsScript();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitTest Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-soft: #f9fbfd;
      --text: #111827;
      --muted: #64748b;
      --line: #d8e0ea;
      --pass: #087443;
      --pass-bg: #e6f6ed;
      --fail: #b42318;
      --fail-bg: #fde8e7;
      --warn: #9a6700;
      --warn-bg: #fff3c4;
      --info: #175cd3;
      --info-bg: #eaf1ff;
      --code: #101828;
      --shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }

    main {
      max-width: 1320px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    h1, h2, h3 { letter-spacing: 0; }
    h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.1; }
    h2 { margin: 0 0 16px; font-size: 22px; }
    h3 { margin: 0 0 10px; font-size: 16px; }

    a {
      color: var(--info);
      font-weight: 700;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }

    .topbar,
    .failure-head,
    .trace-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .topbar {
      align-items: center;
      padding: 18px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    .topbar > .run-meta {
      text-align: right;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .report-logo {
      width: 58px;
      height: 58px;
      flex: 0 0 58px;
      display: block;
    }

    .run-meta,
    .muted {
      color: var(--muted);
    }

    .run-meta {
      font-size: 13px;
    }

    .small {
      font-size: 12px;
      margin-top: 4px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 24px 0;
    }

    .metric,
    .panel,
    .failure {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
    }

    .metric {
      padding: 16px;
      position: relative;
      overflow: hidden;
    }

    .metric::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 3px;
      background: var(--info);
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }

    .metric strong {
      font-size: 26px;
      line-height: 1.1;
    }

    .dashboard {
      display: grid;
      gap: 18px;
      margin-top: 22px;
    }

    .dashboard > section {
      margin-top: 0;
    }

    .section-intro {
      margin: 0 0 14px;
      color: var(--muted);
      max-width: 820px;
    }

    .empty-state {
      padding: 22px;
      color: var(--muted);
      background: var(--panel);
      border: 1px dashed #b7c4d4;
      border-radius: 8px;
    }

    .json-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .json-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .button-link,
    .copy-json-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 12px;
      color: var(--info);
      background: #ffffff;
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
    }

    .button-link:hover,
    .copy-json-button:hover {
      background: var(--info-bg);
    }

    .json-view {
      max-height: 680px;
      white-space: pre;
      overflow: auto;
      line-height: 1.5;
      border: 1px solid #111827;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    }

    .report-map {
      position: relative;
      margin-top: 26px;
      padding: 20px;
      color: #e7f3ff;
      background:
        linear-gradient(135deg, rgba(8, 21, 40, 0.98), rgba(9, 43, 78, 0.98)),
        #06172d;
      border: 1px solid #1d5e99;
      border-radius: 8px;
      box-shadow: 0 18px 48px rgba(5, 17, 37, 0.24);
      overflow: hidden;
    }

    .report-map * {
      min-width: 0;
    }

    .report-map-title {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 18px;
    }

    .report-map-heading {
      min-width: 0;
    }

    .report-map-eyebrow {
      margin-bottom: 6px;
      color: #8cc8ff;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .report-map h2 {
      margin: 0;
      color: #f7fbff;
      font-size: 32px;
      line-height: 1.05;
    }

    .report-map-subhead {
      margin: 8px 0 0;
      max-width: 760px;
      color: #b8cee8;
      font-size: 14px;
    }

    .report-map-meta {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
      max-width: 460px;
    }

    .report-map-pill {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 10px;
      color: #dceeff;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(139, 198, 255, 0.26);
      border-radius: 8px;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .report-map-pill.passed {
      color: #9ff3be;
      border-color: rgba(111, 231, 151, 0.38);
      background: rgba(35, 148, 79, 0.18);
    }

    .report-map-pill.failed {
      color: #ffb5b5;
      border-color: rgba(255, 113, 113, 0.42);
      background: rgba(178, 32, 32, 0.2);
    }

    .report-feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(136px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }

    .report-feature {
      min-height: 108px;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 8px;
      padding: 12px 8px;
      color: #f7fbff;
      background: rgba(8, 28, 52, 0.88);
      border: 1px solid rgba(91, 161, 226, 0.34);
      border-radius: 8px;
      box-shadow: inset 0 0 18px rgba(74, 157, 255, 0.08), 0 10px 24px rgba(0, 0, 0, 0.12);
      text-align: center;
    }

    .report-feature.dim {
      color: #91a9c5;
      border-color: #24415e;
      background: rgba(8, 23, 41, 0.78);
    }

    .report-feature-symbol {
      width: 42px;
      height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #7be4ff;
      font-size: 24px;
      font-weight: 800;
      line-height: 1;
    }

    .report-feature.failure .report-feature-symbol,
    .report-feature.dim.failure .report-feature-symbol {
      color: #ff6767;
    }

    .report-feature-label {
      font-size: 13px;
      line-height: 1.12;
      font-weight: 800;
      text-transform: uppercase;
    }

    .report-map-grid {
      display: grid;
      grid-template-columns: 1.04fr 1.32fr 1.5fr;
      gap: 12px;
      align-items: stretch;
    }

    .map-panel {
      background: rgba(5, 20, 39, 0.92);
      border: 1px solid rgba(96, 160, 219, 0.32);
      border-radius: 8px;
      box-shadow: inset 0 0 0 1px rgba(125, 194, 255, 0.07);
      overflow: hidden;
    }

    .map-mini-report {
      padding: 12px;
    }

    .map-panel-title {
      margin-bottom: 9px;
      color: #ffffff;
      font-weight: 800;
      font-size: 14px;
    }

    .map-counts {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 800;
    }

    .map-counts span {
      padding: 5px 6px;
      border-radius: 6px;
      background: rgba(30, 57, 91, 0.72);
      text-align: center;
    }

    .map-count-pass { color: #49f285; }
    .map-count-fail { color: #ff5c5c; }
    .map-count-skip { color: #98a8bf; }

    .map-test-lines {
      display: grid;
      gap: 8px;
    }

    .map-test-line {
      display: grid;
      grid-template-columns: 18px 1fr 30px;
      gap: 8px;
      align-items: center;
    }

    .map-check {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 900;
      color: #06172d;
      background: #37e477;
    }

    .map-check.failed {
      color: #ffffff;
      background: #ff4e4e;
    }

    .map-line-bar {
      height: 5px;
      border-radius: 999px;
      background: #27425f;
      overflow: hidden;
    }

    .map-line-bar span {
      display: block;
      height: 100%;
      width: var(--map-width, 72%);
      background: #4a87d9;
    }

    .map-line-tail {
      height: 5px;
      border-radius: 999px;
      background: #2c4f78;
    }

    .map-browser {
      display: grid;
      grid-template-rows: 30px minmax(150px, 1fr);
    }

    .map-browser-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      color: #aac2dc;
      background: #12365c;
      font-size: 11px;
    }

    .map-browser-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #6f8baa;
    }

    .map-browser-url {
      margin-left: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .map-preview {
      min-height: 150px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #07182c;
    }

    .map-preview img {
      width: 100%;
      height: 100%;
      max-height: 210px;
      object-fit: cover;
      display: block;
    }

    .map-placeholder {
      padding: 18px;
      color: #8facce;
      font-weight: 700;
      text-align: center;
    }

    .map-code {
      padding: 12px 14px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      line-height: 1.55;
      background: #061326;
    }

    .map-code-row {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 10px;
      color: #b7c7dc;
    }

    .map-code-row.active {
      margin: 3px -6px;
      padding: 3px 6px;
      color: #ff7676;
      background: rgba(255, 76, 76, 0.18);
      border-radius: 4px;
    }

    .map-code-no {
      color: #7890ad;
      text-align: right;
    }

    .map-code-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .map-timeline-panel {
      margin-top: 12px;
      padding: 14px 18px;
    }

    .map-timeline {
      position: relative;
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 24px;
      padding: 0 8px;
    }

    .map-timeline::before {
      content: "";
      position: absolute;
      left: 8px;
      right: 8px;
      top: 50%;
      height: 4px;
      transform: translateY(-50%);
      border-radius: 999px;
      background: linear-gradient(90deg, #3f8cff, #46e37b);
    }

    .map-dot {
      position: relative;
      z-index: 1;
      width: 14px;
      height: 14px;
      border-radius: 999px;
      border: 2px solid #86b8ff;
      background: #3179ef;
      box-shadow: 0 0 0 2px #082746;
      flex: 0 0 auto;
    }

    .map-dot.passed {
      border-color: #55eca0;
      background: #24bb68;
    }

    .map-dot.failed {
      border-color: #ff7777;
      background: #e43232;
    }

    .map-dot.unknown,
    .map-dot.running {
      border-color: #ffce6c;
      background: #b98016;
    }

    .map-failed-step {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: #ffd7d7;
      font-weight: 800;
      font-size: 13px;
      white-space: nowrap;
    }

    .map-failed-step::before {
      content: "!";
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      color: #ffffff;
      background: #e43232;
      font-size: 11px;
      font-weight: 900;
    }

    .map-artifacts {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 0.8fr 1fr 1.25fr;
      align-items: center;
      border: 1px solid #1372c8;
      border-radius: 8px;
      overflow: hidden;
      background: rgba(3, 24, 48, 0.9);
    }

    .map-artifacts-title,
    .map-artifact-item {
      min-height: 50px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 18px;
      border-right: 1px solid #1372c8;
    }

    .map-artifact-item:last-child {
      border-right: 0;
    }

    .map-artifacts-title {
      justify-content: center;
      color: #3fa2ff;
      font-size: 20px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .map-folder {
      width: 27px;
      height: 20px;
      position: relative;
      display: inline-block;
      border: 2px solid #b9d8ff;
      border-radius: 3px;
      flex: 0 0 auto;
    }

    .map-folder::before {
      content: "";
      position: absolute;
      left: 2px;
      top: -7px;
      width: 11px;
      height: 7px;
      border: 2px solid #b9d8ff;
      border-bottom: 0;
      border-radius: 3px 3px 0 0;
      background: rgba(3, 24, 48, 0.9);
    }

    .map-artifact-item span {
      color: #c8dcf5;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-text {
      color: ${statusClass === 'passed' ? 'var(--pass)' : 'var(--fail)'};
    }

    section {
      margin-top: 24px;
    }

    .panel,
    .failure {
      padding: 18px;
    }

    .failure {
      border-left: 5px solid var(--fail);
      margin-bottom: 18px;
    }

    .failure-title {
      margin: 0;
      font-size: 20px;
    }

    .two-col {
      display: grid;
      grid-template-columns: minmax(0, 0.95fr) minmax(300px, 1.05fr);
      gap: 18px;
      align-items: start;
    }

    .stacked {
      display: grid;
      gap: 14px;
    }

    .evidence img {
      display: block;
      width: 100%;
      max-height: 520px;
      object-fit: contain;
      background: #eef2f7;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .error-message {
      margin: 8px 0 0;
      padding: 12px;
      background: var(--fail-bg);
      border: 1px solid #f3b8b3;
      border-radius: 8px;
      color: var(--fail);
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .hint-list {
      margin: 8px 0 0;
      padding-left: 20px;
    }

    .hint-list li {
      margin: 5px 0;
    }

    .fact-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
    }

    .fact {
      padding: 10px;
      background: var(--panel-soft);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
    }

    .fact span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }

    .fact strong {
      display: block;
      overflow-wrap: anywhere;
      font-size: 13px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
      white-space: nowrap;
    }

    .badge.passed { color: var(--pass); background: var(--pass-bg); }
    .badge.flaky { color: var(--warn); background: var(--warn-bg); }
    .badge.failed { color: var(--fail); background: var(--fail-bg); }
    .badge.skipped { color: var(--muted); background: #eef2f7; }
    .badge.running, .badge.unknown { color: var(--warn); background: var(--warn-bg); }

    .timeline {
      display: grid;
      gap: 8px;
    }

    .step {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }

    .step:last-child {
      border-bottom: 0;
    }

    .step-index {
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--info-bg);
      color: var(--info);
      font-weight: 700;
      font-size: 13px;
    }

    .step.failed .step-index {
      background: var(--fail-bg);
      color: var(--fail);
    }

    .step-name {
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .step-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
      overflow-wrap: anywhere;
    }

    .code-frame,
    pre {
      margin: 8px 0 0;
      max-width: 100%;
      overflow: auto;
      white-space: pre-wrap;
      background: var(--code);
      color: #f9fafb;
      border-radius: 8px;
      padding: 12px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
    }

    .code-frame {
      white-space: pre;
    }

    .code-line.active {
      color: #ffd166;
    }

    .evidence-list {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .evidence-item {
      padding: 10px;
      background: var(--panel-soft);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }

    .evidence-item strong {
      display: block;
      margin-bottom: 4px;
    }

    details {
      border-top: 1px solid var(--line);
      padding-top: 10px;
      margin-top: 10px;
    }

    details summary {
      color: var(--info);
      cursor: pointer;
      font-weight: 700;
    }

    .json-details {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
      margin-top: 0;
      padding-top: 0;
    }

    .json-details > summary {
      align-items: center;
      color: var(--text);
      display: flex;
      font-size: 14px;
      justify-content: space-between;
      min-height: 54px;
      padding: 0 18px;
    }

    .json-details > section {
      border-top: 1px solid var(--line);
      margin-top: 0;
      padding: 18px;
    }

    .json-details > section h2 {
      display: none;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
    }

    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      background: #eef2f7;
    }

    tbody tr:hover td {
      background: #f8fbff;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    @media (max-width: 860px) {
      main { padding: 22px 12px 36px; }
      .topbar, .failure-head, .trace-head { display: block; }
      .topbar > .run-meta { text-align: left; }
      .brand { margin-bottom: 12px; }
      .json-toolbar { display: block; }
      .json-actions { margin-top: 10px; }
      .two-col { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div class="brand">
        ${renderReportLogo()}
        <div>
          <h1>OrbitTest Report</h1>
          <div class="run-meta">${escapeHtml(report.meta.startedAt)} to ${escapeHtml(report.meta.endedAt)}</div>
        </div>
      </div>
      <div class="run-meta">
        Run ${escapeHtml(report.meta.runId)}<br>
        OrbitTest ${escapeHtml(report.meta.version)} | ${escapeHtml(report.meta.platform)} | ${escapeHtml(report.meta.node)}
      </div>
    </header>

    <div class="dashboard">
      ${summarySection}
      ${allTestsSection}
      ${failureSection || ''}
      ${traceSection || ''}
      ${smartReportSection || ''}
      <details class="json-details">
        <summary>JSON Report</summary>
        ${jsonSection}
      </details>
    </div>
  </main>
  ${interactionScript}
</body>
</html>`;
}

function renderRunSummary(report) {
  return `
    <section>
      <h2>Run Summary</h2>
      <p class="section-intro">A clear snapshot of the run status, duration, and result counts.</p>
      <div class="summary">
        <div class="metric"><span>Status</span><strong class="status-text">${escapeHtml(report.summary.status.toUpperCase())}</strong></div>
        <div class="metric"><span>Total</span><strong>${report.summary.total}</strong></div>
        <div class="metric"><span>Passed</span><strong>${report.summary.passed}</strong></div>
        <div class="metric"><span>Flaky</span><strong>${report.summary.flaky || 0}</strong></div>
        <div class="metric"><span>Failed</span><strong>${report.summary.failed}</strong></div>
        <div class="metric"><span>Skipped</span><strong>${report.summary.skipped || 0}</strong></div>
        <div class="metric"><span>Duration</span><strong>${formatDuration(report.meta.durationMs)}</strong></div>
      </div>
    </section>`;
}

function renderAllTestsSection(rows) {
  return `
    <section>
      <h2>All Tests</h2>
      <p class="section-intro">Every registered test is listed with status, duration, evidence, and failure reason when one exists.</p>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Evidence</th>
            <th>Failure Reason</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" class="muted">No tests were registered.</td></tr>'}
        </tbody>
      </table>
    </section>`;
}

function renderEmptyReportSection(title, message) {
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <div class="empty-state">${escapeHtml(message)}</div>
    </section>`;
}

function renderJsonReportTab(report, reportsDir) {
  const json = JSON.stringify(report, null, 2);
  const jsonHref = getReportJsonHref(report, reportsDir);
  const sizeKb = Math.max(1, Math.ceil(Buffer.byteLength(json, 'utf8') / 1024));

  return `
    <section>
      <h2>JSON Report</h2>
      <p class="section-intro">The same run data saved to disk is shown here for debugging, sharing, or plugging into another tool.</p>
      <div class="json-toolbar">
        <div>
          <strong>${escapeHtml(jsonHref)}</strong>
          <div class="muted small">${sizeKb} KB | ${report.results.length} test result${report.results.length === 1 ? '' : 's'}</div>
        </div>
        <div class="json-actions">
          <a class="button-link" href="${escapeHtml(jsonHref)}">Open raw JSON</a>
          <button class="copy-json-button" type="button" data-copy-json>Copy JSON</button>
        </div>
      </div>
      <pre class="json-view" data-json-report>${escapeHtml(json)}</pre>
    </section>`;
}

function getReportJsonHref(report, reportsDir) {
  const resolvedReportsDir = path.resolve(reportsDir);

  if (path.basename(resolvedReportsDir) === report.meta.runId) {
    return 'report.json';
  }

  return 'latest.json';
}

function renderReportInteractionsScript() {
  return `<script>
(() => {
  const copyButton = document.querySelector('[data-copy-json]');
  const jsonReport = document.querySelector('[data-json-report]');

  if (copyButton && jsonReport && navigator.clipboard) {
    copyButton.addEventListener('click', async () => {
      const originalText = copyButton.textContent;

      try {
        await navigator.clipboard.writeText(jsonReport.textContent);
        copyButton.textContent = 'Copied';
        setTimeout(() => {
          copyButton.textContent = originalText;
        }, 1200);
      } catch (error) {
        copyButton.textContent = 'Copy failed';
        setTimeout(() => {
          copyButton.textContent = originalText;
        }, 1400);
      }
    });
  }
})();
</script>`;
}

function renderReportVisualMap(report, reportsDir) {
  const results = report.results || [];
  const failedResults = results.filter(result => result.status === 'failed');
  const screenshotResult = results.find(result => result.artifacts?.screenshot) || failedResults[0] || results[0] || null;
  const codeFrameResult = results.find(result => result.error?.codeFrame?.length) || failedResults[0] || results[0] || null;
  const traceResult = results.find(result => result.trace?.steps?.length) || null;
  const hasSmartEvidence = results.some(result => result.smartReport?.enabled);
  const hasScreenshot = results.some(result => result.artifacts?.screenshot);
  const hasCodeFrame = results.some(result => result.error?.codeFrame?.length);
  const hasTrace = Boolean(traceResult);
  const skipped = Math.max(0, Number(report.summary.total || 0) - Number(report.summary.passed || 0) - Number(report.summary.failed || 0));
  const reportStatus = report.summary.status === 'passed' ? 'passed' : 'failed';
  const features = [
    { label: 'HTML Report', symbol: 'HTML', enabled: true },
    { label: 'JSON Report', symbol: '{ }', enabled: true },
    { label: 'Failure Diagnostics', symbol: '!', enabled: failedResults.length > 0, tone: 'failure' },
    { label: 'Screenshots', symbol: 'IMG', enabled: hasScreenshot },
    { label: 'Source Code Frame', symbol: '</>', enabled: hasCodeFrame },
    { label: 'Trace Timeline', symbol: '--o', enabled: hasTrace },
    { label: 'Smart Browser Evidence', symbol: 'AI', enabled: hasSmartEvidence }
  ];

  return `
    <section class="report-map" aria-label="Reporting system visual map">
      <div class="report-map-title">
        <div class="report-map-heading">
          <div class="report-map-eyebrow">OrbitTest Evidence Dashboard</div>
          <h2>Reporting System</h2>
          <p class="report-map-subhead">A single run view for status, failures, screenshots, source frames, traces, smart browser evidence, and raw JSON.</p>
        </div>
        <div class="report-map-meta">
          <span class="report-map-pill ${reportStatus}">Status ${escapeHtml(report.summary.status.toUpperCase())}</span>
          <span class="report-map-pill">${escapeHtml(report.summary.total)} Tests</span>
          <span class="report-map-pill">${escapeHtml(formatDuration(report.meta.durationMs))}</span>
          <span class="report-map-pill">${escapeHtml(report.meta.runId || 'run-id')}</span>
        </div>
      </div>

      <div class="report-feature-grid">
        ${features.map(feature => `
          <div class="report-feature ${feature.enabled ? '' : 'dim'} ${feature.tone || ''}">
            <div class="report-feature-symbol">${escapeHtml(feature.symbol)}</div>
            <div class="report-feature-label">${escapeHtml(feature.label)}</div>
          </div>
        `).join('')}
      </div>

      <div class="report-map-grid">
        ${renderVisualMiniReport(report, skipped)}
        ${renderVisualScreenshotPreview(screenshotResult, reportsDir)}
        ${renderVisualCodeFrame(codeFrameResult)}
      </div>

      ${renderVisualTraceLine(report, traceResult)}

      <div class="map-artifacts">
        <div class="map-artifacts-title">Artifacts</div>
        <div class="map-artifact-item"><span class="map-folder"></span><span>reports/latest</span></div>
        <div class="map-artifact-item"><span class="map-folder"></span><span>reports/runs/${escapeHtml(report.meta.runId || 'run-id')}</span></div>
      </div>
    </section>`;
}

function renderVisualMiniReport(report, skipped) {
  const results = (report.results || []).slice(0, 5);
  const lines = results.length
    ? results.map((result, index) => {
      const status = result.status || 'unknown';
      const width = 48 + ((index * 17) % 42);

      return `
        <div class="map-test-line" title="${escapeHtml(result.name)}">
          <span class="map-check ${escapeHtml(status)}">${status === 'failed' ? 'X' : 'OK'}</span>
          <span class="map-line-bar" style="--map-width: ${width}%;"><span></span></span>
          <span class="map-line-tail"></span>
        </div>`;
    }).join('')
    : '<div class="map-placeholder">No tests registered</div>';

  return `
    <div class="map-panel map-mini-report">
      <div class="map-panel-title">OrbitTest Report</div>
      <div class="map-counts">
        <span class="map-count-pass">${report.summary.passed} Passed</span>
        <span class="map-count-fail">${report.summary.failed} Failed</span>
        <span class="map-count-skip">${skipped} Skipped</span>
      </div>
      <div class="map-test-lines">${lines}</div>
    </div>`;
}

function renderVisualScreenshotPreview(result, reportsDir) {
  const pageUrl = result?.diagnostics?.page?.url ||
    result?.smartReport?.pageState?.url ||
    result?.trace?.steps?.find(step => step.url)?.url ||
    'https://example.com';
  const screenshot = result?.artifacts?.screenshot
    ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}"><img src="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}" alt="${escapeHtml(result.name || 'OrbitTest screenshot')}"></a>`
    : '<div class="map-placeholder">Screenshot preview appears here when a screenshot is captured.</div>';

  return `
    <div class="map-panel map-browser">
      <div class="map-browser-bar">
        <span class="map-browser-dot"></span>
        <span class="map-browser-dot"></span>
        <span class="map-browser-dot"></span>
        <span class="map-browser-url">${escapeHtml(pageUrl)}</span>
      </div>
      <div class="map-preview">${screenshot}</div>
    </div>`;
}

function renderVisualCodeFrame(result) {
  const codeFrame = result?.error?.codeFrame || [];
  const visibleFrame = getVisualCodeFrameRows(codeFrame, result);

  return `
    <div class="map-panel map-code-panel">
      <div class="map-code">
        ${visibleFrame.map(row => `
          <div class="map-code-row ${row.highlight ? 'active' : ''}">
            <span class="map-code-no">${escapeHtml(row.number)}</span>
            <span class="map-code-text">${escapeHtml(row.text)}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function getVisualCodeFrameRows(codeFrame, result) {
  if (codeFrame.length > 0) {
    const activeIndex = Math.max(0, codeFrame.findIndex(line => line.highlight));
    const start = Math.max(0, activeIndex - 2);
    return codeFrame.slice(start, start + 4).map(line => ({
      number: line.number || '',
      text: line.text || '',
      highlight: Boolean(line.highlight)
    }));
  }

  if (result?.error?.message) {
    return [
      { number: '1', text: 'await orbit.open(pageUrl);', highlight: false },
      { number: '2', text: 'await orbit.click(locator);', highlight: false },
      { number: '3', text: result.error.message, highlight: true },
      { number: '4', text: 'Review diagnostics below for the exact source.', highlight: false }
    ];
  }

  return [
    { number: '1', text: 'await orbit.open(pageUrl);', highlight: false },
    { number: '2', text: 'await orbit.click(locator);', highlight: false },
    { number: '3', text: 'expect(await orbit.exists(target)).toBe(true);', highlight: false },
    { number: '4', text: 'Source frame appears here on failures.', highlight: false }
  ];
}

function renderVisualTraceLine(report, traceResult) {
  const traceSteps = traceResult?.trace?.steps || [];
  const dots = traceSteps.length
    ? traceSteps.slice(0, 14).map(step => ({
      status: step.status || 'unknown',
      label: step.name || `Step ${step.index || ''}`
    }))
    : (report.results || []).slice(0, 14).map(result => ({
      status: result.status || 'unknown',
      label: result.name || 'Test'
    }));
  const failedLabel = traceSteps.find(step => step.status === 'failed')?.name ||
    (report.results || []).find(result => result.status === 'failed')?.name ||
    '';

  if (dots.length === 0) {
    return '';
  }

  return `
    <div class="map-panel map-timeline-panel">
      <div class="map-timeline">
        ${dots.map(dot => `<span class="map-dot ${escapeHtml(dot.status)}" title="${escapeHtml(dot.label)}"></span>`).join('')}
        ${failedLabel ? `<span class="map-failed-step" title="${escapeHtml(failedLabel)}">Failed Step</span>` : ''}
      </div>
    </div>`;
}

function renderEnhancedSmartReportSection(report) {
  const results = report.results.filter(result => result.smartReport?.enabled);

  if (results.length === 0) {
    return '';
  }

  return `
    <section>
      <h2>Smart Report Evidence</h2>
      <div class="panel stacked">
        ${results.map(result => `
          <div>
            <div class="trace-head">
              <div>
                <h3>${escapeHtml(result.name)}</h3>
                ${result.file ? `<div class="muted small">${escapeHtml(path.relative(process.cwd(), result.file))}</div>` : ''}
              </div>
              <span class="badge ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span>
            </div>
            ${renderSmartReportEvidence(result.smartReport, { compact: true })}
          </div>
        `).join('')}
      </div>
    </section>`;
}

function renderEnhancedResultRow(result, reportsDir) {
  const evidence = [
    result.artifacts.screenshot ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}">Screenshot</a>` : null,
    result.artifacts.trace ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.trace, reportsDir))}">Trace file</a>` : null,
    result.smartReport?.enabled ? '<span class="muted">Smart evidence</span>' : null
  ].filter(Boolean).join(' | ') || '<span class="muted">None</span>';
  const message = result.error
    ? `<span class="muted">${escapeHtml(result.error.name)}</span><br>${escapeHtml(result.error.message)}`
    : result.status === 'flaky'
      ? `<span class="muted">Recovered</span><br>Passed after ${escapeHtml(result.attempts)} attempts`
      : result.skipReason
        ? escapeHtml(result.skipReason)
        : '<span class="muted">None</span>';

  return `
    <tr>
      <td>
        <strong>${escapeHtml(result.name)}</strong>
        ${result.file ? `<div class="muted small">${escapeHtml(path.relative(process.cwd(), result.file))}</div>` : ''}
      </td>
      <td><span class="badge ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></td>
      <td>${formatDuration(result.durationMs)}</td>
      <td>${evidence}</td>
      <td>${message}</td>
    </tr>`;
}

function renderEnhancedFailureSection(report, reportsDir) {
  const failedResults = report.results.filter(result => result.status === 'failed');

  if (failedResults.length === 0) {
    return '';
  }

  return `
    <section>
      <h2>Failure Diagnostics</h2>
      ${failedResults.map(result => renderEnhancedFailureCard(result, reportsDir)).join('')}
    </section>`;
}

function renderEnhancedFailureCard(result, reportsDir) {
  const diagnostics = result.diagnostics || buildFailureDiagnostics(result);
  const source = diagnostics?.source || result.error?.location || null;
  const screenshot = result.artifacts.screenshot
    ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}"><img src="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}" alt="${escapeHtml(result.name)} failure screenshot"></a>`
    : result.artifacts.snapshot
      ? `<div class="muted">Screenshot capture was not available. Open the failure snapshot captured after the smart failure: <a href="${escapeHtml(toHrefForReport(result.artifacts.snapshot, reportsDir))}">Failure snapshot</a>${result.artifacts.screenshotError ? ` (${escapeHtml(result.artifacts.screenshotError)})` : ''}</div>`
    : `<div class="muted">No failure screenshot was captured.${result.artifacts.screenshotError ? ` ${escapeHtml(result.artifacts.screenshotError)}` : ''}</div>`;
  const sourceBlock = source
    ? `<div class="fact"><span>Source</span><strong>${escapeHtml(source.file)}:${source.line}:${source.column}</strong></div>`
    : '';
  const codeFrame = result.error?.codeFrame ? renderEnhancedCodeFrame(result.error.codeFrame) : '';
  const traceTimeline = result.trace ? renderEnhancedTraceTimeline(result, reportsDir, { limit: 12, showScreenshotLinks: true }) : '';
  const smartEvidence = renderSmartReportEvidence(result.smartReport);

  return `
    <article class="failure">
      <div class="failure-head">
        <div>
          <h3 class="failure-title">${escapeHtml(result.name)}</h3>
          ${result.file ? `<div class="muted small">${escapeHtml(path.relative(process.cwd(), result.file))}</div>` : ''}
        </div>
        <span class="badge failed">failed</span>
      </div>

      <div class="two-col">
        <div class="stacked">
          <div>
            <h3>${escapeHtml(diagnostics?.title || 'Failure captured')}</h3>
            <p class="muted">${escapeHtml(diagnostics?.summary || 'OrbitTest captured failure evidence for this test.')}</p>
            <div class="error-message">${escapeHtml(result.error?.message || 'Unknown error')}</div>
          </div>

          ${renderEnhancedFailureFacts(result, diagnostics)}

          <div>
            <h3>Likely Cause</h3>
            <p>${escapeHtml(diagnostics?.likelyCause || 'Review the screenshot, source line, and trace timeline to find the first unexpected state.')}</p>
            ${renderEnhancedNextActions(diagnostics)}
          </div>

          <div class="fact-grid">
            ${sourceBlock}
            ${diagnostics?.page?.url ? `<div class="fact"><span>Current URL</span><strong>${escapeHtml(diagnostics.page.url)}</strong></div>` : ''}
            ${diagnostics?.failedStep ? `<div class="fact"><span>Failed Step</span><strong>#${diagnostics.failedStep.index} ${escapeHtml(diagnostics.failedStep.name)}</strong></div>` : ''}
          </div>

          ${codeFrame}

          ${smartEvidence}

          <details>
            <summary>Full stack trace</summary>
            <pre>${escapeHtml(result.error?.stack || 'No stack trace available.')}</pre>
          </details>
        </div>

        <div class="stacked evidence">
          <div>
            <h3>Failure Screenshot</h3>
            ${screenshot}
          </div>
          ${traceTimeline ? `<div><h3>Trace In This Report</h3>${traceTimeline}</div>` : ''}
        </div>
      </div>
    </article>`;
}

function renderEnhancedFailureFacts(result, diagnostics) {
  const facts = [
    `<div class="fact"><span>Error Type</span><strong>${escapeHtml(result.error?.name || 'Error')}</strong></div>`,
    `<div class="fact"><span>Duration</span><strong>${formatDuration(result.durationMs)}</strong></div>`,
    `<div class="fact"><span>Attempts</span><strong>${result.attempts}</strong></div>`
  ];

  if (result.trace) {
    facts.push(`<div class="fact"><span>Trace Steps</span><strong>${result.trace.total} total, ${result.trace.failed} failed</strong></div>`);
  }

  if (diagnostics?.page?.title) {
    facts.push(`<div class="fact"><span>Page Title</span><strong>${escapeHtml(diagnostics.page.title)}</strong></div>`);
  }

  return `<div class="fact-grid">${facts.join('')}</div>`;
}

function renderFailureSnapshot(result) {
  const pageState = result.smartReport?.pageState || {};
  const failedRequests = result.smartReport?.failedRequests || [];
  const consoleErrors = result.smartReport?.consoleErrors || [];
  const dialogs = result.smartReport?.dialogs || [];
  const visibleMessage = pageState.visibleErrorText || findKnownPageError(pageState.textSnippet) || '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitTest Failure Snapshot</title>
  <style>
    body { margin: 0; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f5f7fb; }
    main { max-width: 980px; margin: 0 auto; display: grid; gap: 16px; }
    section { background: #fff; border: 1px solid #d8e0ea; border-radius: 8px; padding: 16px; }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #101828; color: #f9fafb; border-radius: 8px; padding: 12px; }
    .error { color: #b42318; font-weight: 700; }
    .muted { color: #64748b; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>OrbitTest Failure Snapshot</h1>
      <p class="muted">Captured after Smart Report detected the failure. A browser screenshot was not available.</p>
      <p><strong>Test:</strong> ${escapeHtml(result.name)}</p>
      <p><strong>Error:</strong> <span class="error">${escapeHtml(result.error?.message || 'Unknown error')}</span></p>
      ${pageState.url ? `<p><strong>URL:</strong> ${escapeHtml(pageState.url)}</p>` : ''}
      ${pageState.title ? `<p><strong>Title:</strong> ${escapeHtml(pageState.title)}</p>` : ''}
      ${visibleMessage ? `<p><strong>Visible message:</strong> ${escapeHtml(visibleMessage)}</p>` : ''}
      ${dialogs.length ? `<p><strong>Browser dialog:</strong> ${escapeHtml(dialogs[dialogs.length - 1].message || '')}</p>` : ''}
    </section>
    ${failedRequests.length ? `<section><h2>Failed Requests</h2>${failedRequests.map(request => `<pre>${escapeHtml(`${request.method || 'GET'} ${request.url || 'unknown URL'} -> ${request.status || request.errorText || 'error'}${request.responseBody ? `\n${request.responseBody}` : ''}`)}</pre>`).join('')}</section>` : ''}
    ${consoleErrors.length ? `<section><h2>Console Errors</h2>${consoleErrors.map(error => `<pre>${escapeHtml(error.text || '')}</pre>`).join('')}</section>` : ''}
    ${pageState.textSnippet ? `<section><h2>Page Text</h2><pre>${escapeHtml(pageState.textSnippet)}</pre></section>` : ''}
  </main>
</body>
</html>`;
}

function renderSmartReportEvidence(smartReport, options = {}) {
  if (!smartReport?.enabled) {
    return '';
  }

  const failedRequests = smartReport.failedRequests || [];
  const slowRequests = smartReport.slowRequests || [];
  const recentRequests = smartReport.recentRequests || [];
  const importantRequests = getImportantNetworkRequests(recentRequests);
  const consoleErrors = smartReport.consoleErrors || [];
  const pageErrors = smartReport.pageErrors || [];
  const dialogs = smartReport.dialogs || [];
  const navigations = smartReport.navigations || [];
  const setupErrors = smartReport.setupErrors || [];
  const hasDetails = failedRequests.length ||
    slowRequests.length ||
    recentRequests.length ||
    consoleErrors.length ||
    pageErrors.length ||
    dialogs.length ||
    navigations.length ||
    setupErrors.length;

  return `
    <div>
      ${options.compact ? '' : '<h3>Smart Report Evidence</h3>'}
      <div class="fact-grid">
        <div class="fact"><span>Console Errors</span><strong>${consoleErrors.length}</strong></div>
        <div class="fact"><span>Page Errors</span><strong>${pageErrors.length}</strong></div>
        <div class="fact"><span>Browser Dialogs</span><strong>${dialogs.length}</strong></div>
        <div class="fact"><span>Failed Requests</span><strong>${failedRequests.length}</strong></div>
        <div class="fact"><span>Slow Requests</span><strong>${slowRequests.length}</strong></div>
        <div class="fact"><span>Requests Captured</span><strong>${recentRequests.length}</strong></div>
        ${smartReport.pageState?.url ? `<div class="fact"><span>Current URL</span><strong>${escapeHtml(smartReport.pageState.url)}</strong></div>` : ''}
        ${smartReport.pageState?.visibleErrorText ? `<div class="fact"><span>Visible Page Message</span><strong>${escapeHtml(smartReport.pageState.visibleErrorText)}</strong></div>` : ''}
      </div>
      ${hasDetails ? `
        <details open>
          <summary>Browser evidence captured during the run</summary>
          ${renderSmartPageErrors(pageErrors)}
          ${renderSmartDialogs(dialogs)}
          ${renderSmartConsoleErrors(consoleErrors)}
          ${renderSmartRequests('Failed requests', failedRequests)}
          ${renderSmartRequests('Slow requests', slowRequests)}
          ${renderSmartRequests('Recent network activity', importantRequests.length ? importantRequests : recentRequests, { limit: 12 })}
          ${renderSmartNavigations(navigations)}
          ${renderSmartSetupErrors(setupErrors)}
        </details>
      ` : '<div class="muted small">No console, page, or network issues were captured.</div>'}
    </div>`;
}

function getImportantNetworkRequests(requests = []) {
  return requests.filter(request => {
    const method = String(request.method || 'GET').toUpperCase();
    const type = String(request.type || '').toLowerCase();
    const status = Number(request.status || 0);

    return method !== 'GET' ||
      request.failed ||
      status >= 400 ||
      ['document', 'xhr', 'fetch'].includes(type);
  });
}

function renderSmartPageErrors(errors) {
  if (!errors.length) {
    return '';
  }

  return `
    <h3>Page Errors</h3>
    <div class="evidence-list">
      ${errors.slice(-5).map(error => `
        <div class="evidence-item">
          <strong>${escapeHtml(error.text || 'Page error')}</strong>
          <div>${escapeHtml(error.message || '')}</div>
          ${renderSmartLocation(error.location)}
        </div>
      `).join('')}
    </div>`;
}

function renderSmartConsoleErrors(errors) {
  if (!errors.length) {
    return '';
  }

  return `
    <h3>Console Errors</h3>
    <div class="evidence-list">
      ${errors.slice(-8).map(error => `
        <div class="evidence-item">
          <strong>${escapeHtml(error.type || 'console')}</strong>
          <div>${escapeHtml(error.text || '')}</div>
          ${renderSmartLocation(error.location)}
        </div>
      `).join('')}
    </div>`;
}

function renderSmartDialogs(dialogs) {
  if (!dialogs.length) {
    return '';
  }

  return `
    <h3>Browser Dialogs</h3>
    <div class="evidence-list">
      ${dialogs.slice(-8).map(dialog => `
        <div class="evidence-item">
          <strong>${escapeHtml(dialog.type || 'dialog')}</strong>
          <div>${escapeHtml(dialog.message || '')}</div>
          <div class="muted small">
            ${dialog.url ? `${escapeHtml(dialog.url)} | ` : ''}
            ${dialog.handled ? `auto-closed for ${escapeHtml(dialog.handledBy || 'capture')}` : 'not handled'}
            ${dialog.handleError ? ` | ${escapeHtml(dialog.handleError)}` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderSmartRequests(title, requests, options = {}) {
  if (!requests.length) {
    return '';
  }

  const limit = options.limit || 8;

  return `
    <h3>${escapeHtml(title)}</h3>
    <div class="evidence-list">
      ${requests.slice(-limit).map(request => `
        <div class="evidence-item">
          <strong>${escapeHtml(`${request.method || 'GET'} ${request.status || request.errorText || ''}`.trim())}</strong>
          <div>${escapeHtml(request.url || 'Unknown URL')}</div>
          <div class="muted small">
            ${request.durationMs !== null && request.durationMs !== undefined ? `${formatDuration(request.durationMs)} | ` : ''}
            ${escapeHtml(request.errorText || request.statusText || request.type || '')}
            ${request.redirectedTo ? ` | redirected to ${escapeHtml(request.redirectedTo)}` : ''}
            ${request.pending ? ' | pending at test end' : ''}
          </div>
          ${request.responseBody ? `<pre>${escapeHtml(request.responseBody)}${request.responseBodyTruncated ? '\n...truncated' : ''}</pre>` : ''}
          ${request.responseBodyError ? `<div class="muted small">Response body was not available: ${escapeHtml(request.responseBodyError)}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
}

function renderSmartNavigations(navigations) {
  if (!navigations.length) {
    return '';
  }

  return `
    <h3>Recent Navigations</h3>
    <div class="evidence-list">
      ${navigations.slice(-5).map(navigation => `
        <div class="evidence-item">
          <strong>${escapeHtml(navigation.mimeType || 'navigation')}</strong>
          <div>${escapeHtml(navigation.url || '')}</div>
        </div>
      `).join('')}
    </div>`;
}

function renderSmartSetupErrors(errors) {
  if (!errors.length) {
    return '';
  }

  return `
    <h3>Smart Report Setup</h3>
    <div class="evidence-list">
      ${errors.map(error => `
        <div class="evidence-item">${escapeHtml(error.message || String(error))}</div>
      `).join('')}
    </div>`;
}

function renderSmartLocation(location) {
  if (!location) {
    return '';
  }

  const parts = [
    location.url,
    location.line ? `line ${location.line}` : null,
    location.column ? `column ${location.column}` : null
  ].filter(Boolean);

  return parts.length ? `<div class="muted small">${escapeHtml(parts.join(' | '))}</div>` : '';
}

function renderEnhancedNextActions(diagnostics) {
  const actions = diagnostics?.nextActions || [];

  if (actions.length === 0) {
    return '';
  }

  return `<ul class="hint-list">${actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>`;
}

function renderEnhancedCodeFrame(codeFrame) {
  return `
    <div>
      <h3>Source Frame</h3>
      <pre class="code-frame">${codeFrame.map(line => {
        const marker = line.highlight ? '>' : ' ';
        const number = String(line.number).padStart(4, ' ');
        const className = line.highlight ? 'code-line active' : 'code-line';
        return `<span class="${className}">${escapeHtml(`${marker} ${number} | ${line.text}`)}</span>`;
      }).join('\n')}</pre>
    </div>`;
}

function renderEnhancedTraceSection(report, reportsDir) {
  const tracedResults = report.results.filter(result => result.trace);

  if (tracedResults.length === 0) {
    return '';
  }

  return `
    <section>
      <h2>Trace Timeline</h2>
      <div class="panel">
        ${tracedResults.map(result => `
          <div class="trace-head">
            <div>
              <h3>${escapeHtml(result.name)}</h3>
              <div class="muted small">${result.trace.total} steps | ${result.trace.passed} passed | ${result.trace.failed} failed</div>
            </div>
            ${result.artifacts.trace ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.trace, reportsDir))}">Open full trace file</a>` : ''}
          </div>
          ${renderEnhancedTraceTimeline(result, reportsDir, { limit: 24, showScreenshotLinks: true })}
        `).join('')}
      </div>
    </section>`;
}

function renderEnhancedTraceTimeline(result, reportsDir, options = {}) {
  const steps = result.trace?.steps || [];
  const limit = options.limit || steps.length;
  const visibleSteps = steps.slice(0, limit);

  if (visibleSteps.length === 0) {
    return '<div class="muted">No trace steps were captured.</div>';
  }

  const remaining = steps.length - visibleSteps.length;

  return `
    <div class="timeline">
      ${visibleSteps.map(step => renderEnhancedTraceStep(result, step, reportsDir, options)).join('')}
      ${remaining > 0 ? `<div class="muted small">Showing ${visibleSteps.length} of ${steps.length} steps. Open the full trace file for every screenshot.</div>` : ''}
    </div>`;
}

function renderEnhancedTraceStep(result, step, reportsDir, options) {
  const relativeScreenshot = step.screenshot && result.artifacts.trace
    ? path.join(path.dirname(result.artifacts.trace), step.screenshot)
    : null;
  const screenshotLink = options.showScreenshotLinks && relativeScreenshot
    ? ` | <a href="${escapeHtml(toHrefForReport(relativeScreenshot, reportsDir))}">screenshot</a>`
    : step.screenshotError
      ? ` | screenshot unavailable: ${escapeHtml(step.screenshotError)}`
    : '';
  const error = step.error
    ? `<div class="error-message">${escapeHtml(step.error.message)}</div>`
    : '';
  const dialog = step.dialog
    ? `<div class="muted small"> | browser ${escapeHtml(step.dialog.type || 'dialog')}: ${escapeHtml(step.dialog.message || '')}${step.dialog.handled ? ' (auto-closed for screenshot)' : ''}</div>`
    : '';
  const location = step.location
    ? ` | ${escapeHtml(step.location.file || '')}:${escapeHtml(step.location.line || '')}`
    : '';

  return `
    <div class="step ${escapeHtml(step.status || 'unknown')}">
      <div class="step-index">${escapeHtml(step.index || '')}</div>
      <div>
        <div class="step-name">${escapeHtml(step.name || 'Unnamed step')}</div>
        <div class="step-meta">
          ${formatDuration(step.durationMs || 0)}
          ${step.url ? ` | ${escapeHtml(step.url)}` : ''}
          ${location}
          ${screenshotLink}
        </div>
        ${error}
        ${dialog}
      </div>
      <span class="badge ${escapeHtml(step.status || 'unknown')}">${escapeHtml(step.status || 'unknown')}</span>
    </div>`;
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

function toHref(filePath) {
  return filePath.replace(/\\/g, '/');
}

function toHrefForReport(filePath, reportsDir) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const relativeToReport = path.relative(reportsDir, absolutePath);

  return toHref(relativeToReport);
}

function toProjectRelativePath(filePath) {
  if (!filePath || filePath === 'unknown') {
    return 'unknown';
  }

  const resolved = path.resolve(filePath);
  const relative = path.relative(process.cwd(), resolved);

  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  return filePath;
}

function toCiFilePath(filePath) {
  return toProjectRelativePath(filePath).replace(/\\/g, '/');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  resetTests,
  getTests
};
