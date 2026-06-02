// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9323;

function startStudioServer(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const config = loadProjectConfig(root);
  const host = normalizeHost(options.host || DEFAULT_HOST);
  const port = normalizePort(options.port ?? DEFAULT_PORT);
  const reportsDir = path.resolve(root, options.reportsDir || config.reportsDir || 'reports');
  const testDir = path.resolve(root, options.testDir || config.testDir || 'tests');
  const cliPath = path.join(__dirname, '..', 'cli.js');
  const state = {
    root,
    host,
    port,
    reportsDir,
    testDir,
    config,
    cliPath,
    activeRun: null,
    runHistory: [],
    sockets: new Set(),
    sseClients: new Set(),
    shuttingDown: false,
    shutdownReason: null,
    shutdownTimer: null,
    shutdown: null
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, state).catch(error => {
      sendJson(res, 500, {
        error: error.message || String(error)
      });
    });
  });
  state.shutdown = createStudioShutdown(server, state);

  server.on('connection', socket => {
    state.sockets.add(socket);
    socket.on('close', () => {
      state.sockets.delete(socket);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const url = `http://${host}:${address.port}/`;

      resolve({
        server,
        url,
        root,
        reportsDir,
        testDir,
        close: () => state.shutdown('programmatic close')
      });
    });
  });
}

