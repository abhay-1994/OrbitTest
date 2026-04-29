const fs = require('fs');
const path = require('path');

const tests = [];

function test(name, fn) {
  tests.push({
    name,
    fn,
    file: process.env.ORBITTEST_LOADING_FILE || null
  });
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
  const artifactsDir = path.join(reportsDir, 'artifacts', runId);
  const results = [];

  for (const [index, t] of tests.entries()) {
    console.log(`\nRunning: ${t.name}`);

    const Orbit = require('../orbit');
    const orbit = new Orbit();
    const testStartedAt = new Date();

    const result = {
      name: t.name,
      file: t.file,
      status: 'passed',
      startedAt: testStartedAt.toISOString(),
      endedAt: null,
      durationMs: 0,
      error: null,
      artifacts: {}
    };

    try {
      await orbit.launch();
      await t.fn(orbit);
      console.log(`Passed: ${t.name}`);
    } catch (error) {
      result.status = 'failed';
      result.error = serializeError(error);

      await attachFailureScreenshot({ orbit, result, artifactsDir, index });

      console.log(`Failed: ${t.name}`);
      console.error(`Reason: ${result.error.message}`);
    } finally {
      try {
        await orbit.close();
      } catch (error) {
        const closeError = serializeError(error);

        if (result.status === 'passed') {
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

      const testEndedAt = new Date();
      result.endedAt = testEndedAt.toISOString();
      result.durationMs = testEndedAt.getTime() - testStartedAt.getTime();
      results.push(result);
    }
  }

  const endedAt = new Date();
  const report = buildReport({
    startedAt,
    endedAt,
    results,
    runId,
    testFiles: options.testFiles || unique(tests.map(t => t.file).filter(Boolean))
  });

  const reportPaths = writeReports(report, reportsDir);
  printSummary(report, reportPaths);

  if (report.summary.status !== 'passed') {
    process.exitCode = 1;
  }

  return report;
}

function resetTests() {
  tests.length = 0;
}

function getTests() {
  return tests.slice();
}

async function attachFailureScreenshot({ orbit, result, artifactsDir, index }) {
  if (!orbit || typeof orbit.screenshot !== 'function') {
    return;
  }

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const screenshotPath = path.join(
      artifactsDir,
      `${String(index + 1).padStart(2, '0')}-${slugify(result.name)}.png`
    );

    await orbit.screenshot(screenshotPath);
    result.artifacts.screenshot = path.relative(process.cwd(), screenshotPath);
  } catch (error) {
    result.artifacts.screenshotError = serializeError(error).message;
  }
}

function buildReport({ startedAt, endedAt, results, runId, testFiles }) {
  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.filter(result => result.status === 'failed').length;
  const total = results.length;

  return {
    meta: {
      tool: 'OrbitTest',
      version: getPackageVersion(),
      node: process.version,
      platform: process.platform,
      runId,
      testFiles,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime()
    },
    summary: {
      total,
      passed,
      failed,
      status: total > 0 && failed === 0 ? 'passed' : 'failed'
    },
    results
  };
}

function writeReports(report, reportsDir) {
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, `${report.meta.runId}.json`);
  const htmlPath = path.join(reportsDir, `${report.meta.runId}.html`);
  const latestJsonPath = path.join(reportsDir, 'latest.json');
  const latestHtmlPath = path.join(reportsDir, 'latest.html');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, renderHtmlReport(report));
  fs.writeFileSync(latestHtmlPath, renderHtmlReport(report));

  return {
    json: path.relative(process.cwd(), jsonPath),
    html: path.relative(process.cwd(), htmlPath),
    latestJson: path.relative(process.cwd(), latestJsonPath),
    latestHtml: path.relative(process.cwd(), latestHtmlPath)
  };
}

function printSummary(report, reportPaths) {
  const { summary, meta } = report;

  console.log('\nOrbitTest Report');
  console.log('----------------');
  console.log(`Status: ${summary.status.toUpperCase()}`);
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
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

        if (result.artifacts.screenshot) {
          console.log(`   Screenshot: ${result.artifacts.screenshot}`);
        }
      });
  }

  console.log(`\nHTML report: ${reportPaths.latestHtml}`);
  console.log(`JSON report: ${reportPaths.latestJson}`);
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || ''
    };
  }

  return {
    name: 'Error',
    message: String(error),
    stack: ''
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

function renderHtmlReport(report) {
  const statusClass = report.summary.status === 'passed' ? 'passed' : 'failed';
  const rows = report.results.map(result => {
    const error = result.error
      ? `<details><summary>${escapeHtml(result.error.message)}</summary><pre>${escapeHtml(result.error.stack)}</pre></details>`
      : '<span class="muted">None</span>';
    const screenshot = result.artifacts.screenshot
      ? `<a href="${escapeHtml(toHref(result.artifacts.screenshot))}">View screenshot</a>`
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
          <th>Failure Reason</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" class="muted">No tests were registered.</td></tr>'}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

function createRunId(date) {
  return date.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
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

function toHref(filePath) {
  return filePath.replace(/\\/g, '/');
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
  expect,
  run,
  runRegisteredTests,
  resetTests,
  getTests
};
