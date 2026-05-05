const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Browser = require('./core/browser');
const { launchChrome, closeChrome } = require('./core/launcher');
const getWebSocketUrl = require('./core/target');
const { afterEach, beforeEach, test, run, expect } = require('./runner/runner');
const { describeLocator } = require('./pages/helpers/locators');

class Orbit {
  constructor(options = {}) {
    this.browser = null;
    this.chromeLaunch = null;
    this.trace = createTraceState(options.trace);
    this.debug = createDebugState(options.debug);
    this.defaultActionOptions = {
      actionTimeout: options.actionTimeout || 0
    };
  }

  async launch() {
    const { port, launch } = await launchChrome();
    this.chromeLaunch = launch;
    const wsUrl = await getWebSocketUrl(port);

    this.browser = new Browser(wsUrl);
    await this.browser.start();
  }

  async open(url, options) {
    return this.traceStep(`open ${url}`, () => this.browser.goto(url, options));
  }

  async click(locator, options) {
    return this.traceStep(`click ${formatLocator(locator)}`, () => {
      return this.browser.page.click(locator, this.withActionDefaults(options));
    });
  }

  async hover(locator, options) {
    return this.traceStep(`hover ${formatLocator(locator)}`, () => {
      return this.browser.page.hover(locator, this.withActionDefaults(options));
    });
  }

  async doubleClick(locator, options) {
    return this.traceStep(`doubleClick ${formatLocator(locator)}`, () => {
      return this.browser.page.doubleClick(locator, this.withActionDefaults(options));
    });
  }

  async rightClick(locator, options) {
    return this.traceStep(`rightClick ${formatLocator(locator)}`, () => {
      return this.browser.page.rightClick(locator, this.withActionDefaults(options));
    });
  }

  async type(locator, value, options) {
    return this.traceStep(`type into ${formatLocator(locator)}`, () => {
      return this.browser.page.type(locator, value, this.withActionDefaults(options));
    });
  }

  async hasText(text, options) {
    return this.traceStep(`hasText "${text}"`, () => {
      return this.browser.page.hasText(text, this.withActionDefaults(options));
    });
  }

  async waitForText(text, options) {
    return this.traceStep(`waitForText "${text}"`, () => {
      return this.browser.page.waitForText(text, this.withActionDefaults(options));
    });
  }

  async exists(locator, options) {
    return this.traceStep(`exists ${formatLocator(locator)}`, () => {
      return this.browser.page.exists(locator, this.withActionDefaults(options));
    });
  }

  async waitFor(locator, options) {
    return this.traceStep(`waitFor ${formatLocator(locator)}`, () => {
      return this.browser.page.waitFor(locator, this.withActionDefaults(options));
    });
  }

  async text(locator, options) {
    return this.traceStep(`text ${formatLocator(locator)}`, () => {
      return this.browser.page.text(locator, this.withActionDefaults(options));
    });
  }