async function handleRequest(req, res, state) {
  const requestUrl = new URL(req.url || '/', `http://${state.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (req.method === 'GET' && pathname === '/') {
    sendHtml(res, renderStudioHtml());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, buildStudioState(state));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(':\n\n');

    if (state.activeRun) {
      const liveTests = state.activeRun.liveTests
        ? [...state.activeRun.liveTests.values()]
        : [];
      if (liveTests.length > 0 || state.activeRun.liveTotal > 0 || (state.activeRun.frames || []).length > 0) {
        res.write('data: ' + JSON.stringify({
          type: 'snapshot',
          runId: state.activeRun.id,
          liveTests,
          liveTotal: state.activeRun.liveTotal || 0,
          frames: state.activeRun.frames || []
        }) + '\n\n');
      }
    }

    state.sseClients.add(res);
    req.on('close', () => state.sseClients.delete(res));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/run') {
    sendJson(res, 200, {
      activeRun: toPublicRun(state.activeRun),
      history: state.runHistory.slice(-10).map(toPublicRun)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/run') {
    const body = await readJsonBody(req);
    const run = startRun(state, body);
    sendJson(res, 202, { run: toPublicRun(run) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/run/stop') {
    const stopped = stopRun(state);
    sendJson(res, 200, { stopped, activeRun: toPublicRun(state.activeRun) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/ui/stop') {
    scheduleStudioShutdown(state, 'requested from OrbitTest UI');
    sendJson(res, 200, { stopping: true });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/file/')) {
    serveProjectFile(req, res, state, pathname.slice('/file/'.length));
    return;
  }

  sendText(res, 404, 'Not found');
}

function buildStudioState(state) {
  const reports = collectReports(state);
  const tests = collectTests(state);
  const totals = summarizeReports(reports);
  const insights = buildOrbitInsights(reports, tests);

  return {
    project: {
      name: path.basename(state.root),
      root: state.root,
      reportsDir: path.relative(state.root, state.reportsDir) || '.',
      testDir: path.relative(state.root, state.testDir) || '.'
    },
    config: {
      workers: state.config.workers || 1,
      retries: state.config.retries || 0,
      testTimeout: state.config.testTimeout || 30000,
      browserDisplay: state.config.browser?.display || 'auto',
      ci: state.config.ci || {}
    },
    totals,
    insights,
    tests,
    reports,
    activeRun: toPublicRun(state.activeRun),
    history: state.runHistory.slice(-10).map(toPublicRun),
    ui: {
      shuttingDown: state.shuttingDown,
      shutdownReason: state.shutdownReason
    }
  };
}

function startRun(state, body = {}) {
  if (state.activeRun && state.activeRun.status === 'running') {
    throw new Error('A test run is already in progress.');
  }

  const args = ['run'];
  const target = normalizeRunTarget(state, body.target);

  if (target) {
    args.push(target);
  }

  args.push('--no-open-report-on-failure');

  if (body.trace) args.push('--trace');
  if (body.smartReport) args.push('--smart-report');
  if (body.ci) args.push('--ci');
  args.push('--hide-browser');
  if (body.workers) args.push('--workers', String(body.workers));
  if (body.retries !== undefined && body.retries !== null && body.retries !== '') args.push('--retries', String(body.retries));

  const startedAt = new Date();
  const run = {
    id: createStudioRunId(startedAt),
    status: 'running',
    command: `orbittest ${args.join(' ')}`,
    args,
    target: target || 'all tests',
    startedAt: startedAt.toISOString(),
    endedAt: null,
    exitCode: null,
    output: '',
    error: null,
    process: null,
    liveTests: new Map(),
    liveTotal: 0,
    frames: [],
    lineBuffer: '',
    liveSummary: null
  };

  const child = spawn(process.execPath, [state.cliPath, ...args], {
    cwd: state.root,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ORBITTEST_UI_EVENTS: '1',
      ORBITTEST_UI_FRAMES: '1'
    },
    windowsHide: true
  });

  run.process = child;
  state.activeRun = run;
  state.runHistory.push(run);

  child.stdout.on('data', chunk => {
    processRunChunk(run, state, chunk);
  });

  child.stderr.on('data', chunk => {
    appendRunOutput(run, chunk.toString());
  });

  child.once('error', error => {
    run.status = 'failed';
    run.error = error.message || String(error);
    run.endedAt = new Date().toISOString();
  });

  child.once('exit', code => {
    run.exitCode = code;
    run.status = code === 0 ? 'passed' : 'failed';
    run.endedAt = new Date().toISOString();
    run.process = null;
  });

  return run;
}

function scheduleStudioShutdown(state, reason) {
  if (state.shutdownTimer) {
    return;
  }

  state.shuttingDown = true;
  state.shutdownReason = reason;
  state.shutdownTimer = setTimeout(() => {
    state.shutdown(reason).catch(() => {});
  }, 75);

  if (typeof state.shutdownTimer.unref === 'function') {
    state.shutdownTimer.unref();
  }
}

function createStudioShutdown(server, state) {
  let shutdownPromise = null;

  return function shutdownStudio(reason = 'shutdown') {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    state.shuttingDown = true;
    state.shutdownReason = reason;

    if (state.shutdownTimer) {
      clearTimeout(state.shutdownTimer);
      state.shutdownTimer = null;
    }

    stopRun(state);

    shutdownPromise = new Promise(resolve => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      try {
        server.close(finish);
      } catch (error) {
        finish();
      }

      const destroyTimer = setTimeout(() => {
        for (const socket of state.sockets) {
          socket.destroy();
        }
      }, 250);

      const fallbackTimer = setTimeout(finish, 2000);

      if (typeof destroyTimer.unref === 'function') {
        destroyTimer.unref();
      }

      if (typeof fallbackTimer.unref === 'function') {
        fallbackTimer.unref();
      }
    });

    return shutdownPromise;
  };
}

function stopRun(state) {
  const run = state.activeRun;

  if (!run || run.status !== 'running' || !run.process) {
    return false;
  }

  run.status = 'stopping';

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(run.process.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    run.process.kill('SIGTERM');
  }

  return true;
}

function processRunChunk(run, state, chunk) {
  run.lineBuffer = (run.lineBuffer || '') + chunk.toString();
  const newlinePos = run.lineBuffer.lastIndexOf('\n');
  if (newlinePos === -1) return;
  const complete = run.lineBuffer.slice(0, newlinePos + 1);
  run.lineBuffer = run.lineBuffer.slice(newlinePos + 1);
  const consoleLines = [];
  for (const line of complete.split('\n')) {
    if (line.startsWith('__ORBIT_EV__:')) {
      try {
        const payload = JSON.parse(line.slice(13));
        processLiveEvent(run, state, payload);
      } catch (_) {}
    } else {
      consoleLines.push(line);
    }
  }
  if (consoleLines.length) {
    appendRunOutput(run, consoleLines.join('\n'));
  }
}

function processLiveEvent(run, state, event) {
  if (!run.liveTests) run.liveTests = new Map();
  if (!run.frames) run.frames = [];

  const toRelUrl = p => {
    if (!p) return null;
    const rel = path.isAbsolute(p) ? path.relative(state.root, p) : p;
    if (!rel || rel.startsWith('..')) return null;
    return '/file/' + rel.replace(/\\/g, '/');
  };

  if (event.type === 'run:plan') {
    run.liveTotal = event.total || 0;
    run.liveTests.clear();
    run.frames = [];
    for (const t of (event.tests || [])) {
      run.liveTests.set(t.index, {
        index: t.index,
        name: t.name,
        file: t.file || null,
        status: 'queued',
        attempt: 0,
        durationMs: null,
        error: null,
        lastFrame: null,
        frameCount: 0
      });
    }
  } else if (event.type === 'test:start') {
    const existing = run.liveTests.get(event.index) || {};
    run.liveTests.set(event.index, {
      ...existing,
      index: event.index,
      name: event.name || existing.name,
      file: event.file || existing.file || null,
      status: 'running',
      attempt: event.attempt || 1,
      durationMs: null,
      error: null
    });
  } else if (event.type === 'test:end') {
    const existing = run.liveTests.get(event.index) || {};
    const artifacts = event.artifacts || {};
    run.liveTests.set(event.index, {
      ...existing,
      status: event.status || 'unknown',
      durationMs: event.durationMs || null,
      error: event.error || null,
      artifacts: {
        screenshot: toRelUrl(artifacts.screenshot),
        trace: toRelUrl(artifacts.trace)
      }
    });
  } else if (event.type === 'test:retry') {
    const existing = run.liveTests.get(event.index) || {};
    run.liveTests.set(event.index, {
      ...existing,
      status: 'running',
      attempt: event.attempt,
      retries: event.retries,
      durationMs: null,
      error: null
    });
  } else if (event.type === 'frame') {
    const frame = {
      index: event.index || run.frames.length + 1,
      testIndex: event.testIndex || null,
      testName: event.testName || null,
      file: event.file || null,
      attempt: event.attempt || 1,
      stepIndex: event.stepIndex || event.index || run.frames.length + 1,
      name: event.name || 'step',
      status: event.status || 'unknown',
      durationMs: event.durationMs || 0,
      startedAt: event.startedAt || null,
      endedAt: event.endedAt || null,
      url: event.url || null,
      title: event.title || null,
      viewport: event.viewport || null,
      location: event.location || null,
      error: event.error || null,
      screenshot: toRelUrl(event.screenshot),
      screenshotWidth: event.screenshotWidth || null,
      screenshotHeight: event.screenshotHeight || null,
      screenshotError: event.screenshotError || null
    };

    run.frames.push(frame);
    if (run.frames.length > 500) {
      run.frames.shift();
    }

    if (frame.testIndex) {
      const existing = run.liveTests.get(frame.testIndex) || {};
      run.liveTests.set(frame.testIndex, {
        ...existing,
        lastFrame: frame,
        frameCount: (existing.frameCount || 0) + 1
      });
    }

    broadcastLiveEvent(state, { type: 'frame', runId: run.id, frame });
    return;
  } else if (event.type === 'run:end') {
    run.liveSummary = {
      passed: event.passed || 0,
      failed: event.failed || 0,
      flaky: event.flaky || 0,
      total: event.total || run.liveTotal || 0,
      durationMs: event.durationMs || null
    };
  }

  broadcastLiveEvent(state, { ...event, runId: run.id });
}

function broadcastLiveEvent(state, event) {
  if (!state.sseClients || state.sseClients.size === 0) return;
  const data = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const client of state.sseClients) {
    try {
      client.write(data);
    } catch (_) {
      state.sseClients.delete(client);
    }
  }
}

function appendRunOutput(run, chunk) {
  run.output += typeof chunk === 'string' ? chunk : chunk.toString();

  if (run.output.length > 20000) {
    run.output = run.output.slice(-20000);
  }
}

function toPublicRun(run) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    status: run.status,
    command: run.command,
    target: run.target,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    output: run.output,
    error: run.error,
    liveTests: run.liveTests ? [...run.liveTests.values()] : null,
    liveTotal: run.liveTotal || 0,
    frames: run.frames || [],
    liveSummary: run.liveSummary || null
  };
}

function normalizeRunTarget(state, target) {
  if (!target || target === 'all') {
    return null;
  }

  const resolved = path.resolve(state.root, String(target));

  if (!isInsideDirectory(resolved, state.root)) {
    throw new Error('Run target must stay inside the project.');
  }

  return path.relative(state.root, resolved);
}

function collectReports(state) {
  const runsDir = path.join(state.reportsDir, 'runs');

  if (!fs.existsSync(runsDir)) {
    return [];
  }

  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readReportCard(state, path.join(runsDir, entry.name), entry.name))
    .filter(Boolean)
    .sort((a, b) => b.endedAtMs - a.endedAtMs)
    .slice(0, 50);
}

function readReportCard(state, runDir, runId) {
  const reportPath = path.join(runDir, 'report.json');
  const report = readJson(reportPath);

  if (!report) {
    return null;
  }

  const htmlPath = path.join(runDir, 'report.html');
  const summary = report.summary || {};
  const meta = report.meta || {};
  const results = Array.isArray(report.results) ? report.results : [];
  const endedAtMs = Date.parse(meta.endedAt || meta.startedAt || '') || safeMtimeMs(reportPath);
  const testFiles = uniqueValues((meta.testFiles || []).map(filePath => toProjectRelativePath(state, filePath)).filter(Boolean));
  const failedTests = results
    .filter(result => result.status === 'failed')
    .map(result => toReportTestSummary(state, result));
  const flakyTests = results
    .filter(result => result.flaky || result.status === 'flaky')
    .map(result => toReportTestSummary(state, result))
    .slice(0, 8);
  const slowTests = results
    .filter(result => Number(result.durationMs) > 0)
    .map(result => toReportTestSummary(state, result))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);

  return {
    runId,
    status: summary.status || 'unknown',
    total: summary.total || 0,
    passed: summary.passed || 0,
    failed: summary.failed || 0,
    flaky: summary.flaky || 0,
    skipped: summary.skipped || 0,
    durationMs: meta.durationMs || 0,
    startedAt: meta.startedAt || null,
    endedAt: meta.endedAt || null,
    endedAtMs,
    browserDisplay: meta.browserDisplay || 'show',
    shard: meta.shard || null,
    testFiles,
    htmlUrl: fileUrl(state, htmlPath),
    jsonUrl: fileUrl(state, reportPath),
    junitUrl: fileUrl(state, path.join(runDir, 'junit.xml')),
    failedTests: failedTests.slice(0, 8),
    flakyTests,
    slowTests
  };
}

function toReportTestSummary(state, result = {}) {
  const location = result.error?.location || {};
  const sourceFile = result.file || location.absolutePath || location.file || null;

  return {
    name: result.name || '(unnamed test)',
    file: toProjectRelativePath(state, sourceFile),
    status: result.status || 'unknown',
    durationMs: Number(result.durationMs) || 0,
    flaky: Boolean(result.flaky || result.status === 'flaky'),
    message: result.error?.message || result.diagnostics?.summary || 'No error message captured',
    line: location.line || null,
    runId: null
  };
}

function toProjectRelativePath(state, filePath) {
  if (!filePath) {
    return null;
  }

  const value = String(filePath);
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(state.root, value);

  if (!isInsideDirectory(resolved, state.root)) {
    return value;
  }

  return path.relative(state.root, resolved);
}

function summarizeReports(reports) {
  const latest = reports[0] || null;
  const lastTen = reports.slice(0, 10);

  return {
    latestStatus: latest?.status || 'none',
    runs: reports.length,
    passedRuns: lastTen.filter(report => report.status === 'passed').length,
    failedRuns: lastTen.filter(report => report.status === 'failed').length,
    totalTests: latest?.total || 0,
    failedTests: latest?.failed || 0,
    flakyTests: latest?.flaky || 0,
    skippedTests: latest?.skipped || 0,
    latestReportUrl: latest?.htmlUrl || null
  };
}

function buildOrbitInsights(reports, tests) {
  const stats = new Map();
  const testFileSet = new Set(tests.map(testFile => testFile.file));

  for (const testFile of tests) {
    stats.set(testFile.file, {
      file: testFile.file,
      tests: testFile.tests.length,
      runs: 0,
      failures: 0,
      flaky: 0,
      slowSamples: 0,
      totalDurationMs: 0,
      lastStatus: 'not-run',
      lastRunId: null,
      lastFailure: null,
      latestSeenAt: 0
    });
  }

  for (const report of reports) {
    const reportFiles = report.testFiles.length
      ? report.testFiles
      : uniqueValues([].concat(report.failedTests, report.flakyTests, report.slowTests).map(test => test.file).filter(Boolean));

    for (const file of reportFiles) {
      const stat = ensureInsightStat(stats, file, testFileSet);
      stat.runs++;

      if (report.endedAtMs > stat.latestSeenAt) {
        stat.latestSeenAt = report.endedAtMs;
        stat.lastStatus = report.status;
        stat.lastRunId = report.runId;
      }
    }

    for (const failedTest of report.failedTests) {
      const stat = ensureInsightStat(stats, failedTest.file || reportFiles[0] || 'unknown', testFileSet);
      stat.failures++;

      if (!stat.lastFailure || report.endedAtMs >= stat.lastFailure.endedAtMs) {
        stat.lastFailure = {
          runId: report.runId,
          name: failedTest.name,
          message: failedTest.message,
          line: failedTest.line,
          endedAtMs: report.endedAtMs
        };
      }
    }

    for (const flakyTest of report.flakyTests) {
      const stat = ensureInsightStat(stats, flakyTest.file || reportFiles[0] || 'unknown', testFileSet);
      stat.flaky++;
    }

    for (const slowTest of report.slowTests) {
      const stat = ensureInsightStat(stats, slowTest.file || reportFiles[0] || 'unknown', testFileSet);
      stat.slowSamples++;
      stat.totalDurationMs += slowTest.durationMs;
    }
  }

  const hotspots = Array.from(stats.values())
    .filter(stat => stat.file !== 'unknown' && (stat.runs > 0 || stat.failures > 0 || stat.flaky > 0))
    .map(stat => {
      const avgDurationMs = stat.slowSamples ? Math.round(stat.totalDurationMs / stat.slowSamples) : 0;
      const failureRate = stat.runs ? stat.failures / stat.runs : stat.failures ? 1 : 0;
      const slowScore = avgDurationMs >= 15000 ? 12 : avgDurationMs >= 8000 ? 7 : avgDurationMs >= 4000 ? 3 : 0;
      const recencyScore = stat.lastStatus === 'failed' ? 26 : stat.lastStatus === 'flaky' ? 16 : 0;
      const score = Math.min(100, Math.round(recencyScore + failureRate * 45 + stat.flaky * 10 + slowScore));

      return {
        file: stat.file,
        tests: stat.tests,
        runs: stat.runs,
        failures: stat.failures,
        flaky: stat.flaky,
        failureRate,
        avgDurationMs,
        score,
        lastStatus: stat.lastStatus,
        lastRunId: stat.lastRunId,
        lastFailure: stat.lastFailure
          ? {
            runId: stat.lastFailure.runId,
            name: stat.lastFailure.name,
            message: stat.lastFailure.message,
            line: stat.lastFailure.line
          }
          : null
      };
    })
    .sort((a, b) => b.score - a.score || b.failures - a.failures || b.avgDurationMs - a.avgDurationMs)
    .slice(0, 5);

  const latest = reports[0] || null;
  const latestFailedFiles = latest
    ? uniqueValues(latest.failedTests.map(test => test.file).filter(Boolean))
    : [];
  const recommendedTarget = latestFailedFiles[0] || hotspots[0]?.file || (tests[0]?.file || null);
  const recommendedTone = latestFailedFiles.length ? 'fail' : hotspots[0]?.score >= 40 ? 'warn' : 'pass';
  const healthScore = calculateHealthScore(reports, hotspots);

  return {
    health: {
      score: healthScore,
      label: healthScore >= 85 ? 'Stable' : healthScore >= 65 ? 'Watch' : healthScore >= 40 ? 'Risky' : 'Critical',
      summary: createHealthSummary(reports, hotspots, healthScore)
    },
    recommendation: {
      target: recommendedTarget,
      title: latestFailedFiles.length
        ? 'Rerun the freshest failure with evidence'
        : hotspots[0]
          ? 'Probe the highest-risk test file'
          : 'Start with the first discovered test file',
      reason: latestFailedFiles.length
        ? `${latestFailedFiles.length} file${latestFailedFiles.length === 1 ? '' : 's'} failed in the latest run. Orbit recommends rerunning the top failed file with trace and Smart Report enabled.`
        : hotspots[0]
          ? `${hotspots[0].file} has the strongest recent risk signal from failures, flaky runs, or slow execution.`
          : 'No report history exists yet, so Orbit recommends running one test file to establish a baseline.',
      tone: recommendedTone,
      trace: Boolean(latestFailedFiles.length || hotspots[0]?.failures > 0 || hotspots[0]?.score >= 35),
      smartReport: Boolean(latestFailedFiles.length || hotspots[0]?.failures > 0 || hotspots[0]?.score >= 35),
      retries: latestFailedFiles.length || hotspots[0]?.failures > 0 ? 1 : null
    },
    signals: [
      {
        label: 'Failure Hotspots',
        value: String(hotspots.filter(item => item.failures > 0).length),
        detail: 'files with recent failed tests',
        tone: hotspots.some(item => item.failures > 0) ? 'fail' : 'pass'
      },
      {
        label: 'Flaky Signals',
        value: String(hotspots.reduce((total, item) => total + item.flaky, 0)),
        detail: 'retry-pass or flaky markers',
        tone: hotspots.some(item => item.flaky > 0) ? 'warn' : 'pass'
      },
      {
        label: 'Slowest Avg',
        value: formatCompactDuration(Math.max(0, ...hotspots.map(item => item.avgDurationMs))),
        detail: 'from recent report history',
        tone: hotspots.some(item => item.avgDurationMs >= 10000) ? 'warn' : 'pass'
      }
    ],
    hotspots
  };
}

function ensureInsightStat(stats, file, testFileSet) {
  const key = file || 'unknown';

  if (!stats.has(key)) {
    stats.set(key, {
      file: key,
      tests: testFileSet.has(key) ? 1 : 0,
      runs: 0,
      failures: 0,
      flaky: 0,
      slowSamples: 0,
      totalDurationMs: 0,
      lastStatus: 'not-run',
      lastRunId: null,
      lastFailure: null,
      latestSeenAt: 0
    });
  }

  return stats.get(key);
}

function calculateHealthScore(reports, hotspots) {
  if (!reports.length) {
    return 100;
  }

  const lastTen = reports.slice(0, 10);
  const failedRuns = lastTen.filter(report => report.status === 'failed').length;
  const flakyCount = lastTen.reduce((total, report) => total + (report.flaky || 0), 0);
  const hotspotPenalty = hotspots.reduce((max, item) => Math.max(max, item.score), 0) * 0.35;
  const score = 100 - failedRuns * 12 - flakyCount * 7 - hotspotPenalty;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function createHealthSummary(reports, hotspots, score) {
  if (!reports.length) {
    return 'No report history yet. Run a test to build the first health baseline.';
  }

  if (score >= 85) {
    return 'Recent runs look healthy. Keep watching for slow-growth risk and flaky drift.';
  }

  if (hotspots[0]) {
    return `${hotspots[0].file} is currently the highest signal area to inspect.`;
  }

  return 'Recent report history has risk signals. Start with the recommended target.';
}

function formatCompactDuration(ms) {
  if (!ms) {
    return '0ms';
  }

  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(value => value !== null && value !== undefined && value !== '')));
}

function collectTests(state) {
  if (!fs.existsSync(state.testDir)) {
    return [];
  }

  return walkFiles(state.testDir)
    .filter(filePath => /\.(test|spec)\.js$/i.test(filePath))
    .sort()
    .map(filePath => {
      const relativePath = path.relative(state.root, filePath);
      const source = safeRead(filePath);

      return {
        file: relativePath,
        name: path.basename(filePath),
        tests: extractTestNames(source)
      };
    });
}

function extractTestNames(source) {
  const names = [];
  const pattern = /\btest\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let match;

  while ((match = pattern.exec(source))) {
    names.push(unescapeJsString(match[2]).trim() || '(unnamed test)');
  }

  return names;
}

function walkFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'reports') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function serveProjectFile(req, res, state, relativeFile) {
  const filePath = path.resolve(state.root, relativeFile);

  if (!isInsideDirectory(filePath, state.root)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
}

function loadProjectConfig(root) {
  const configPath = path.join(root, 'orbittest.config.js');
  const fallback = {
    testDir: 'tests',
    reportsDir: 'reports',
    workers: 1,
    retries: 0,
    testTimeout: 30000,
    browser: { display: 'auto' },
    ci: {}
  };

  if (!fs.existsSync(configPath)) {
    return fallback;
  }

  try {
    delete require.cache[require.resolve(configPath)];
    const loaded = require(configPath);
    const config = typeof loaded === 'function' ? loaded() : loaded;

    return {
      ...fallback,
      ...(config && typeof config === 'object' ? config : {}),
      browser: {
        ...fallback.browser,
        ...(config?.browser || {})
      },
      ci: {
        ...fallback.ci,
        ...(config?.ci || {})
      }
    };
  } catch (error) {
    return {
      ...fallback,
      configError: error.message || String(error)
    };
  }
}

function renderStudioHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitTest UI</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6fa;
      --panel: #ffffff;
      --panel-soft: #f9fafb;
      --panel-tint: #f4f8fb;
      --text: #111827;
      --heading: #0b1220;
      --muted: #667085;
      --line: #d9e1ec;
      --line-soft: #edf1f6;
      --blue: #155eef;
      --blue-dark: #0f3f9e;
      --blue-bg: #eaf1ff;
      --green: #087443;
      --green-bg: #e7f6ed;
      --red: #b42318;
      --red-bg: #fde8e7;
      --amber: #9a6700;
      --amber-bg: #fff3c4;
      --teal: #0e9384;
      --shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
      --shadow-soft: 0 8px 20px rgba(15, 23, 42, 0.05);
      --player-bg: #080b12;
      --player-panel: #101827;
      --player-line: rgba(148, 163, 184, 0.26);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0) 230px),
        var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }

    button, input, select {
      font: inherit;
    }

    button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 12px;
      background: #fff;
      color: var(--text);
      cursor: pointer;
      font-weight: 700;
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
    }

    button:hover {
      background: var(--panel-soft);
      border-color: #cbd5e1;
    }

    button.primary {
      border-color: var(--blue);
      background: var(--blue);
      color: #fff;
      box-shadow: 0 8px 18px rgba(21, 94, 239, 0.22);
    }

    button.primary:hover {
      background: var(--blue-dark);
      transform: translateY(-1px);
    }

    button.danger {
      border-color: #f3b8b3;
      background: var(--red-bg);
      color: var(--red);
    }

    button.danger:hover {
      background: #fee4e2;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    a {
      color: var(--blue);
      font-weight: 700;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }

    :focus-visible {
      outline: 3px solid rgba(21, 94, 239, 0.18);
      outline-offset: 2px;
    }

    main {
      max-width: 1540px;
      margin: 0 auto;
      padding: 24px;
    }

    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      padding: 12px 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow-soft);
    }

    .brand-lockup {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .brand-lockup > div:last-child {
      min-width: 0;
    }

    .topbar #projectMeta {
      max-width: min(640px, 58vw);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .logo-frame {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 1px solid #d8e2ee;
      border-radius: 12px;
      background: #fff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 9px 18px rgba(15, 23, 42, 0.08);
      flex: 0 0 auto;
    }

    .logo-frame img {
      width: 34px;
      height: 34px;
      display: block;
      object-fit: contain;
    }

    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 2px; color: var(--heading); font-size: 22px; line-height: 1.08; letter-spacing: 0; }
    h2 { margin-bottom: 14px; color: var(--heading); font-size: 20px; }
    h3 { margin-bottom: 8px; font-size: 15px; }

    .muted { color: var(--muted); }
    .small { font-size: 12px; }

    .eyebrow {
      display: none;
      margin-bottom: 2px;
      color: var(--teal);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .app-meta {
      display: none;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 5px;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: #fff;
      font-size: 12px;
      font-weight: 700;
      max-width: min(420px, 100%);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar {
      display: flex;
      flex-wrap: nowrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
      min-width: 0;
    }

    .button-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 12px;
      background: #fff;
      color: var(--text);
      text-decoration: none;
      transition: background 150ms ease, border-color 150ms ease;
    }

    .button-link:hover {
      background: var(--panel-soft);
      border-color: #cbd5e1;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      gap: 18px;
      margin-top: 18px;
      align-items: start;
    }

    .grid > div {
      min-width: 0;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }

    .insight-panel {
      margin-top: 18px;
      padding: 18px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow-soft);
    }

    .insight-grid {
      display: grid;
      grid-template-columns: 0.9fr 1.15fr 1.2fr;
      gap: 16px;
      align-items: stretch;
    }

    .insight-block {
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--line-soft);
      border-radius: 10px;
      background: var(--panel-soft);
    }

    .health-score {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .health-score strong {
      color: var(--heading);
      font-size: 40px;
      line-height: 1;
    }

    .health-score span {
      color: var(--muted);
      font-weight: 800;
    }

    .meter-track {
      height: 8px;
      margin: 12px 0;
      overflow: hidden;
      border-radius: 999px;
      background: #e5eaf2;
    }

    .meter-fill {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: var(--green);
      transition: width 240ms ease, background 240ms ease;
    }

    .insight-copy {
      margin: 0;
      color: var(--muted-strong, var(--muted));
      font-size: 13px;
    }

    .insight-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .signal-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .signal {
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .signal span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .signal strong {
      display: block;
      margin-top: 4px;
      color: var(--heading);
      font-size: 19px;
    }

    .signal small {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
    }

    .hotspot-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }

    .hotspot {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .hotspot-title {
      overflow: hidden;
      color: var(--heading);
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hotspot-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .risk-chip {
      min-width: 48px;
      padding: 5px 8px;
      border-radius: 999px;
      background: var(--blue-bg);
      color: var(--blue);
      font-size: 12px;
      font-weight: 900;
      text-align: center;
    }

    .risk-chip.warn { background: var(--amber-bg); color: var(--amber); }
    .risk-chip.fail { background: var(--red-bg); color: var(--red); }

    .metric,
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
    }

    .metric {
      padding: 15px 16px 16px;
      position: relative;
      overflow: hidden;
      min-height: 112px;
    }

    .metric::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      width: auto;
      height: 4px;
      background: var(--blue);
    }

    .metric.pass::before { background: var(--green); }
    .metric.fail::before { background: var(--red); }
    .metric.warn::before { background: var(--amber); }

    .metric-sub {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .metric span {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .metric strong {
      font-size: 28px;
      line-height: 1;
    }

    .panel {
      padding: 18px;
      margin-bottom: 18px;
      min-width: 0;
    }

    .panel:hover {
      border-color: #cfd8e5;
    }

    .panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .panel-head h2 {
      margin-bottom: 3px;
    }

    .run-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    input[type="text"],
    input[type="number"],
    select {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 10px;
      background: #fff;
      color: var(--text);
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }

    input[type="text"]:focus,
    input[type="number"]:focus,
    select:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px rgba(21, 94, 239, 0.12);
      outline: 0;
    }

    .split-controls {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 12px 0;
    }

    .checks label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
    }

    .segmented {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .segmented button {
      border: 0;
      border-right: 1px solid var(--line);
      border-radius: 0;
      min-height: 34px;
      color: var(--muted);
    }

    .segmented button:last-child {
      border-right: 0;
    }

    .segmented button.active {
      background: var(--blue-bg);
      color: var(--blue);
    }

    .command-preview {
      margin-top: 12px;
      padding: 10px 12px;
      color: #eef4ff;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      overflow-x: auto;
      white-space: nowrap;
    }

    .search-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      margin-bottom: 12px;
      align-items: end;
    }

    .search-row > button {
      min-height: 38px;
    }

    .file-list,
    .report-list {
      display: grid;
      gap: 0;
      max-height: 580px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
    }

    .file-card,
    .report-card {
      padding: 13px 14px;
      background: #fff;
      border-bottom: 1px solid var(--line-soft);
      border-radius: 0;
    }

    .file-card:last-child,
    .report-card:last-child {
      border-bottom: 0;
    }

    .file-card:hover,
    .report-card:hover {
      background: var(--panel-tint);
    }

    .file-head,
    .report-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .file-name,
    .report-title {
      font-weight: 800;
      overflow-wrap: anywhere;
      color: var(--heading);
    }

    .row-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .test-list {
      margin: 8px 0 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 13px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 0 9px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .badge.passed { color: var(--green); background: var(--green-bg); }
    .badge.failed { color: var(--red); background: var(--red-bg); }
    .badge.running { color: var(--blue); background: var(--blue-bg); }
    .badge.flaky, .badge.unknown, .badge.stopping { color: var(--amber); background: var(--amber-bg); }

    .console {
      min-height: 300px;
      max-height: 500px;
      overflow: auto;
      margin: 12px 0 0;
      padding: 14px;
      background: #0f172a;
      color: #f9fafb;
      border-radius: 8px;
      border: 1px solid #1e293b;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      white-space: pre-wrap;
    }

    .run-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .run-fact {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      min-width: 0;
    }

    .run-fact span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .run-fact strong {
      display: block;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }

    .report-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .failure-list {
      margin: 10px 0 0;
      padding-left: 18px;
      color: var(--red);
      font-size: 13px;
    }

    .result-bar {
      display: grid;
      grid-template-columns: var(--pass, 1fr) var(--fail, 0fr) var(--flaky, 0fr) var(--skip, 0fr);
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: #eef2f7;
      margin-top: 10px;
    }

    .result-bar span:nth-child(1) { background: var(--green); }
    .result-bar span:nth-child(2) { background: var(--red); }
    .result-bar span:nth-child(3) { background: var(--amber); }
    .result-bar span:nth-child(4) { background: #98a2b3; }

    @keyframes orbitSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spin { display: inline-block; animation: orbitSpin 700ms linear infinite; }

    /* ── Run tabs ─────────────────────────────────────────── */
    .run-tabs {
      display: flex;
      margin: 14px 0 0;
      border-bottom: 1px solid var(--line);
    }

    .run-tab {
      border: 0;
      border-radius: 0;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      min-height: 34px;
      padding: 0 14px;
      background: none;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      box-shadow: none;
    }

    .run-tab:hover { background: none; color: var(--text); border-color: transparent; }
    .run-tab.active { color: var(--blue); border-bottom-color: var(--blue); }

    /* ── Progress bar ─────────────────────────────────────── */
    .exec-progress { padding: 12px 0 8px; }

    .exec-progress-bar {
      display: flex;
      height: 7px;
      border-radius: 999px;
      overflow: hidden;
      background: #e5eaf2;
    }

    .exec-bar-passed { height: 100%; background: var(--green); transition: width 300ms ease; }
    .exec-bar-failed { height: 100%; background: var(--red);   transition: width 300ms ease; }
    .exec-bar-flaky  { height: 100%; background: var(--amber); transition: width 300ms ease; }

    .exec-progress-label { margin-top: 7px; font-size: 12px; font-weight: 700; color: var(--muted); }

    /* ── Filter chips ─────────────────────────────────────── */
    .exec-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 10px 0 8px;
    }

    .exec-filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 26px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 10px;
      background: #fff;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      box-shadow: none;
    }

    .exec-filter-chip:hover { background: var(--panel-soft); border-color: #cbd5e1; }
    .exec-filter-chip.active { border-color: var(--blue); background: var(--blue-bg); color: var(--blue); }
    .exec-filter-chip.active.pass-filter { border-color: var(--green); background: var(--green-bg); color: var(--green); }
    .exec-filter-chip.active.fail-filter { border-color: var(--red);   background: var(--red-bg);   color: var(--red); }
    .exec-filter-chip.active.flaky-filter { border-color: var(--amber); background: var(--amber-bg); color: var(--amber); }

    /* ── Search row ───────────────────────────────────────── */
    .exec-search-row {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 8px;
      margin-bottom: 10px;
    }

    .exec-search-row input {
      min-height: 32px;
      font-size: 13px;
    }

    .exec-search-row button {
      min-height: 32px;
      font-size: 12px;
    }

    /* ── Test list ────────────────────────────────────────── */
    .exec-test-list {
      max-height: 480px;
      overflow-y: auto;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: #fff;
    }

    /* ── File group ───────────────────────────────────────── */
    .exec-file-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--panel-soft);
      border-bottom: 1px solid var(--line-soft);
      cursor: pointer;
      user-select: none;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .exec-file-head:hover { background: #edf2fb; }

    .exec-chevron {
      font-size: 9px;
      color: var(--muted);
      transition: transform 180ms ease;
      flex-shrink: 0;
      line-height: 1;
    }

    .exec-file-group.open .exec-chevron { transform: rotate(90deg); }
    .exec-file-group.collapsed .exec-file-tests { display: none; }

    .exec-file-label {
      font-size: 12px;
      font-weight: 800;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .exec-file-count-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 800;
      color: var(--muted);
    }

    .exec-file-stat { font-size: 11px; font-weight: 800; }
    .exec-file-stat.pass { color: var(--green); }
    .exec-file-stat.fail { color: var(--red); }
    .exec-file-stat.run  { color: var(--blue); }

    /* ── Test row ─────────────────────────────────────────── */
    .exec-test-row {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto auto;
      gap: 8px;
      align-items: center;
      padding: 8px 10px 8px 22px;
      border-bottom: 1px solid var(--line-soft);
      font-size: 13px;
      cursor: pointer;
      transition: background 120ms;
    }

    .exec-test-row:last-child { border-bottom: 0; }
    .exec-test-row:hover  { background: rgba(15,23,42,0.025); }
    .exec-test-row.running { background: rgba(21,94,239,0.04); }
    .exec-test-row.failed  { background: rgba(180,35,24,0.03); }
    .exec-test-row.selected { background: var(--blue-bg) !important; }

    .exec-icon { font-size: 14px; text-align: center; line-height: 1; font-weight: 900; }
    .exec-icon.queued  { color: #b8c4d4; }
    .exec-icon.running { color: var(--blue); }
    .exec-icon.passed  { color: var(--green); }
    .exec-icon.failed  { color: var(--red); }
    .exec-icon.flaky   { color: var(--amber); }

    .exec-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--heading); }
    .exec-name.queued  { color: var(--muted); font-weight: 400; }
    .exec-name.failed  { color: var(--red); }
    .exec-name.running { color: var(--blue); }

    .exec-retry {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      border-radius: 4px;
      padding: 0 5px;
      font-size: 10px;
      font-weight: 800;
      background: var(--amber-bg);
      color: var(--amber);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .exec-duration { font-size: 11px; color: var(--muted); font-weight: 700; white-space: nowrap; }

    /* ── Expanded test detail ─────────────────────────────── */
    .exec-detail {
      margin: 0;
      padding: 12px 14px 12px 50px;
      background: #fafbfd;
      border-bottom: 1px solid var(--line-soft);
      font-size: 12px;
    }

    .exec-detail-error {
      font-weight: 700;
      color: var(--red);
      margin-bottom: 8px;
      word-break: break-word;
      line-height: 1.5;
    }

    .exec-detail-pass {
      font-weight: 700;
      color: var(--green);
    }

    .exec-detail-stack {
      font-family: Consolas, "Courier New", monospace;
      font-size: 11px;
      color: #4b5563;
      background: #f1f5f9;
      border: 1px solid var(--line-soft);
      border-radius: 6px;
      padding: 8px 10px;
      margin: 6px 0;
      max-height: 120px;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre;
      line-height: 1.6;
    }

    .exec-detail-artifacts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .exec-artifact-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 26px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      background: #fff;
      color: var(--text);
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      transition: background 120ms;
    }

    .exec-artifact-btn:hover { background: var(--panel-soft); }

    /* ── Elapsed timer ────────────────────────────────────── */
    .exec-elapsed {
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
      font-weight: 700;
      color: var(--blue);
      min-width: 52px;
      text-align: right;
    }

    .ui-viewer {
      margin-top: 14px;
      overflow: hidden;
      border: 1px solid #0f172a;
      border-radius: 8px;
      background: var(--player-bg);
      box-shadow: 0 18px 42px rgba(2, 6, 23, 0.16);
    }

    .viewer-stage {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 300px;
      aspect-ratio: 16 / 10;
      padding: 14px;
      background:
        linear-gradient(180deg, rgba(15, 23, 42, 0), rgba(2, 6, 23, 0.28)),
        #0b1020;
    }

    .viewer-stage::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px) 0 0 / 48px 48px,
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px) 0 0 / 48px 48px;
      opacity: 0.55;
    }

    .browser-shell {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-rows: 40px minmax(0, 1fr);
      width: min(100%, 980px);
      height: auto;
      aspect-ratio: var(--frame-shell-ratio, 1366 / 808);
      max-height: 560px;
      overflow: hidden;
      border: 1px solid rgba(226, 232, 240, 0.22);
      border-radius: 8px;
      background: #f8fafc;
      box-shadow: 0 24px 48px rgba(2, 6, 23, 0.34);
    }

    .browser-chrome {
      display: grid;
      grid-template-columns: auto minmax(90px, 220px) minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      min-width: 0;
      padding: 8px 10px;
      background: #eef2f7;
      border-bottom: 1px solid #d9e1ec;
    }

    .browser-dots {
      display: inline-flex;
      gap: 5px;
      align-items: center;
      white-space: nowrap;
    }

    .browser-dots span {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #cbd5e1;
    }

    .browser-dots span:nth-child(1) { background: #f87171; }
    .browser-dots span:nth-child(2) { background: #fbbf24; }
    .browser-dots span:nth-child(3) { background: #34d399; }

    .browser-tab {
      min-width: 0;
      height: 25px;
      padding: 5px 10px 0;
      overflow: hidden;
      border-radius: 7px 7px 0 0;
      background: #fff;
      color: #334155;
      font-size: 12px;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .browser-urlbar {
      min-width: 0;
      height: 26px;
      padding: 5px 10px 0;
      overflow: hidden;
      border: 1px solid #d4dce8;
      border-radius: 999px;
      background: #fff;
      color: #475569;
      font-family: Consolas, "Courier New", monospace;
      font-size: 11px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .browser-viewport {
      display: grid;
      place-items: center;
      min-height: 0;
      overflow: hidden;
      background: #fff;
      aspect-ratio: var(--frame-ratio, 1366 / 768);
    }

    .browser-viewport img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #fff;
    }

    .viewer-placeholder {
      position: relative;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-height: 150px;
      padding: 24px;
      color: #475569;
      background: #f8fafc;
      font-size: 13px;
      font-weight: 800;
      text-align: center;
    }

    .viewer-overlay {
      position: absolute;
      z-index: 2;
      left: 12px;
      right: 12px;
      top: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      pointer-events: none;
    }

    .viewer-status-pill,
    .viewer-live-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid rgba(226, 232, 240, 0.16);
      border-radius: 999px;
      color: #e2e8f0;
      background: rgba(2, 6, 23, 0.72);
      box-shadow: 0 10px 24px rgba(2, 6, 23, 0.22);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .viewer-live-pill::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #94a3b8;
    }

    .viewer-live-pill.live::before {
      background: #22c55e;
      box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.14);
    }

    .viewer-meta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 12px 14px 6px;
      background: var(--player-bg);
      border-top: 1px solid rgba(148, 163, 184, 0.18);
    }

    .viewer-meta strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #f8fafc;
      font-size: 13px;
      letter-spacing: 0;
    }

    .viewer-meta span {
      color: #a7b4c6;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .player-controls {
      display: grid;
      grid-template-columns: auto minmax(140px, 1fr) auto auto auto;
      gap: 10px;
      align-items: center;
      padding: 10px 12px 12px;
      background: var(--player-bg);
    }

    .player-button {
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
      min-height: 36px;
      padding: 0;
      border-color: var(--player-line);
      border-radius: 999px;
      color: #f8fafc;
      background: rgba(30, 41, 59, 0.86);
      box-shadow: none;
    }

    .player-icon {
      display: block;
      width: 0;
      height: 0;
      border-top: 7px solid transparent;
      border-bottom: 7px solid transparent;
      border-left: 10px solid #f8fafc;
      margin-left: 3px;
    }

    .player-button.playing .player-icon {
      width: 13px;
      height: 15px;
      border: 0;
      margin-left: 0;
      background:
        linear-gradient(90deg, #f8fafc 0 4px, transparent 4px 8px, #f8fafc 8px 12px);
    }

    .player-button:hover {
      background: rgba(51, 65, 85, 0.95);
      border-color: rgba(226, 232, 240, 0.32);
      transform: none;
    }

    .player-live-button {
      min-height: 32px;
      border-color: var(--player-line);
      border-radius: 999px;
      color: #cbd5e1;
      background: rgba(15, 23, 42, 0.84);
      box-shadow: none;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .player-live-button.active {
      border-color: rgba(34, 197, 94, 0.45);
      color: #bbf7d0;
      background: rgba(22, 101, 52, 0.34);
    }

    .player-speed {
      width: 76px;
      min-height: 32px;
      border-color: var(--player-line);
      border-radius: 999px;
      color: #e2e8f0;
      background: rgba(15, 23, 42, 0.84);
      font-size: 12px;
      font-weight: 800;
    }

    .player-time {
      color: #a7b4c6;
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .player-scrubber {
      width: 100%;
      accent-color: #38bdf8;
    }

    .player-button:disabled,
    .player-speed:disabled,
    .player-live-button:disabled,
    .player-scrubber:disabled {
      opacity: 0.42;
    }

    @media (max-width: 980px) {
      main { padding: 14px; }
      .topbar { grid-template-columns: 1fr; }
      .run-controls { display: block; }
      .toolbar { justify-content: flex-start; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .insight-grid { grid-template-columns: 1fr; }
      .run-strip, .split-controls { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .viewer-stage { min-height: 260px; aspect-ratio: 16 / 9; }
      .browser-shell { grid-template-rows: 38px minmax(0, 1fr); }
      .browser-chrome { grid-template-columns: auto minmax(70px, 160px) minmax(0, 1fr); gap: 8px; }
      .player-controls { grid-template-columns: auto minmax(120px, 1fr) auto; }
      .player-speed,
      .player-live-button { grid-column: auto; }
    }

    @media (max-width: 640px) {
      .summary { grid-template-columns: 1fr; }
      .brand-lockup { align-items: center; }
      .logo-frame { width: 40px; height: 40px; }
      .logo-frame img { width: 31px; height: 31px; }
      h1 { font-size: 22px; }
      .topbar #projectMeta { display: none; }
      .toolbar {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        width: 100%;
        gap: 6px;
      }
      .toolbar button,
      .toolbar .button-link {
        min-height: 32px;
        padding: 0 8px;
        font-size: 12px;
      }
      .app-meta { display: none; }
      .signal-grid { grid-template-columns: 1fr; }
      .file-head, .report-head, .panel-head { display: block; }
      .file-head button, .panel-head .segmented { margin-top: 10px; }
      .search-row { grid-template-columns: 1fr; }
      .viewer-stage { min-height: 210px; }
      .browser-chrome { grid-template-columns: auto minmax(0, 1fr); }
      .browser-urlbar { grid-column: 1 / -1; }
      .browser-tab { height: 24px; }
      .viewer-meta { grid-template-columns: 1fr; gap: 4px; }
      .player-controls {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 8px;
      }
      .player-time {
        grid-column: 1 / -1;
        order: 5;
      }
      .player-speed { width: 70px; }
      .player-live-button { padding: 0 10px; }
    }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div class="brand-lockup">
        <div class="logo-frame">
          <img src="/file/assets/orbit-logo.svg" alt="OrbitTest">
        </div>
        <div>
          <div class="eyebrow">Automation Command Center</div>
          <h1>OrbitTest UI</h1>
          <div class="muted" id="projectMeta">Loading project...</div>
          <div class="app-meta">
            <span class="meta-pill" id="testDirMeta">tests</span>
            <span class="meta-pill" id="reportsDirMeta">reports</span>
            <span class="meta-pill" id="configMeta">config</span>
          </div>
        </div>
      </div>
      <div class="toolbar">
        <button type="button" id="refreshButton">Refresh</button>
        <a class="button-link" id="latestReportLink" href="#" target="_blank" rel="noreferrer">Latest Report</a>
        <button class="danger" type="button" id="stopStudioButton">Stop UI</button>
      </div>
    </header>

    <section class="summary">
      <div class="metric" id="latestMetric"><span>Latest</span><strong id="latestStatus">-</strong><div class="metric-sub" id="latestSub">No runs</div></div>
      <div class="metric"><span>Runs</span><strong id="runCount">0</strong><div class="metric-sub">stored reports</div></div>
      <div class="metric pass"><span>Passed</span><strong id="passedRuns">0</strong><div class="metric-sub">last 10 runs</div></div>
      <div class="metric fail"><span>Failed</span><strong id="failedRuns">0</strong><div class="metric-sub">last 10 runs</div></div>
      <div class="metric fail"><span>Failed Tests</span><strong id="failedTests">0</strong><div class="metric-sub">latest run</div></div>
      <div class="metric warn"><span>Flaky</span><strong id="flakyTests">0</strong><div class="metric-sub">latest run</div></div>
    </section>

    <section class="insight-panel">
      <div class="panel-head">
        <div>
          <h2>Orbit Intelligence</h2>
          <div class="muted small">History-aware run recommendation from recent reports.</div>
        </div>
        <span class="badge unknown" id="healthBadge">analyzing</span>
      </div>
      <div class="insight-grid">
        <div class="insight-block">
          <div class="health-score"><strong id="healthScore">--</strong><span>/100</span></div>
          <div class="meter-track"><div class="meter-fill" id="healthMeter"></div></div>
          <p class="insight-copy" id="healthSummary">Waiting for report history.</p>
          <div class="signal-grid" id="signalGrid"></div>
        </div>
        <div class="insight-block">
          <h3 id="recommendTitle">Recommended Next Run</h3>
          <p class="insight-copy" id="recommendReason">Orbit will recommend a target after reading reports.</p>
          <div class="command-preview" id="recommendCommand">orbittest run</div>
          <div class="insight-actions">
            <button type="button" id="applyRecommendationButton">Apply</button>
            <button class="primary" type="button" id="runRecommendationButton">Run Recommended</button>
          </div>
        </div>
        <div class="insight-block">
          <h3>Risk Hotspots</h3>
          <div class="hotspot-list" id="hotspotList"></div>
        </div>
      </div>
    </section>

    <div class="grid">
      <div>
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Run Controls</h2>
              <div class="muted small">Command preview updates before launch.</div>
            </div>
            <div class="segmented" id="presetGroup">
              <button type="button" data-preset="local" class="active">Local</button>
              <button type="button" data-preset="evidence">Evidence</button>
              <button type="button" data-preset="ci">CI</button>
            </div>
          </div>
          <div class="run-controls">
            <label>
              Target
              <select id="targetSelect"></select>
            </label>
            <button class="primary" type="button" id="runButton">Run</button>
          </div>
          <div class="checks">
            <label><input type="checkbox" id="traceCheck"> Trace</label>
            <label><input type="checkbox" id="smartCheck"> Smart Report</label>
            <label><input type="checkbox" id="ciCheck"> CI Mode</label>
            <label><input type="checkbox" id="hideCheck" checked disabled> Embedded View</label>
          </div>
          <div class="split-controls">
            <label>
              Workers
              <input type="number" id="workersInput" min="1" max="64" placeholder="default">
            </label>
            <label>
              Retries
              <input type="number" id="retriesInput" min="0" max="20" placeholder="default">
            </label>
          </div>
          <div class="command-preview" id="commandPreview">orbittest run</div>
          <div class="toolbar" style="justify-content: flex-start; margin-top: 12px;">
            <button class="danger" type="button" id="stopButton">Stop Run</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Test Explorer</h2>
              <div class="muted small" id="testCountMeta">0 files</div>
            </div>
          </div>
          <div class="search-row">
            <label>
              Filter
              <input type="text" id="testFilterInput" placeholder="File or test name">
            </label>
            <button type="button" id="clearTestFilterButton">Clear</button>
          </div>
          <div class="file-list" id="fileList"></div>
        </section>
      </div>

      <div>
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Live Run</h2>
              <div class="muted small" id="runMeta">No active run.</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <span class="exec-elapsed" id="runElapsed" style="display:none"></span>
              <span class="badge unknown" id="runStatus">idle</span>
            </div>
          </div>
          <div class="run-strip">
            <div class="run-fact"><span>Target</span><strong id="runTargetFact">-</strong></div>
            <div class="run-fact"><span>Started</span><strong id="runStartedFact">-</strong></div>
            <div class="run-fact"><span>Exit</span><strong id="runExitFact">-</strong></div>
            <div class="run-fact"><span>Mode</span><strong id="runModeFact">-</strong></div>
          </div>
          <div class="run-tabs">
            <button class="run-tab active" data-tab="execution">Execution</button>
            <button class="run-tab" data-tab="console">Console</button>
          </div>
          <div id="executionPanel">
            <div class="ui-viewer" id="uiViewer">
              <div class="viewer-stage">
                <div class="browser-shell" aria-label="Embedded browser replay">
                  <div class="browser-chrome">
                    <span class="browser-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                    <div class="browser-tab" id="liveFrameTab">OrbitTest</div>
                    <div class="browser-urlbar" id="liveFrameUrl">about:blank</div>
                  </div>
                  <div class="browser-viewport">
                    <img id="liveFrameImage" alt="Live browser frame" style="display:none">
                    <div class="viewer-placeholder" id="liveFramePlaceholder">Embedded browser frames appear here during a run.</div>
                  </div>
                </div>
                <div class="viewer-overlay">
                  <span class="viewer-status-pill" id="liveFrameStatus">Ready</span>
                  <span class="viewer-live-pill" id="liveFrameLive">Idle</span>
                </div>
              </div>
              <div class="viewer-meta">
                <strong id="liveFrameTitle">Embedded Live View</strong>
                <span id="liveFrameMeta">0 frames</span>
              </div>
              <div class="player-controls">
                <button type="button" class="player-button" id="playerPlayButton" aria-label="Play recording"><span class="player-icon" aria-hidden="true"></span></button>
                <input class="player-scrubber" type="range" id="frameScrubber" min="0" max="0" value="0" aria-label="Playback timeline">
                <span class="player-time" id="playerTime">00:00 / 00:00</span>
                <select class="player-speed" id="playerSpeedSelect" aria-label="Playback speed">
                  <option value="1200">0.5x</option>
                  <option value="800" selected>1x</option>
                  <option value="450">1.5x</option>
                  <option value="250">2x</option>
                </select>
                <button type="button" class="player-live-button active" id="playerLiveButton">Live</button>
              </div>
            </div>
            <div class="exec-progress">
              <div class="exec-progress-bar">
                <div class="exec-bar-passed" id="execBarPassed" style="width:0%"></div>
                <div class="exec-bar-failed" id="execBarFailed" style="width:0%"></div>
                <div class="exec-bar-flaky"  id="execBarFlaky"  style="width:0%"></div>
              </div>
              <div class="exec-progress-label" id="execProgressLabel">Ready to run</div>
            </div>
            <div class="exec-filters" id="execFilters" style="display:none">
              <button class="exec-filter-chip active" data-filter="all">All <span id="execCountAll">0</span></button>
              <button class="exec-filter-chip run-filter" data-filter="running">Running <span id="execCountRunning">0</span></button>
              <button class="exec-filter-chip pass-filter" data-filter="passed">Passed <span id="execCountPassed">0</span></button>
              <button class="exec-filter-chip fail-filter" data-filter="failed">Failed <span id="execCountFailed">0</span></button>
              <button class="exec-filter-chip flaky-filter" data-filter="flaky">Flaky <span id="execCountFlaky">0</span></button>
            </div>
            <div class="exec-search-row" id="execSearchRow" style="display:none">
              <input type="text" id="execSearchInput" placeholder="Filter tests by name...">
              <button type="button" id="execSearchClear">Clear</button>
            </div>
            <div class="exec-test-list" id="execTestList"></div>
          </div>
          <div id="consolePanel" style="display:none">
            <pre class="console" id="consoleOutput">Run output will appear here.</pre>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Report Center</h2>
              <div class="muted small" id="reportCountMeta">0 reports</div>
            </div>
          </div>
          <div class="search-row">
            <label>
              Filter
              <input type="text" id="reportFilterInput" placeholder="Run id, status, or failure">
            </label>
            <button type="button" id="clearReportFilterButton">Clear</button>
          </div>
          <div class="report-list" id="reportList"></div>
        </section>
      </div>
    </div>
  </main>

  <script>
    const state = {
      refreshTimer: null,
      activeRunId: null,
      tests: [],
      reports: [],
      insights: null,
      preset: 'local'
    };

    const els = {
      projectMeta: document.querySelector('#projectMeta'),
      testDirMeta: document.querySelector('#testDirMeta'),
      reportsDirMeta: document.querySelector('#reportsDirMeta'),
      configMeta: document.querySelector('#configMeta'),
      latestMetric: document.querySelector('#latestMetric'),
      latestStatus: document.querySelector('#latestStatus'),
      latestSub: document.querySelector('#latestSub'),
      runCount: document.querySelector('#runCount'),
      passedRuns: document.querySelector('#passedRuns'),
      failedRuns: document.querySelector('#failedRuns'),
      failedTests: document.querySelector('#failedTests'),
      flakyTests: document.querySelector('#flakyTests'),
      healthBadge: document.querySelector('#healthBadge'),
      healthScore: document.querySelector('#healthScore'),
      healthMeter: document.querySelector('#healthMeter'),
      healthSummary: document.querySelector('#healthSummary'),
      signalGrid: document.querySelector('#signalGrid'),
      recommendTitle: document.querySelector('#recommendTitle'),
      recommendReason: document.querySelector('#recommendReason'),
      recommendCommand: document.querySelector('#recommendCommand'),
      applyRecommendationButton: document.querySelector('#applyRecommendationButton'),
      runRecommendationButton: document.querySelector('#runRecommendationButton'),
      hotspotList: document.querySelector('#hotspotList'),
      latestReportLink: document.querySelector('#latestReportLink'),
      targetSelect: document.querySelector('#targetSelect'),
      fileList: document.querySelector('#fileList'),
      reportList: document.querySelector('#reportList'),
      testCountMeta: document.querySelector('#testCountMeta'),
      reportCountMeta: document.querySelector('#reportCountMeta'),
      runButton: document.querySelector('#runButton'),
      stopButton: document.querySelector('#stopButton'),
      stopStudioButton: document.querySelector('#stopStudioButton'),
      refreshButton: document.querySelector('#refreshButton'),
      presetGroup: document.querySelector('#presetGroup'),
      traceCheck: document.querySelector('#traceCheck'),
      smartCheck: document.querySelector('#smartCheck'),
      ciCheck: document.querySelector('#ciCheck'),
      hideCheck: document.querySelector('#hideCheck'),
      workersInput: document.querySelector('#workersInput'),
      retriesInput: document.querySelector('#retriesInput'),
      commandPreview: document.querySelector('#commandPreview'),
      testFilterInput: document.querySelector('#testFilterInput'),
      clearTestFilterButton: document.querySelector('#clearTestFilterButton'),
      reportFilterInput: document.querySelector('#reportFilterInput'),
      clearReportFilterButton: document.querySelector('#clearReportFilterButton'),
      runMeta: document.querySelector('#runMeta'),
      runStatus: document.querySelector('#runStatus'),
      runTargetFact: document.querySelector('#runTargetFact'),
      runStartedFact: document.querySelector('#runStartedFact'),
      runExitFact: document.querySelector('#runExitFact'),
      runModeFact: document.querySelector('#runModeFact'),
      consoleOutput: document.querySelector('#consoleOutput'),
      executionPanel: document.querySelector('#executionPanel'),
      consolePanel: document.querySelector('#consolePanel'),
      execBarPassed: document.querySelector('#execBarPassed'),
      execBarFailed: document.querySelector('#execBarFailed'),
      execBarFlaky: document.querySelector('#execBarFlaky'),
      execProgressLabel: document.querySelector('#execProgressLabel'),
      execTestList: document.querySelector('#execTestList'),
      execFilters: document.querySelector('#execFilters'),
      execSearchRow: document.querySelector('#execSearchRow'),
      execSearchInput: document.querySelector('#execSearchInput'),
      execSearchClear: document.querySelector('#execSearchClear'),
      liveFrameImage: document.querySelector('#liveFrameImage'),
      liveFramePlaceholder: document.querySelector('#liveFramePlaceholder'),
      browserShell: document.querySelector('.browser-shell'),
      liveFrameTab: document.querySelector('#liveFrameTab'),
      liveFrameUrl: document.querySelector('#liveFrameUrl'),
      liveFrameTitle: document.querySelector('#liveFrameTitle'),
      liveFrameMeta: document.querySelector('#liveFrameMeta'),
      liveFrameStatus: document.querySelector('#liveFrameStatus'),
      liveFrameLive: document.querySelector('#liveFrameLive'),
      playerPlayButton: document.querySelector('#playerPlayButton'),
      frameScrubber: document.querySelector('#frameScrubber'),
      playerTime: document.querySelector('#playerTime'),
      playerSpeedSelect: document.querySelector('#playerSpeedSelect'),
      playerLiveButton: document.querySelector('#playerLiveButton'),
      runElapsed: document.querySelector('#runElapsed')
    };

    const sseState = {
      source: null,
      liveTests: new Map(),
      liveTotal: 0,
      runId: null,
      activeTab: 'execution',
      filter: 'all',
      search: '',
      selectedTest: null,
      collapsedFiles: new Set(),
      elapsedTimer: null,
      runStartedAt: null,
      frames: [],
      selectedFrame: null,
      followFrames: true,
      playerRunning: false,
      playerTimer: null,
      playbackMs: 800,
      scrubbing: false,
      keepPlayerVisible: false
    };

    els.refreshButton.addEventListener('click', () => loadState());
    els.runButton.addEventListener('click', () => startRun());
    els.stopButton.addEventListener('click', () => stopRun());
    els.stopStudioButton.addEventListener('click', () => stopStudio());
    els.applyRecommendationButton.addEventListener('click', () => applyRecommendation(false));
    els.runRecommendationButton.addEventListener('click', () => applyRecommendation(true));
    els.targetSelect.addEventListener('change', updateCommandPreview);
    els.traceCheck.addEventListener('change', updateCommandPreview);
    els.smartCheck.addEventListener('change', updateCommandPreview);
    els.ciCheck.addEventListener('change', updateCommandPreview);
    els.hideCheck.addEventListener('change', updateCommandPreview);
    els.workersInput.addEventListener('input', updateCommandPreview);
    els.retriesInput.addEventListener('input', updateCommandPreview);
    els.testFilterInput.addEventListener('input', () => renderFiles(state.tests));
    els.reportFilterInput.addEventListener('input', () => renderReports(state.reports));
    els.clearTestFilterButton.addEventListener('click', () => {
      els.testFilterInput.value = '';
      renderFiles(state.tests);
    });
    els.clearReportFilterButton.addEventListener('click', () => {
      els.reportFilterInput.value = '';
      renderReports(state.reports);
    });
    els.presetGroup.querySelectorAll('[data-preset]').forEach(button => {
      button.addEventListener('click', () => applyPreset(button.getAttribute('data-preset')));
    });

    document.querySelectorAll('.run-tab').forEach(function(btn) {
      btn.addEventListener('click', function() { setRunTab(btn.getAttribute('data-tab')); });
    });

    document.querySelectorAll('.exec-filter-chip').forEach(function(btn) {
      btn.addEventListener('click', function() {
        sseState.filter = btn.getAttribute('data-filter');
        document.querySelectorAll('.exec-filter-chip').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-filter') === sseState.filter);
        });
        renderExecution();
      });
    });

    els.execSearchInput.addEventListener('input', function() {
      sseState.search = els.execSearchInput.value.trim().toLowerCase();
      renderExecution();
    });

    els.execSearchClear.addEventListener('click', function() {
      sseState.search = '';
      els.execSearchInput.value = '';
      renderExecution();
    });

    els.playerPlayButton.addEventListener('click', () => togglePlayback());
    els.frameScrubber.addEventListener('pointerdown', () => {
      sseState.scrubbing = true;
      stopPlayback(false);
    });
    els.frameScrubber.addEventListener('input', () => {
      seekToScrubber(true);
    });
    els.frameScrubber.addEventListener('change', () => {
      seekToScrubber(false);
    });
    els.frameScrubber.addEventListener('pointerup', () => {
      seekToScrubber(false);
    });
    els.frameScrubber.addEventListener('pointercancel', () => {
      sseState.scrubbing = false;
      renderFrameViewer();
    });
    els.playerSpeedSelect.addEventListener('change', () => {
      sseState.playbackMs = Number(els.playerSpeedSelect.value) || 800;
      if (sseState.playerRunning) {
        schedulePlaybackTick();
      }
      renderFrameViewer();
    });
    els.playerLiveButton.addEventListener('click', () => {
      stopPlayback();
      sseState.followFrames = true;
      if (sseState.frames.length) {
        sseState.selectedFrame = sseState.frames[sseState.frames.length - 1].index;
      }
      renderFrameViewer();
    });

    document.addEventListener('keydown', function(ev) {
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT') return;
      if (ev.key === 'r' || ev.key === 'R') { if (!els.runButton.disabled) startRun(); }
      if (ev.key === 's' || ev.key === 'S') { if (!els.stopButton.disabled) stopRun(); }
      if (ev.key === ' ') { ev.preventDefault(); togglePlayback(); }
      if (ev.key === 'Escape') { sseState.selectedTest = null; renderExecution(); }
    });

    loadState();
    state.refreshTimer = setInterval(loadState, 2500);
    connectSse();

    async function loadState() {
      const data = await fetchJson('/api/state');
      state.tests = data.tests;
      state.reports = data.reports;
      state.insights = data.insights;

      renderProject(data);
      renderInsights(data.insights);
      renderTargets(data.tests);
      renderFiles(data.tests);
      renderReports(data.reports);
      renderRun(data.activeRun);
      updateCommandPreview();
    }

    function renderProject(data) {
      els.projectMeta.textContent = data.project.name;
      els.testDirMeta.textContent = 'Test dir: ' + data.project.testDir;
      els.reportsDirMeta.textContent = 'Reports: ' + data.project.reportsDir;
      els.configMeta.textContent = 'Workers: ' + data.config.workers + ' | Retries: ' + data.config.retries + ' | Browser: ' + data.config.browserDisplay;
      els.latestStatus.textContent = data.totals.latestStatus.toUpperCase();
      els.latestSub.textContent = data.totals.totalTests + ' tests in latest run';
      els.runCount.textContent = data.totals.runs;
      els.passedRuns.textContent = data.totals.passedRuns;
      els.failedRuns.textContent = data.totals.failedRuns;
      els.failedTests.textContent = data.totals.failedTests;
      els.flakyTests.textContent = data.totals.flakyTests;
      els.latestMetric.className = 'metric ' + (data.totals.latestStatus === 'passed' ? 'pass' : data.totals.latestStatus === 'failed' ? 'fail' : 'warn');

      if (data.totals.latestReportUrl) {
        els.latestReportLink.href = data.totals.latestReportUrl;
        els.latestReportLink.style.pointerEvents = '';
        els.latestReportLink.style.opacity = '';
      } else {
        els.latestReportLink.href = '#';
        els.latestReportLink.style.pointerEvents = 'none';
        els.latestReportLink.style.opacity = '0.5';
      }

      if (!els.workersInput.value && data.config.workers) {
        els.workersInput.placeholder = String(data.config.workers);
      }

      if (!els.retriesInput.value && data.config.retries !== undefined) {
        els.retriesInput.placeholder = String(data.config.retries);
      }
    }

    function renderInsights(insights) {
      if (!insights) {
        return;
      }

      const health = insights.health || {};
      const score = Number(health.score || 0);
      const healthTone = getHealthTone(score);
      els.healthScore.textContent = String(score);
      els.healthBadge.textContent = health.label || 'unknown';
      els.healthBadge.className = 'badge ' + healthTone;
      els.healthSummary.textContent = health.summary || 'No insight available yet.';
      els.healthMeter.style.width = Math.max(0, Math.min(100, score)) + '%';
      els.healthMeter.style.background = healthTone === 'passed' ? 'var(--green)' : healthTone === 'failed' ? 'var(--red)' : 'var(--amber)';

      els.signalGrid.innerHTML = (insights.signals || []).map(signal => {
        return '<div class="signal">' +
          '<span>' + escapeHtml(signal.label) + '</span>' +
          '<strong>' + escapeHtml(signal.value) + '</strong>' +
          '<small>' + escapeHtml(signal.detail) + '</small>' +
          '</div>';
      }).join('');

      const recommendation = insights.recommendation || {};
      els.recommendTitle.textContent = recommendation.title || 'Recommended Next Run';
      els.recommendReason.textContent = recommendation.reason || 'Run a test to build report history.';
      els.recommendCommand.textContent = buildRecommendationCommand(recommendation);
      const canRecommend = Boolean(recommendation.target);
      els.applyRecommendationButton.disabled = !canRecommend;
      els.runRecommendationButton.disabled = !canRecommend;

      const hotspots = insights.hotspots || [];
      if (!hotspots.length) {
        els.hotspotList.innerHTML = '<div class="muted small">No risky files detected yet.</div>';
        return;
      }

      els.hotspotList.innerHTML = hotspots.map(item => {
        const tone = item.score >= 65 ? 'fail' : item.score >= 35 ? 'warn' : '';
        const failureText = item.failures + ' failure' + (item.failures === 1 ? '' : 's');
        const flakyText = item.flaky + ' flaky';
        const speedText = item.avgDurationMs ? formatDuration(item.avgDurationMs) + ' avg' : 'no timing';
        return '<div class="hotspot">' +
          '<div>' +
            '<div class="hotspot-title">' + escapeHtml(item.file) + '</div>' +
            '<div class="hotspot-meta">' + failureText + ' | ' + flakyText + ' | ' + speedText + '</div>' +
          '</div>' +
          '<div class="risk-chip ' + tone + '">' + item.score + '</div>' +
          '</div>';
      }).join('');
    }

    function buildRecommendationCommand(recommendation) {
      const args = ['orbittest', 'run'];

      if (recommendation.target) {
        args.push(recommendation.target);
      }

      if (recommendation.trace) args.push('--trace');
      if (recommendation.smartReport) args.push('--smart-report');
      if (recommendation.retries !== null && recommendation.retries !== undefined) args.push('--retries', String(recommendation.retries));
      args.push('--hide-browser');

      return args.map(part => part.includes(' ') ? '"' + part + '"' : part).join(' ');
    }

    function applyRecommendation(runNow) {
      const recommendation = state.insights && state.insights.recommendation;

      if (!recommendation || !recommendation.target) {
        return;
      }

      const hasTarget = Array.from(els.targetSelect.options).some(option => option.value === recommendation.target);

      if (hasTarget) {
        els.targetSelect.value = recommendation.target;
      }

      els.traceCheck.checked = Boolean(recommendation.trace);
      els.smartCheck.checked = Boolean(recommendation.smartReport);
      els.ciCheck.checked = false;
      els.hideCheck.checked = true;

      if (recommendation.retries !== null && recommendation.retries !== undefined) {
        els.retriesInput.value = String(recommendation.retries);
      }

      updateCommandPreview();

      if (runNow) {
        startRun();
      }
    }

    function getHealthTone(score) {
      if (score >= 85) return 'passed';
      if (score >= 60) return 'flaky';
      return 'failed';
    }

    function renderTargets(files) {
      const current = els.targetSelect.value;
      const options = ['<option value="all">All tests</option>'].concat(
        files.map(file => '<option value="' + escapeAttr(file.file) + '">' + escapeHtml(file.file) + '</option>')
      );

      els.targetSelect.innerHTML = options.join('');

      if (current && Array.from(els.targetSelect.options).some(option => option.value === current)) {
        els.targetSelect.value = current;
      }
    }

    function renderFiles(files) {
      const query = els.testFilterInput.value.trim().toLowerCase();
      const visibleFiles = query
        ? files.filter(file => {
          const haystack = [file.file].concat(file.tests).join(' ').toLowerCase();
          return haystack.includes(query);
        })
        : files;
      const testCount = files.reduce((total, file) => total + file.tests.length, 0);
      els.testCountMeta.textContent = files.length + ' files | ' + testCount + ' tests';

      if (!visibleFiles.length) {
        els.fileList.innerHTML = '<div class="muted">No test files found.</div>';
        return;
      }

      els.fileList.innerHTML = visibleFiles.map(file => {
        const tests = file.tests.length
          ? '<ol class="test-list">' + file.tests.map(name => '<li>' + escapeHtml(name) + '</li>').join('') + '</ol>'
          : '<div class="muted small">No test names detected.</div>';

        return '<article class="file-card">' +
          '<div class="file-head">' +
          '<div><div class="file-name">' + escapeHtml(file.file) + '</div><div class="row-stats"><span>' + file.tests.length + ' test' + (file.tests.length === 1 ? '' : 's') + '</span></div></div>' +
          '<button type="button" data-run-file="' + escapeAttr(file.file) + '">Run</button>' +
          '</div>' +
          tests +
          '</article>';
      }).join('');

      els.fileList.querySelectorAll('[data-run-file]').forEach(button => {
        button.addEventListener('click', () => {
          els.targetSelect.value = button.getAttribute('data-run-file');
          startRun();
        });
      });
    }

    function renderReports(reports) {
      const query = els.reportFilterInput.value.trim().toLowerCase();
      const visibleReports = query
        ? reports.filter(report => {
          const failures = report.failedTests.map(test => test.name + ' ' + test.message).join(' ');
          return [report.runId, report.status, report.browserDisplay, report.shard || '', failures].join(' ').toLowerCase().includes(query);
        })
        : reports;
      els.reportCountMeta.textContent = reports.length + ' reports';

      if (!visibleReports.length) {
        els.reportList.innerHTML = '<div class="muted">No reports yet. Run a test to create one.</div>';
        return;
      }

      els.reportList.innerHTML = visibleReports.map(report => {
        const failures = report.failedTests.length
          ? '<ul class="failure-list">' + report.failedTests.map(test => '<li><strong>' + escapeHtml(test.name) + '</strong>: ' + escapeHtml(test.message) + '</li>').join('') + '</ul>'
          : '';
        const barStyle = '--pass:' + Math.max(0, report.passed) + 'fr;--fail:' + Math.max(0, report.failed) + 'fr;--flaky:' + Math.max(0, report.flaky) + 'fr;--skip:' + Math.max(0, report.skipped) + 'fr;';

        return '<article class="report-card">' +
          '<div class="report-head">' +
          '<div><div class="report-title">' + escapeHtml(report.runId) + '</div><div class="muted small">' + formatDate(report.endedAt || report.startedAt) + ' | ' + formatDuration(report.durationMs) + ' | browser ' + escapeHtml(report.browserDisplay) + '</div></div>' +
          '<span class="badge ' + escapeAttr(report.status) + '">' + escapeHtml(report.status) + '</span>' +
          '</div>' +
          '<div class="row-stats"><span>Total ' + report.total + '</span><span>Passed ' + report.passed + '</span><span>Failed ' + report.failed + '</span><span>Flaky ' + report.flaky + '</span><span>Skipped ' + report.skipped + '</span>' + (report.shard ? '<span>Shard ' + escapeHtml(report.shard) + '</span>' : '') + '</div>' +
          '<div class="result-bar" style="' + escapeAttr(barStyle) + '" aria-label="Result distribution"><span></span><span></span><span></span><span></span></div>' +
          failures +
          '<div class="report-actions">' +
          '<a href="' + escapeAttr(report.htmlUrl) + '" target="_blank" rel="noreferrer">HTML</a>' +
          '<a href="' + escapeAttr(report.jsonUrl) + '" target="_blank" rel="noreferrer">JSON</a>' +
          '<a href="' + escapeAttr(report.junitUrl) + '" target="_blank" rel="noreferrer">JUnit</a>' +
          '</div>' +
          '</article>';
      }).join('');
    }

    function renderRun(run) {
      const running = run && (run.status === 'running' || run.status === 'stopping');

      els.runButton.disabled = running;
      els.stopButton.disabled = !running;

      if (!run) {
        els.runStatus.textContent = 'idle';
        els.runStatus.className = 'badge unknown';
        els.runMeta.textContent = 'No active run.';
        els.runTargetFact.textContent = '-';
        els.runStartedFact.textContent = '-';
        els.runExitFact.textContent = '-';
        els.runModeFact.textContent = '-';
        els.consoleOutput.textContent = 'Run output will appear here.';
        if (!sseState.frames.length) {
          renderFrameViewer();
        }
        return;
      }

      els.runStatus.textContent = run.status;
      els.runStatus.className = 'badge ' + run.status;
      els.runMeta.textContent = run.command + ' | ' + formatDate(run.startedAt);
      els.runTargetFact.textContent = run.target || 'all tests';
      els.runStartedFact.textContent = formatDate(run.startedAt);
      els.runExitFact.textContent = run.exitCode === null || run.exitCode === undefined ? '-' : String(run.exitCode);
      els.runModeFact.textContent = getRunModeLabel(run.command);
      els.consoleOutput.textContent = run.output || (running ? 'Starting run...' : 'No output captured.');
      els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;

      // Start/stop elapsed timer based on run state
      if (running) {
        if (!sseState.elapsedTimer) {
          startElapsedTimer(new Date(run.startedAt).getTime());
        }
      } else {
        stopElapsedTimer();
        els.runElapsed.style.display = 'none';
      }

      // Sync live test state from polling snapshot when SSE hasn't populated it yet
      if (run.liveTests && run.liveTests.length > 0 && sseState.liveTests.size === 0) {
        sseState.runId = run.id;
        sseState.liveTotal = run.liveTotal || 0;
        for (var i = 0; i < run.liveTests.length; i++) {
          var t = run.liveTests[i];
          sseState.liveTests.set(t.index, t);
        }
        renderExecution();
      }

      if (run.frames && run.frames.length > 0 && sseState.frames.length === 0) {
        sseState.frames = run.frames.slice();
        sseState.selectedFrame = sseState.frames[sseState.frames.length - 1].index;
        renderFrameViewer();
      }
    }

    function applyPreset(preset) {
      state.preset = preset;
      els.presetGroup.querySelectorAll('[data-preset]').forEach(button => {
        button.classList.toggle('active', button.getAttribute('data-preset') === preset);
      });

      if (preset === 'local') {
        els.traceCheck.checked = false;
        els.smartCheck.checked = false;
        els.ciCheck.checked = false;
        els.hideCheck.checked = true;
      }

      if (preset === 'evidence') {
        els.traceCheck.checked = true;
        els.smartCheck.checked = true;
        els.ciCheck.checked = false;
        els.hideCheck.checked = true;
      }

      if (preset === 'ci') {
        els.traceCheck.checked = false;
        els.smartCheck.checked = false;
        els.ciCheck.checked = true;
        els.hideCheck.checked = true;
      }

      updateCommandPreview();
    }

    function updateCommandPreview() {
      const args = ['orbittest', 'run'];
      const target = els.targetSelect.value;

      if (target && target !== 'all') {
        args.push(target);
      }

      if (els.traceCheck.checked) args.push('--trace');
      if (els.smartCheck.checked) args.push('--smart-report');
      if (els.ciCheck.checked) args.push('--ci');
      args.push('--hide-browser');
      if (els.workersInput.value) args.push('--workers', els.workersInput.value);
      if (els.retriesInput.value !== '') args.push('--retries', els.retriesInput.value);

      els.commandPreview.textContent = args.map(part => part.includes(' ') ? '"' + part + '"' : part).join(' ');
    }

    function getRunModeLabel(command) {
      const text = String(command || '');
      const labels = [];

      if (text.includes('--ci')) labels.push('CI');
      if (text.includes('--trace')) labels.push('Trace');
      if (text.includes('--smart-report')) labels.push('Smart');
      if (text.includes('--hide-browser')) labels.push('Embedded');
      if (text.includes('--show-browser')) labels.push('Visible');

      return labels.join(', ') || 'Local';
    }

    async function startRun() {
      const target = els.targetSelect.value || 'all';
      const body = {
        target,
        trace: els.traceCheck.checked,
        smartReport: els.smartCheck.checked,
        ci: els.ciCheck.checked,
        hideBrowser: true,
        workers: els.workersInput.value || null,
        retries: els.retriesInput.value === '' ? null : els.retriesInput.value
      };

      stopPlayback(false);
      sseState.liveTests.clear();
      sseState.liveTotal = 0;
      sseState.frames = [];
      sseState.runId = null;
      sseState.selectedTest = null;
      sseState.selectedFrame = null;
      sseState.followFrames = true;
      sseState.scrubbing = false;
      sseState.keepPlayerVisible = true;
      sseState.filter = 'all';
      sseState.search = '';
      els.execSearchInput.value = '';
      document.querySelectorAll('.exec-filter-chip').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-filter') === 'all');
      });
      startElapsedTimer(Date.now());
      renderFrameViewer();
      renderExecution();
      setRunTab('execution');
      ensurePlayerInViewport();

      await fetchJson('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await loadState();
    }

    async function stopRun() {
      await fetchJson('/api/run/stop', { method: 'POST' });
      await loadState();
    }

    async function stopStudio() {
      const ok = window.confirm('Stop OrbitTest UI and release this port? Any running test will be stopped.');

      if (!ok) {
        return;
      }

      if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
      }

      els.stopStudioButton.disabled = true;
      els.stopStudioButton.textContent = 'Stopping...';

      try {
        const response = await fetch('/api/ui/stop', {
          method: 'POST',
          keepalive: true
        });

        if (!response.ok) {
          throw new Error('Could not stop OrbitTest UI.');
        }
      } catch (error) {
        els.stopStudioButton.disabled = false;
        els.stopStudioButton.textContent = 'Stop UI';
        throw error;
      }

      closeStudioTab();
    }

    function closeStudioTab() {
      document.title = 'OrbitTest UI';
      document.body.innerHTML = '';
      document.documentElement.style.background = '#fff';
      document.body.style.background = '#fff';

      window.open('', '_self');
      window.close();

      setTimeout(() => {
        window.location.replace('about:blank');
      }, 250);
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    }

    function formatDate(value) {
      if (!value) return 'unknown time';
      return new Date(value).toLocaleString();
    }

    function formatDuration(ms) {
      if (!ms) return '0ms';
      return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(2) + 's';
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
      return escapeHtml(value);
    }

    function setRunTab(tab) {
      sseState.activeTab = tab;
      document.querySelectorAll('.run-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
      });
      els.executionPanel.style.display = tab === 'execution' ? '' : 'none';
      els.consolePanel.style.display = tab === 'console' ? '' : 'none';
    }

    function ensurePlayerInViewport() {
      var viewer = document.querySelector('#uiViewer');
      if (!viewer) return;

      var rect = viewer.getBoundingClientRect();
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      var visibleTop = 16;
      var visibleBottom = Math.max(visibleTop, viewportHeight - 24);

      if (rect.top >= visibleTop && rect.bottom <= visibleBottom) {
        return;
      }

      var targetTop = window.scrollY + rect.top - 18;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'auto'
      });
    }

    function startElapsedTimer(startMs) {
      stopElapsedTimer();
      sseState.runStartedAt = startMs;
      function tick() {
        if (!sseState.runStartedAt || !els.runElapsed) return;
        var ms = Date.now() - sseState.runStartedAt;
        var s = Math.floor(ms / 1000);
        var frac = Math.floor((ms % 1000) / 100);
        els.runElapsed.textContent = s + '.' + frac + 's';
        els.runElapsed.style.display = '';
      }
      tick();
      sseState.elapsedTimer = setInterval(tick, 100);
    }

    function stopElapsedTimer() {
      if (sseState.elapsedTimer) { clearInterval(sseState.elapsedTimer); sseState.elapsedTimer = null; }
      sseState.runStartedAt = null;
    }

    function connectSse() {
      if (sseState.source) { sseState.source.close(); sseState.source = null; }
      var source = new EventSource('/api/events');
      sseState.source = source;
      source.onmessage = function(ev) {
        try { handleLiveEvent(JSON.parse(ev.data)); } catch (_) {}
      };
      source.onerror = function() {};
    }

    function handleLiveEvent(event) {
      if (event.type === 'snapshot') {
        sseState.runId = event.runId || null;
        sseState.liveTotal = event.liveTotal || 0;
        sseState.liveTests.clear();
        (event.liveTests || []).forEach(function(t) { sseState.liveTests.set(t.index, t); });
        if (event.frames && event.frames.length) {
          sseState.frames = event.frames.slice();
          if (sseState.followFrames || sseState.selectedFrame === null) {
            sseState.selectedFrame = sseState.frames[sseState.frames.length - 1].index;
          }
        }
      } else if (event.type === 'run:plan') {
        sseState.runId = event.runId || null;
        sseState.liveTotal = event.total || 0;
        sseState.liveTests.clear();
        sseState.frames = [];
        sseState.selectedFrame = null;
        sseState.followFrames = true;
        sseState.scrubbing = false;
        sseState.keepPlayerVisible = true;
        (event.tests || []).forEach(function(pt) {
          sseState.liveTests.set(pt.index, {
            index: pt.index, name: pt.name, file: pt.file || null,
            status: 'queued', attempt: 1, retries: null, durationMs: null, error: null, artifacts: null,
            frameCount: 0, lastFrame: null
          });
        });
      } else if (event.type === 'test:start') {
        var prev = sseState.liveTests.get(event.index) || {};
        sseState.liveTests.set(event.index, Object.assign({}, prev, {
          index: event.index, name: event.name || prev.name, file: event.file || prev.file || null,
          status: 'running', durationMs: null, error: null
        }));
      } else if (event.type === 'test:retry') {
        var prevR = sseState.liveTests.get(event.index) || {};
        sseState.liveTests.set(event.index, Object.assign({}, prevR, {
          status: 'running', attempt: event.attempt, retries: event.retries, durationMs: null, error: null
        }));
      } else if (event.type === 'test:end') {
        var prevE = sseState.liveTests.get(event.index) || {};
        sseState.liveTests.set(event.index, Object.assign({}, prevE, {
          status: event.status || 'unknown',
          durationMs: event.durationMs != null ? event.durationMs : null,
          error: event.error || null,
          artifacts: event.artifacts || null
        }));
      } else if (event.type === 'frame' && event.frame) {
        sseState.frames.push(event.frame);
        if (sseState.frames.length > 500) sseState.frames.shift();
        if (sseState.followFrames || sseState.selectedFrame === null) {
          sseState.selectedFrame = event.frame.index;
        }
        if (sseState.keepPlayerVisible) {
          ensurePlayerInViewport();
          sseState.keepPlayerVisible = false;
        }
        if (event.frame.testIndex) {
          var prevF = sseState.liveTests.get(event.frame.testIndex) || {};
          sseState.liveTests.set(event.frame.testIndex, Object.assign({}, prevF, {
            lastFrame: event.frame,
            frameCount: (prevF.frameCount || 0) + 1
          }));
        }
      } else if (event.type === 'run:end') {
        stopElapsedTimer();
        if (els.runElapsed) els.runElapsed.style.display = 'none';
      }
      renderFrameViewer();
      renderExecution();
    }

    function togglePlayback() {
      if (sseState.playerRunning) {
        stopPlayback();
        renderFrameViewer();
        return;
      }

      startPlayback();
    }

    function seekToScrubber(isDragging) {
      stopPlayback(false);
      sseState.scrubbing = Boolean(isDragging);
      selectFrameByPosition(Number(els.frameScrubber.value), false);
    }

    function startPlayback() {
      stopPlayback(false);
      sseState.scrubbing = false;

      if (sseState.frames.length < 2) {
        renderFrameViewer();
        return;
      }

      var position = selectedFramePosition();
      if (position >= sseState.frames.length - 1) {
        position = 0;
        selectFrameByPosition(position, false, false);
      }

      sseState.playerRunning = true;
      sseState.followFrames = false;
      schedulePlaybackTick();
      renderFrameViewer();
    }

    function schedulePlaybackTick() {
      if (sseState.playerTimer) {
        clearTimeout(sseState.playerTimer);
        sseState.playerTimer = null;
      }

      if (!sseState.playerRunning) {
        return;
      }

      sseState.playerTimer = setTimeout(function() {
        advancePlayback();
      }, sseState.playbackMs);
    }

    function advancePlayback() {
      if (!sseState.playerRunning) {
        return;
      }

      var current = selectedFramePosition();
      var next = current + 1;

      if (next >= sseState.frames.length) {
        stopPlayback(false);
        renderFrameViewer();
        return;
      }

      selectFrameByPosition(next, false, false);
      renderFrameViewer();
      schedulePlaybackTick();
    }

    function stopPlayback(renderNow) {
      if (sseState.playerTimer) {
        clearTimeout(sseState.playerTimer);
        sseState.playerTimer = null;
      }

      sseState.playerRunning = false;

      if (renderNow !== false) {
        renderFrameViewer();
      }
    }

    function selectedFramePosition() {
      var frames = sseState.frames || [];
      if (!frames.length) return 0;

      var index = frames.findIndex(function(frame) {
        return frame.index === sseState.selectedFrame;
      });

      return index >= 0 ? index : frames.length - 1;
    }

    function selectFrameByPosition(position, followLatest, renderNow) {
      var frames = sseState.frames || [];
      if (!frames.length) {
        sseState.selectedFrame = null;
        sseState.followFrames = true;
      } else {
        var nextPosition = Math.max(0, Math.min(frames.length - 1, Number(position) || 0));
        sseState.selectedFrame = frames[nextPosition].index;
        sseState.followFrames = Boolean(followLatest);
      }

      if (renderNow !== false) {
        renderFrameViewer();
      }
    }

    function renderFrameViewer() {
      var frames = sseState.frames || [];
      var selected = null;
      var position = 0;

      if (frames.length) {
        position = selectedFramePosition();
        selected = frames[position] || frames[frames.length - 1];
        sseState.selectedFrame = selected.index;
      }

      var hasFrames = frames.length > 0;
      var canPlay = frames.length > 1;
      els.playerPlayButton.classList.toggle('playing', Boolean(sseState.playerRunning));
      els.playerPlayButton.setAttribute('aria-label', sseState.playerRunning ? 'Pause recording' : 'Play recording');
      els.playerPlayButton.disabled = !canPlay;
      els.frameScrubber.max = String(Math.max(0, frames.length - 1));
      if (!sseState.scrubbing) {
        els.frameScrubber.value = String(frames.length ? position : 0);
      }
      els.frameScrubber.disabled = !canPlay;
      els.playerSpeedSelect.disabled = !canPlay;
      els.playerLiveButton.disabled = !hasFrames;
      els.playerLiveButton.classList.toggle('active', Boolean(sseState.followFrames));
      els.liveFrameLive.textContent = hasFrames ? (sseState.followFrames ? 'Live' : 'Replay') : 'Idle';
      els.liveFrameLive.classList.toggle('live', Boolean(hasFrames && sseState.followFrames));
      els.playerTime.textContent = formatPlaybackTime(position, frames.length);

      if (!selected) {
        els.liveFrameImage.style.display = 'none';
        els.liveFrameImage.removeAttribute('src');
        els.liveFramePlaceholder.style.display = '';
        els.liveFramePlaceholder.textContent = 'Waiting for first frame.';
        els.liveFrameTitle.textContent = 'Live View';
        els.liveFrameMeta.textContent = '0 frames';
        els.liveFrameStatus.textContent = 'Ready';
        els.liveFrameTab.textContent = 'OrbitTest';
        els.liveFrameUrl.textContent = 'about:blank';
        updateBrowserFrameAspect(null);
        return;
      }

      if (selected.screenshot) {
        els.liveFrameImage.src = selected.screenshot;
        els.liveFrameImage.style.display = '';
        els.liveFramePlaceholder.style.display = 'none';
      } else {
        els.liveFrameImage.style.display = 'none';
        els.liveFrameImage.removeAttribute('src');
        els.liveFramePlaceholder.style.display = '';
        els.liveFramePlaceholder.textContent = selected.screenshotError || 'Frame capture unavailable.';
      }

      els.liveFrameTitle.textContent = selected.name || 'Captured step';
      els.liveFrameTab.textContent = selected.title || selected.testName || 'OrbitTest';
      els.liveFrameUrl.textContent = selected.url || 'about:blank';
      updateBrowserFrameAspect(selected);
      els.liveFrameStatus.textContent = selected.status || 'unknown';
      els.liveFrameMeta.textContent = [
        selected.testName || '',
        selected.viewport ? selected.viewport.width + 'x' + selected.viewport.height : '',
        selected.durationMs ? formatDuration(selected.durationMs) : '',
        frames.length + ' frame' + (frames.length === 1 ? '' : 's')
      ].filter(Boolean).join(' | ');
    }

    function updateBrowserFrameAspect(frame) {
      if (!els.browserShell) return;

      var width = Number(frame && (frame.screenshotWidth || frame.viewport?.width)) || 1366;
      var height = Number(frame && (frame.screenshotHeight || frame.viewport?.height)) || 768;

      if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
        width = 1366;
        height = 768;
      }

      els.browserShell.style.setProperty('--frame-ratio', width + ' / ' + height);
      els.browserShell.style.setProperty('--frame-shell-ratio', width + ' / ' + (height + 40));
    }

    function formatPlaybackTime(position, total) {
      var currentMs = Math.max(0, position) * sseState.playbackMs;
      var totalMs = Math.max(0, Math.max(0, total - 1)) * sseState.playbackMs;

      return formatClock(currentMs) + ' / ' + formatClock(totalMs);
    }

    function formatClock(ms) {
      var seconds = Math.ceil(Math.max(0, ms) / 1000);
      var minutes = Math.floor(seconds / 60);
      var rest = seconds % 60;

      return String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
    }

    function renderExecution() {
      var tests = [];
      sseState.liveTests.forEach(function(t) { tests.push(t); });
      tests.sort(function(a, b) { return a.index - b.index; });

      // ── counts ──────────────────────────────────────────────
      var countAll = tests.length;
      var countRunning = 0, countPassed = 0, countFailed = 0, countFlaky = 0;
      tests.forEach(function(t) {
        if (t.status === 'running') countRunning++;
        else if (t.status === 'passed') countPassed++;
        else if (t.status === 'flaky') { countFlaky++; countPassed++; }
        else if (t.status === 'failed') countFailed++;
      });

      function setChip(id, n) { var e = document.getElementById(id); if (e) e.textContent = n; }
      setChip('execCountAll', countAll);
      setChip('execCountRunning', countRunning);
      setChip('execCountPassed', countPassed);
      setChip('execCountFailed', countFailed);
      setChip('execCountFlaky', countFlaky);

      // ── progress bar ─────────────────────────────────────────
      var total = sseState.liveTotal || countAll;
      var doneCount = countPassed + countFailed;
      els.execBarPassed.style.width = (total > 0 ? (countPassed / total * 100).toFixed(1) : 0) + '%';
      els.execBarFailed.style.width = (total > 0 ? (countFailed / total * 100).toFixed(1) : 0) + '%';
      els.execBarFlaky.style.width  = (total > 0 ? (countFlaky  / total * 100).toFixed(1) : 0) + '%';

      var runningTest = null;
      for (var ri = 0; ri < tests.length; ri++) {
        if (tests[ri].status === 'running') { runningTest = tests[ri]; break; }
      }
      if (runningTest) {
        els.execProgressLabel.textContent = doneCount + '/' + total + ' · running: ' + runningTest.name;
      } else if (total > 0 && doneCount === total) {
        var lbl = doneCount + '/' + total + ' complete · ' + countPassed + ' passed';
        if (countFailed) lbl += ' · ' + countFailed + ' failed';
        if (countFlaky)  lbl += ' · ' + countFlaky  + ' flaky';
        els.execProgressLabel.textContent = lbl;
      } else if (total > 0) {
        els.execProgressLabel.textContent = doneCount + '/' + total + ' · queued';
      } else {
        els.execProgressLabel.textContent = 'Ready to run';
      }

      // ── show/hide filter + search chrome ─────────────────────
      var showChrome = tests.length > 0;
      els.execFilters.style.display = showChrome ? '' : 'none';
      els.execSearchRow.style.display = showChrome ? '' : 'none';

      if (!tests.length) {
        els.execTestList.innerHTML = '<div class="muted small" style="padding:16px 14px">Waiting for test plan…</div>';
        return;
      }

      // ── filter + search ───────────────────────────────────────
      var filterFn;
      switch (sseState.filter) {
        case 'running': filterFn = function(t) { return t.status === 'running'; }; break;
        case 'passed':  filterFn = function(t) { return t.status === 'passed' || t.status === 'flaky'; }; break;
        case 'failed':  filterFn = function(t) { return t.status === 'failed'; }; break;
        case 'flaky':   filterFn = function(t) { return t.status === 'flaky'; }; break;
        default:        filterFn = function() { return true; };
      }
      var sq = sseState.search;
      var visible = tests.filter(function(t) {
        return filterFn(t) && (!sq || t.name.toLowerCase().indexOf(sq) !== -1);
      });

      // ── file-level stats (all tests, not just filtered) ───────
      var allFileStats = new Map();
      tests.forEach(function(t) {
        var fk = t.file || '__none__';
        if (!allFileStats.has(fk)) allFileStats.set(fk, { total: 0, passed: 0, failed: 0, running: 0 });
        var fs = allFileStats.get(fk);
        fs.total++;
        if (t.status === 'passed' || t.status === 'flaky') fs.passed++;
        else if (t.status === 'failed') fs.failed++;
        else if (t.status === 'running') fs.running++;
      });

      // ── group visible tests by file ───────────────────────────
      var fileOrder = [];
      var fileGroups = new Map();
      visible.forEach(function(t) {
        var fk = t.file || '__none__';
        if (!fileGroups.has(fk)) { fileGroups.set(fk, []); fileOrder.push(fk); }
        fileGroups.get(fk).push(t);
      });

      // ── render ────────────────────────────────────────────────
      var html = '';
      if (!visible.length) {
        html = '<div class="muted small" style="padding:12px 14px">No tests match the current filter.</div>';
      } else {
        fileOrder.forEach(function(fk) {
          var groupTests = fileGroups.get(fk);
          var fs = allFileStats.get(fk) || { total: 0, passed: 0, failed: 0, running: 0 };
          var isCollapsed = sseState.collapsedFiles.has(fk);
          var statsHtml = '<span class="exec-file-count-strip"><span>' + fs.total + '</span>';
          if (fs.passed  > 0) statsHtml += '<span class="exec-file-stat pass">' + fs.passed  + ' ✓</span>';
          if (fs.failed  > 0) statsHtml += '<span class="exec-file-stat fail">' + fs.failed  + ' ✗</span>';
          if (fs.running > 0) statsHtml += '<span class="exec-file-stat run">running</span>';
          statsHtml += '</span>';

          html += '<div class="exec-file-group ' + (isCollapsed ? 'collapsed' : 'open') + '" data-file-group="' + escapeAttr(fk) + '">';
          html += '<div class="exec-file-head"><span class="exec-chevron">▶</span>';
          html += '<span class="exec-file-label">' + escapeHtml(fk === '__none__' ? '(unknown file)' : fk) + '</span>';
          html += statsHtml + '</div>';
          html += '<div class="exec-file-tests">';
          groupTests.forEach(function(t) { html += renderTestRow(t); });
          html += '</div></div>';
        });
      }

      els.execTestList.innerHTML = html;

      // wire collapse toggles
      els.execTestList.querySelectorAll('.exec-file-head').forEach(function(head) {
        head.addEventListener('click', function() {
          var grp = head.closest('.exec-file-group');
          var fk = grp.getAttribute('data-file-group');
          if (sseState.collapsedFiles.has(fk)) {
            sseState.collapsedFiles.delete(fk);
            grp.className = grp.className.replace('collapsed', 'open');
          } else {
            sseState.collapsedFiles.add(fk);
            grp.className = grp.className.replace('open', 'collapsed');
          }
        });
      });

      // wire test row selection
      els.execTestList.querySelectorAll('.exec-test-row').forEach(function(row) {
        row.addEventListener('click', function(ev) {
          ev.stopPropagation();
          var idx = parseInt(row.getAttribute('data-index'), 10);
          sseState.selectedTest = (sseState.selectedTest === idx) ? null : idx;
          renderExecution();
        });
      });

      // Keep the running row visible inside the list without moving the page.
      var runRow = els.execTestList.querySelector('.exec-test-row.running');
      if (runRow) {
        scrollRowIntoList(els.execTestList, runRow);
      }
    }

    function scrollRowIntoList(container, row) {
      if (!container || !row) return;

      var containerTop = container.scrollTop;
      var containerBottom = containerTop + container.clientHeight;
      var rowTop = row.offsetTop;
      var rowBottom = rowTop + row.offsetHeight;

      if (rowTop < containerTop) {
        container.scrollTop = rowTop;
      } else if (rowBottom > containerBottom) {
        container.scrollTop = rowBottom - container.clientHeight;
      }
    }

    function renderTestRow(t) {
      var icon;
      if (t.status === 'running')      icon = '<span class="spin exec-icon running">⟳</span>';
      else if (t.status === 'passed')  icon = '<span class="exec-icon passed">✓</span>';
      else if (t.status === 'flaky')   icon = '<span class="exec-icon flaky">∼</span>';
      else if (t.status === 'failed')  icon = '<span class="exec-icon failed">✗</span>';
      else                             icon = '<span class="exec-icon queued">·</span>';

      var isSelected = sseState.selectedTest === t.index;
      var rowCls = 'exec-test-row ' + t.status + (isSelected ? ' selected' : '');
      var nameCls = 'exec-name ' + t.status;
      var retryBadge = (t.attempt && t.attempt > 1)
        ? '<span class="exec-retry">retry ' + t.attempt + '/' + (t.retries || '?') + '</span>'
        : '';
      var dur = (t.durationMs != null)
        ? '<span class="exec-duration">' + formatDuration(t.durationMs) + '</span>'
        : '<span></span>';

      var html = '<div class="' + rowCls + '" data-index="' + t.index + '">' +
        icon + '<div class="' + nameCls + '">' + escapeHtml(t.name) + '</div>' + retryBadge + dur +
        '</div>';

      if (isSelected) {
        html += '<div class="exec-detail">';
        if (t.status === 'failed' && t.error) {
          html += '<div class="exec-detail-error">' + escapeHtml(t.error.message || 'Test failed') + '</div>';
          if (t.error.stack) {
            html += '<pre class="exec-detail-stack">' + escapeHtml(truncateStack(t.error.stack)) + '</pre>';
          }
        } else if (t.status === 'passed') {
          html += '<div class="exec-detail-pass">✓ Test passed</div>';
        } else if (t.status === 'flaky') {
          html += '<div class="exec-detail-pass">∼ Flaky — passed on retry ' + (t.attempt || '?') + '</div>';
        } else if (t.status === 'running') {
          html += '<div class="muted">Currently running…</div>';
        } else {
          html += '<div class="muted">No details yet.</div>';
        }
        if (t.artifacts && (t.artifacts.screenshot || t.artifacts.trace)) {
          html += '<div class="exec-detail-artifacts">';
          if (t.artifacts.screenshot) html += '<a class="exec-artifact-btn" href="' + escapeAttr(t.artifacts.screenshot) + '" target="_blank" rel="noreferrer">Screenshot</a>';
          if (t.artifacts.trace)      html += '<a class="exec-artifact-btn" href="' + escapeAttr(t.artifacts.trace)      + '" target="_blank" rel="noreferrer">Trace</a>';
          html += '</div>';
        }
        html += '</div>';
      }
      return html;
    }

    function truncateStack(stack) {
      if (!stack) return '';
      var lines = stack.split('\\n');
      if (lines.length <= 10) return stack;
      return lines.slice(0, 10).join('\\n') + '\\n  … (' + (lines.length - 10) + ' more lines)';
    }
  </script>
</body>
</html>`;
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(message);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return '';
  }
}

function safeMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (error) {
    return 0;
  }
}

function fileUrl(state, filePath) {
  return `/file/${path.relative(state.root, filePath).replace(/\\/g, '/')}`;
}

function isInsideDirectory(target, parent) {
  const relative = path.relative(parent, target);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.xml') return 'application/xml; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';

  return 'application/octet-stream';
}

function createStudioRunId(date) {
  return `ui-${date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}`;
}

function unescapeJsString(value) {
  return String(value)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function normalizeHost(value) {
  const host = String(value || DEFAULT_HOST).trim();
  return host || DEFAULT_HOST;
}

function normalizePort(value) {
  const number = Number(value ?? DEFAULT_PORT);

  if (!Number.isInteger(number) || number < 0 || number > 65535) {
    return DEFAULT_PORT;
  }

  return number;
}

module.exports = { startStudioServer };
