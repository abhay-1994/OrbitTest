const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { findChromeExecutable } = require('../core/launcher');
const { readLogoDataUri, renderReportLogo } = require('./report-logo');

const INSPECTOR_WINDOW = {
  width: 430,
  height: 760,
  margin: 24
};

async function createInspectorServer(options = {}) {
  const state = {
    status: 'starting',
    runId: options.runId || null,
    currentTest: null,
    currentStep: null,
    source: null,
    autoResume: false,
    message: 'Starting Orbit Inspector...'
  };
  let pending = null;

  const server = http.createServer((req, res) => {
    handleRequest(req, res, state, command => {
      if (command === 'resume') {
        state.autoResume = true;
      }

      if (command === 'stop') {
        state.status = 'stopped';
        state.message = 'Stopped by user.';
      }

      if (pending) {
        const current = pending;
        pending = null;
        current.resolve(command);
      }
    });
  });

  await listen(server);

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  state.status = 'ready';
  state.message = 'Waiting for the next Orbit action.';

  const inspectorBrowser = launchInspectorBrowser(url);

  return {
    url,
    setTest(test) {
      state.currentTest = {
        name: test.name,
        file: test.file
      };
      state.source = loadSource(test.file);
      state.message = `Running ${test.name}`;
    },
    async pause(step) {
      if (process.env.ORBITTEST_STEP_AUTO_CONTINUE === '1') {
        return 'step';
      }

      state.status = state.autoResume ? 'running' : 'paused';
      state.currentStep = step;
      state.source = loadSource(step.location?.file || state.currentTest?.file);
      state.message = state.autoResume
        ? `Running ${step.name}`
        : `Paused before ${step.name}`;

      if (state.autoResume) {
        return 'resume';
      }

      return new Promise(resolve => {
        pending = { resolve };
      });
    },
    finish(status) {
      state.status = status;
      state.message = `Run ${status}.`;

      if (pending) {
        const current = pending;
        pending = null;
        current.resolve('step');
      }
    },
    async close() {
      await closeInspectorBrowser(inspectorBrowser);
      await closeServer(server);
    }
  };
}

function handleRequest(req, res, state, onCommand) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    send(res, 200, 'text/html; charset=utf-8', renderInspectorHtml());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, state);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/command') {
    readJson(req).then(body => {
      const command = ['step', 'resume', 'stop'].includes(body.command)
        ? body.command
        : 'step';

      onCommand(command);
      sendJson(res, { ok: true });
    }).catch(error => {
      sendJson(res, { ok: false, error: error.message }, 400);
    });
    return;
  }

  send(res, 404, 'text/plain; charset=utf-8', 'Not found');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, body, statusCode = 200) {
  send(res, statusCode, 'application/json; charset=utf-8', JSON.stringify(body));
}

function send(res, statusCode, type, body) {
  res.writeHead(statusCode, {
    'content-type': type,
    'cache-control': 'no-store'
  });
  res.end(body);
}

function loadSource(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    const absolutePath = path.resolve(filePath);
    const text = fs.readFileSync(absolutePath, 'utf8');

    return {
      file: absolutePath,
      lines: text.split(/\r?\n/)
    };
  } catch (error) {
    return {
      file: filePath,
      error: error.message
    };
  }
}

function launchInspectorBrowser(url) {
  const chromePath = findChromeExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbittest-inspector-'));
  const position = getInspectorWindowPosition();

  try {
    const process = spawn(chromePath, [
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      `--window-size=${INSPECTOR_WINDOW.width},${INSPECTOR_WINDOW.height}`,
      `--window-position=${position.x},${position.y}`,
      `--app=${url}`
    ], {
      detached: true,
      stdio: 'ignore'
    });

    process.unref();

    return {
      process,
      userDataDir
    };
  } catch (error) {
    console.log(`Orbit Inspector: ${url}`);
    return {
      process: null,
      userDataDir
    };
  }
}

function getInspectorWindowPosition() {
  const screen = getPrimaryScreenWorkArea();
  const fallbackX = 60;
  const fallbackY = 40;

  if (!screen) {
    return {
      x: fallbackX,
      y: fallbackY
    };
  }

  return {
    x: Math.max(0, screen.left + screen.width - INSPECTOR_WINDOW.width - INSPECTOR_WINDOW.margin),
    y: Math.max(0, screen.top + INSPECTOR_WINDOW.margin)
  };
}

function getPrimaryScreenWorkArea() {
  if (process.platform === 'win32') {
    return getWindowsWorkArea();
  }

  return null;
}

function getWindowsWorkArea() {
  try {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea',
      'Write-Output "$($area.Left),$($area.Top),$($area.Width),$($area.Height)"'
    ].join('; ');
    const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });

    if (result.status !== 0 || !result.stdout) {
      return null;
    }

    const values = result.stdout.trim().split(',').map(value => Number(value));

    if (values.length !== 4 || values.some(value => !Number.isFinite(value))) {
      return null;
    }

    return {
      left: values[0],
      top: values[1],
      width: values[2],
      height: values[3]
    };
  } catch (error) {
    return null;
  }
}

async function closeInspectorBrowser(browser) {
  if (!browser) {
    return;
  }

  if (browser.process) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(browser.process.pid), '/T', '/F'], {
        stdio: 'ignore'
      });
    } else {
      try {
        process.kill(-browser.process.pid);
      } catch (error) {
        // The inspector window may already be closed.
      }
    }
  }

  if (browser.userDataDir) {
    await removeDir(browser.userDataDir);
  }
}