  async wait(ms) {
    return this.traceStep(`wait ${ms}ms`, () => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async screenshot(filePath) {
    return this.browser.screenshot(filePath);
  }

  css(selector) {
    return { css: selector };
  }

  xpath(selector) {
    return { xpath: selector };
  }

  getByRole(role, name) {
    return { role, name };
  }

  getByAttribute(name, value) {
    return { attribute: name, value };
  }

  withActionDefaults(options = {}) {
    if (typeof options === "number") {
      return {
        ...this.defaultActionOptions,
        timeout: options
      };
    }

    return {
      ...this.defaultActionOptions,
      ...options
    };
  }

  async traceStep(name, fn) {
    if (!this.trace.enabled && !this.debug.enabled) {
      return fn();
    }

    const location = getUserSourceLocation(new Error().stack);

    await this.pauseForDebugger(`Next step: ${name}`, {
      name,
      location
    });

    if (!this.trace.enabled) {
      return fn();
    }

    const step = {
      index: this.trace.steps.length + 1,
      name,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: 0,
      url: null,
      title: null,
      screenshot: null,
      location,
      error: null
    };

    this.trace.steps.push(step);

    const startedAt = Date.now();

    try {
      const result = await fn();
      step.status = 'passed';
      return result;
    } catch (error) {
      step.status = 'failed';
      step.error = {
        name: error.name || 'Error',
        message: error.message || String(error)
      };
      throw error;
    } finally {
      step.durationMs = Date.now() - startedAt;
      step.endedAt = new Date().toISOString();
      await this.captureTraceSnapshot(step);
      await this.writeTrace({ status: 'running' });
    }
  }

  async pauseForDebugger(message, step = null) {
    if (!this.debug.enabled || this.debug.paused === false) {
      return;
    }

    if (process.env.ORBITTEST_STEP_AUTO_CONTINUE === '1') {
      return;
    }

    const pageState = await this.getDebugPageState();

    if (this.debug.inspector) {
      const command = await this.debug.inspector.pause({
        ...(step || { name: message, location: null }),
        pageState
      });

      if (command === 'stop') {
        throw new Error('Step run stopped by user');
      }

      return;
    }

    if (!process.stdin.isTTY) {
      return;
    }

    const location = pageState.url ? `\nURL: ${pageState.url}` : '';

    console.log(`\n[Orbit step] ${message}${location}`);
    const answer = await askQuestion('Press Enter to continue, q then Enter to stop: ');

    if (String(answer).trim().toLowerCase() === 'q') {
      throw new Error('Step run stopped by user');
    }
  }

  async getDebugPageState() {
    if (!this.browser || !this.browser.connection || !this.browser.connection.isOpen()) {
      return {};
    }

    try {
      const response = await this.browser.connection.send("Runtime.evaluate", {
        expression: "({ url: location.href, title: document.title })",
        returnByValue: true
      }, {
        timeoutMs: 1000
      });

      return response.result?.result?.value || {};
    } catch (error) {
      return {};
    }
  }

  async captureTraceSnapshot(step) {
    if (!this.browser || !this.browser.connection || !this.browser.connection.isOpen()) {
      return;
    }

    try {
      const response = await this.browser.connection.send("Runtime.evaluate", {
        expression: "({ url: location.href, title: document.title })",
        returnByValue: true
      }, {
        timeoutMs: 3000
      });
      const value = response.result?.result?.value || {};

      step.url = value.url || null;
      step.title = value.title || null;
    } catch (error) {
      step.pageStateError = error.message || String(error);
    }

    try {
      fs.mkdirSync(this.trace.screenshotsDir, { recursive: true });
      const screenshotPath = path.join(
        this.trace.screenshotsDir,
        `${String(step.index).padStart(2, '0')}-${slugify(step.name)}.png`
      );

      await this.screenshot(screenshotPath);
      step.screenshot = path.relative(this.trace.dir, screenshotPath);
    } catch (error) {
      step.screenshotError = error.message || String(error);
    }
  }

  async writeTrace({ status = 'running', error = null } = {}) {
    if (!this.trace.enabled) {
      return null;
    }

    fs.mkdirSync(this.trace.dir, { recursive: true });

    this.trace.status = status;
    this.trace.error = error || null;
    this.trace.updatedAt = new Date().toISOString();

    const trace = {
      meta: {
        tool: 'OrbitTest',
        testName: this.trace.testName,
        testFile: this.trace.testFile,
        attempt: this.trace.attempt,
        status: this.trace.status,
        startedAt: this.trace.startedAt,
        updatedAt: this.trace.updatedAt
      },
      error: this.trace.error,
      steps: this.trace.steps
    };

    fs.writeFileSync(this.trace.jsonPath, `${JSON.stringify(trace, null, 2)}\n`);
    fs.writeFileSync(this.trace.htmlPath, renderTraceHtml(trace));

    return {
      json: this.trace.jsonPath,
      html: this.trace.htmlPath
    };
  }

  async close() {
    if (this.browser) {
      this.browser.close();
    }

    await closeChrome(this.chromeLaunch);
    this.chromeLaunch = null;
  }
}

function createTraceState(trace) {
  if (!trace || !trace.enabled) {
    return {
      enabled: false,
      steps: []
    };
  }

  const dir = path.resolve(trace.dir);

  return {
    enabled: true,
    dir,
    screenshotsDir: path.join(dir, 'screenshots'),
    jsonPath: path.join(dir, 'trace.json'),
    htmlPath: path.join(dir, 'trace.html'),
    testName: trace.testName || 'Untitled test',
    testFile: trace.testFile || null,
    attempt: trace.attempt || 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: null,
    error: null,
    steps: []
  };
}

function createDebugState(debug) {
  if (!debug || !debug.enabled) {
    return {
      enabled: false
    };
  }

  return {
    enabled: true,
    paused: debug.pauseBeforeActions !== false,
    inspector: debug.inspector || null
  };
}

function getUserSourceLocation(stack) {
  const lines = String(stack || '').split(/\r?\n/).slice(1);

  for (const line of lines) {
    const location = parseStackLine(line);

    if (!location) {
      continue;
    }

    const normalized = location.file.replace(/\\/g, '/');

    if (normalized.includes('/node_modules/') ||
        normalized.endsWith('/orbit.js') ||
        normalized.includes('/runner/runner.js')) {
      continue;
    }

    return location;
  }

  return null;
}

function parseStackLine(line) {
  const match = String(line).match(/\(?([A-Za-z]:\\[^:)]+|\/[^:)]+):(\d+):(\d+)\)?$/);

