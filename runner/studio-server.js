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

  if (req.method === 'POST' && pathname === '/api/studio/stop') {
    scheduleStudioShutdown(state, 'requested from Studio UI');
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
    studio: {
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
  if (body.hideBrowser) args.push('--hide-browser');
  if (!body.hideBrowser && !body.ci) args.push('--show-browser');
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
    process: null
  };

  const child = spawn(process.execPath, [state.cliPath, ...args], {
    cwd: state.root,
    env: {
      ...process.env,
      FORCE_COLOR: '0'
    },
    windowsHide: Boolean(body.hideBrowser || body.ci)
  });

  run.process = child;
  state.activeRun = run;
  state.runHistory.push(run);

  child.stdout.on('data', chunk => {
    appendRunOutput(run, chunk);
  });

  child.stderr.on('data', chunk => {
    appendRunOutput(run, chunk);
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

function appendRunOutput(run, chunk) {
  run.output += chunk.toString();

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
    error: run.error
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
  <title>OrbitTest Studio</title>
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
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0) 230px),
        var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
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
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 16px 18px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: var(--shadow);
      position: sticky;
      top: 12px;
      z-index: 20;
    }

    .brand-lockup {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .logo-frame {
      width: 54px;
      height: 54px;
      display: grid;
      place-items: center;
      border: 1px solid #d8e2ee;
      border-radius: 12px;
      background: #fff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 9px 18px rgba(15, 23, 42, 0.08);
      flex: 0 0 auto;
    }

    .logo-frame img {
      width: 42px;
      height: 42px;
      display: block;
      object-fit: contain;
    }

    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 4px; color: var(--heading); font-size: 29px; line-height: 1.08; letter-spacing: 0; }
    h2 { margin-bottom: 14px; color: var(--heading); font-size: 20px; }
    h3 { margin-bottom: 8px; font-size: 15px; }

    .muted { color: var(--muted); }
    .small { font-size: 12px; }

    .eyebrow {
      margin-bottom: 2px;
      color: var(--teal);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .app-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
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
      max-width: 520px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
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
      border-radius: 12px;
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
      border-radius: 12px;
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

    @media (max-width: 980px) {
      main { padding: 14px; }
      .topbar, .run-controls { display: block; position: static; }
      .toolbar { justify-content: flex-start; margin-top: 12px; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .insight-grid { grid-template-columns: 1fr; }
      .run-strip, .split-controls { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 640px) {
      .summary { grid-template-columns: 1fr; }
      .brand-lockup { align-items: flex-start; }
      .logo-frame { width: 46px; height: 46px; }
      .logo-frame img { width: 36px; height: 36px; }
      h1 { font-size: 24px; }
      .signal-grid { grid-template-columns: 1fr; }
      .file-head, .report-head, .panel-head { display: block; }
      .file-head button, .panel-head .segmented { margin-top: 10px; }
      .search-row { grid-template-columns: 1fr; }
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
          <h1>OrbitTest Studio</h1>
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
        <button class="danger" type="button" id="stopStudioButton">Stop Studio</button>
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
            <label><input type="checkbox" id="hideCheck"> Hide Browser</label>
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
              <div class="muted" id="runMeta">No active run.</div>
            </div>
            <span class="badge unknown" id="runStatus">idle</span>
          </div>
          <div class="run-strip">
            <div class="run-fact"><span>Target</span><strong id="runTargetFact">-</strong></div>
            <div class="run-fact"><span>Started</span><strong id="runStartedFact">-</strong></div>
            <div class="run-fact"><span>Exit</span><strong id="runExitFact">-</strong></div>
            <div class="run-fact"><span>Mode</span><strong id="runModeFact">-</strong></div>
          </div>
          <pre class="console" id="consoleOutput">Run output will appear here.</pre>
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
      consoleOutput: document.querySelector('#consoleOutput')
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

    loadState();
    state.refreshTimer = setInterval(loadState, 2500);

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
      args.push('--show-browser');

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
      els.hideCheck.checked = false;

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
        els.hideCheck.checked = false;
      }

      if (preset === 'evidence') {
        els.traceCheck.checked = true;
        els.smartCheck.checked = true;
        els.ciCheck.checked = false;
        els.hideCheck.checked = false;
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
      if (els.hideCheck.checked) args.push('--hide-browser');
      if (!els.hideCheck.checked && !els.ciCheck.checked) args.push('--show-browser');
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
      if (text.includes('--hide-browser')) labels.push('Hidden');
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
        hideBrowser: els.hideCheck.checked,
        workers: els.workersInput.value || null,
        retries: els.retriesInput.value === '' ? null : els.retriesInput.value
      };

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
      const ok = window.confirm('Stop OrbitTest Studio and release this port? Any running test will be stopped.');

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
        const response = await fetch('/api/studio/stop', {
          method: 'POST',
          keepalive: true
        });

        if (!response.ok) {
          throw new Error('Could not stop OrbitTest Studio.');
        }
      } catch (error) {
        els.stopStudioButton.disabled = false;
        els.stopStudioButton.textContent = 'Stop Studio';
        throw error;
      }

      closeStudioTab();
    }

    function closeStudioTab() {
      document.title = 'OrbitTest Studio';
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
  return `studio-${date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}`;
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