async function removeDir(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      await delay(150);
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function renderInspectorHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="${readLogoDataUri()}">
  <title>Orbit Inspector</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #fff;
      --text: #182230;
      --muted: #667085;
      --line: #d8dee8;
      --accent: #175cd3;
      --accent-bg: #e8f0fe;
      --danger: #b42318;
      --danger-bg: #fde8e7;
      --code: #101828;
      --code-muted: #98a2b3;
      --highlight: #fff3bf;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 2;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .inspector-logo {
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      display: block;
    }

    h1 {
      font-size: 16px;
      margin: 0;
      letter-spacing: 0;
      white-space: nowrap;
    }

    .controls {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      border-radius: 8px;
      padding: 7px 9px;
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
    }

    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    button.danger {
      background: var(--danger-bg);
      border-color: #f4b5b0;
      color: var(--danger);
    }

    main {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      min-height: calc(100vh - 55px);
    }

    aside {
      border-right: 1px solid var(--line);
      background: var(--panel);
      padding: 14px;
    }

    .status {
      display: inline-block;
      border-radius: 999px;
      padding: 4px 10px;
      background: var(--accent-bg);
      color: var(--accent);
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
      margin-bottom: 10px;
    }

    .field {
      margin: 10px 0;
    }

    .field span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 5px;
      text-transform: uppercase;
    }

    .field strong,
    .field code {
      overflow-wrap: anywhere;
    }

    .code-wrap {
      overflow: auto;
      background: var(--code);
      color: #f9fafb;
      height: calc(100vh - 55px);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      font-family: Consolas, Monaco, monospace;
      font-size: 12px;
      line-height: 1.45;
    }

    td {
      vertical-align: top;
      white-space: pre;
      padding: 0 10px;
    }

    td.line-no {
      color: var(--code-muted);
      text-align: right;
      user-select: none;
      width: 1%;
      border-right: 1px solid #344054;
    }

    tr.active td {
      background: #344054;
    }

    tr.active td.code {
      color: var(--highlight);
      font-weight: 700;
    }

    .empty {
      padding: 22px;
      color: var(--muted);
    }

    @media (max-width: 860px) {
      main {
        grid-template-columns: 1fr;
      }

      aside {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }

      .code-wrap {
        height: 52vh;
      }
    }

    @media (max-width: 460px) {
      header {
        align-items: flex-start;
      }

      .controls {
        max-width: 176px;
      }

      button {
        min-width: 54px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      ${renderReportLogo('inspector-logo')}
      <h1>Orbit Inspector</h1>
    </div>
    <div class="controls">
      <button class="primary" id="step">Step</button>
      <button id="resume">Resume</button>
      <button class="danger" id="stop">Stop</button>
    </div>
  </header>
  <main>
    <aside>
      <div class="status" id="status">Starting</div>
      <div class="field"><span>Message</span><strong id="message">Starting...</strong></div>
      <div class="field"><span>Test</span><strong id="test">None</strong></div>
      <div class="field"><span>Next Step</span><strong id="step-name">None</strong></div>
      <div class="field"><span>URL</span><code id="url">None</code></div>
      <div class="field"><span>Source</span><code id="source-path">None</code></div>
    </aside>
    <section class="code-wrap" id="code"></section>
  </main>

  <script>
    const els = {
      status: document.querySelector('#status'),
      message: document.querySelector('#message'),
      test: document.querySelector('#test'),
      stepName: document.querySelector('#step-name'),
      url: document.querySelector('#url'),
      sourcePath: document.querySelector('#source-path'),
      code: document.querySelector('#code')
    };

    document.querySelector('#step').addEventListener('click', () => command('step'));
    document.querySelector('#resume').addEventListener('click', () => command('resume'));
    document.querySelector('#stop').addEventListener('click', () => command('stop'));
    document.addEventListener('keydown', event => {
      if (event.key === 'F10' || (event.key === 'Enter' && event.ctrlKey)) {
        event.preventDefault();
        command('step');
      }
    });

    async function command(command) {
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command })
      });
      await refresh();
    }

    async function refresh() {
      const response = await fetch('/api/state');
      const state = await response.json();
      render(state);
    }

    function render(state) {
      const step = state.currentStep || {};
      const source = state.source || {};
      const line = step.location && step.location.line;

      els.status.textContent = state.status || 'unknown';
      els.message.textContent = state.message || '';
      els.test.textContent = state.currentTest ? state.currentTest.name : 'None';
      els.stepName.textContent = step.name || 'None';
      els.url.textContent = step.pageState && step.pageState.url ? step.pageState.url : 'None';
      els.sourcePath.textContent = source.file || 'None';

      if (!source.lines) {
        els.code.innerHTML = '<div class="empty">' + escapeHtml(source.error || 'Waiting for source...') + '</div>';
        return;
      }

      els.code.innerHTML = '<table><tbody>' + source.lines.map((text, index) => {
        const lineNo = index + 1;
        const active = lineNo === line ? ' class="active"' : '';
        return '<tr' + active + '><td class="line-no">' + lineNo + '</td><td class="code">' + escapeHtml(text || ' ') + '</td></tr>';
      }).join('') + '</tbody></table>';

      const active = els.code.querySelector('tr.active');
      if (active) {
        active.scrollIntoView({ block: 'center' });
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    refresh();
    setInterval(refresh, 500);
  </script>
</body>
</html>`;
}

module.exports = {
  createInspectorServer
};