  if (!match) {
    return null;
  }

  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3])
  };
}

function askQuestion(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

function formatLocator(locator) {
  try {
    return describeLocator(locator);
  } catch (error) {
    return JSON.stringify(locator);
  }
}

function renderTraceHtml(trace) {
  const statusClass = trace.meta.status === 'passed' ? 'passed' : trace.meta.status === 'failed' ? 'failed' : 'running';
  const rows = trace.steps.map(step => {
    const screenshot = step.screenshot
      ? `<a href="${escapeHtml(toHref(step.screenshot))}"><img src="${escapeHtml(toHref(step.screenshot))}" alt="${escapeHtml(step.name)} screenshot"></a>`
      : '<span class="muted">No screenshot</span>';
    const error = step.error
      ? `<div class="error">${escapeHtml(step.error.message)}</div>`
      : '';

    return `
      <article class="step ${escapeHtml(step.status)}">
        <div class="step-header">
          <div>
            <span class="index">${step.index}</span>
            <strong>${escapeHtml(step.name)}</strong>
          </div>
          <span class="badge ${escapeHtml(step.status)}">${escapeHtml(step.status)}</span>
        </div>
        <div class="meta">
          <span>${formatDuration(step.durationMs)}</span>
          ${step.url ? `<a href="${escapeHtml(step.url)}">${escapeHtml(step.url)}</a>` : '<span class="muted">No URL</span>'}
          ${step.title ? `<span>${escapeHtml(step.title)}</span>` : ''}
        </div>
        ${error}
        <div class="shot">${screenshot}</div>
      </article>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitTest Trace</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9e0e8;
      --pass: #127a43;
      --pass-bg: #e7f6ee;
      --fail: #b42318;
      --fail-bg: #fde8e7;
      --running: #175cd3;
      --running-bg: #e8f0fe;
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
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      letter-spacing: 0;
    }

    a {
      color: var(--link);
      overflow-wrap: anywhere;
    }

    .muted,
    .meta {
      color: var(--muted);
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 24px 0;
    }

    .metric,
    .step {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .metric {
      padding: 14px;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }

    .metric strong {
      font-size: 24px;
    }

    .steps {
      display: grid;
      gap: 16px;
    }

    .step {
      overflow: hidden;
    }

    .step-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    .index {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      margin-right: 8px;
      border-radius: 50%;
      background: #eef2f7;
      font-weight: 700;
    }

    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 10px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
    }

    .badge.passed { color: var(--pass); background: var(--pass-bg); }
    .badge.failed { color: var(--fail); background: var(--fail-bg); }
    .badge.running { color: var(--running); background: var(--running-bg); }
    .status.passed { color: var(--pass); }
    .status.failed { color: var(--fail); }
    .status.running { color: var(--running); }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 16px;
      font-size: 13px;
    }

    .error {
      margin: 0 16px 12px;
      padding: 10px 12px;
      border-radius: 8px;
      color: var(--fail);
      background: var(--fail-bg);
      font-weight: 700;
    }

    .shot {
      padding: 0 16px 16px;
    }

    .shot img {
      display: block;
      width: 100%;
      max-height: 680px;
      object-fit: contain;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>OrbitTest Trace</h1>
      <div class="muted">${escapeHtml(trace.meta.testName)}${trace.meta.testFile ? ` - ${escapeHtml(trace.meta.testFile)}` : ''}</div>
    </header>

    <section class="summary">
      <div class="metric"><span>Status</span><strong class="status ${statusClass}">${escapeHtml(trace.meta.status.toUpperCase())}</strong></div>
      <div class="metric"><span>Steps</span><strong>${trace.steps.length}</strong></div>
      <div class="metric"><span>Attempt</span><strong>${trace.meta.attempt}</strong></div>
      <div class="metric"><span>Updated</span><strong>${escapeHtml(new Date(trace.meta.updatedAt).toLocaleTimeString())}</strong></div>
    </section>

    <section class="steps">
      ${rows || '<p class="muted">No steps recorded.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'step';
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
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

module.exports = Orbit;
module.exports.Orbit = Orbit;
module.exports.test = test;
module.exports.beforeEach = beforeEach;
module.exports.afterEach = afterEach;
module.exports.expect = expect;
module.exports.run = run;
