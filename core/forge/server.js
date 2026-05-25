// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const http = require("http");
const { URL } = require("url");
const {
  buildOrbitTestScript,
  normalizeForgeEvents
} = require("./script");
const { readLogoDataUri } = require("../../runner/report-logo");

async function startForgeServer(options = {}) {
  const recorder = options.recorder;
  const host = options.host || "127.0.0.1";
  const port = options.port || 0;
  const activateVerify = typeof options.activateVerify === "function"
    ? options.activateVerify
    : async () => false;
  const activateVerifyText = typeof options.activateVerifyText === "function"
    ? options.activateVerifyText
    : async () => false;
  const sseClients = new Set();
  let scriptOverride = null;

  if (!recorder) {
    throw new Error("Forge server requires a recorder.");
  }

  function pushSse(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch (_) {
        sseClients.delete(res);
      }
    }
  }

  if (typeof recorder.subscribe === "function") {
    recorder.subscribe((type, data) => {
      pushSse(type, data || {});
    });
  }

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

    try {
      if (req.method === "GET" && requestUrl.pathname === "/") {
        sendHtml(res, renderForgeHtml({ logoDataUri: readLogoDataUri() }));
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/state") {
        sendJson(res, buildState({
          recorder,
          output: options.output,
          testName: options.testName,
          scriptOverride
        }));
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        });
        res.write(": ping\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        req.on("error", () => sseClients.delete(res));
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/script") {
        const payload = await readJsonBody(req);

        if (payload && payload.edited === false) {
          scriptOverride = null;
        } else {
          scriptOverride = String(payload?.script ?? "").slice(0, 500000);
        }

        sendJson(res, {
          ok: true,
          edited: scriptOverride !== null
        });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/verify-next") {
        const activated = await activateVerify();
        sendJson(res, { ok: true, activated });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/verify-next-text") {
        const activated = await activateVerifyText();
        sendJson(res, { ok: true, activated });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/stop") {
        recorder.stop("Forge UI");
        sendJson(res, { ok: true });
        return;
      }

      sendNotFound(res);
    } catch (error) {
      sendJson(res, {
        ok: false,
        error: error.message || String(error)
      }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const url = `http://${host}:${address.port}`;

  return {
    url,
    origin: url,
    getScriptOverride() {
      return scriptOverride;
    },
    close() {
      return new Promise(resolve => {
        server.close(() => resolve());
      });
    }
  };
}

function buildState({ recorder, output, testName, scriptOverride = null }) {
  const events = recorder.events.slice();
  const steps = normalizeForgeEvents(events);
  const generatedScript = buildOrbitTestScript({
    events,
    startUrl: recorder.startUrl,
    testName
  });
  const script = scriptOverride === null ? generatedScript : scriptOverride;
  const outputPath = output || "";

  return {
    ok: true,
    running: !recorder.stopped,
    stopReason: recorder.stopReason || "",
    startUrl: recorder.startUrl || "",
    eventCount: events.length,
    stepCount: steps.length,
    outputPath,
    outputMode: outputPath ? "file" : "copy",
    script,
    generatedScript,
    scriptEdited: scriptOverride !== null,
    events: events.slice(-30).map(event => ({
      action: event.action || event.type,
      locator: event.locator || null,
      secret: Boolean(event.secret),
      value: event.secret ? "" : event.value || "",
      text: event.text || "",
      url: event.url || ""
    }))
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;

      if (body.length > 600000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function sendNotFound(res) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("Not found");
}

function renderForgeHtml({ logoDataUri = "" } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OrbitTest Forge</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        font-size: 13px;
        color: #1e293b;
        background: #f1f5f9;
        min-height: 100vh;
      }

      header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 14px;
        height: 52px;
        background: #fff;
        border-bottom: 1px solid #e2e8f0;
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 9px;
        flex-shrink: 0;
      }

      .brand-logo {
        width: 30px;
        height: 30px;
        border-radius: 7px;
      }

      .brand-name {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: -0.3px;
        color: #0f172a;
      }

      .brand-tag {
        font-size: 11px;
        font-weight: 600;
        color: #64748b;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 2px 6px;
        margin-left: 2px;
      }

      .header-status {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 6px;
        color: #475569;
        font-size: 12px;
        flex-shrink: 0;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #16a34a;
        flex-shrink: 0;
        transition: background 0.3s;
      }

      .status-dot.stopped { background: #dc2626; }

      .header-spacer { flex: 1; }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
      }

      button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #fff;
        color: #334155;
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.1s, border-color 0.1s, opacity 0.1s;
        flex-shrink: 0;
      }

      button:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
      button[hidden] { display: none !important; }

      .btn-primary { background: #0284c7; border-color: #0284c7; color: #fff; }
      .btn-primary:hover:not(:disabled) { background: #0369a1; border-color: #0369a1; }

      .btn-danger { background: #dc2626; border-color: #dc2626; color: #fff; }
      .btn-danger:hover:not(:disabled) { background: #b91c1c; border-color: #b91c1c; }

      .btn-active { background: #7c3aed; border-color: #7c3aed; color: #fff; }

      kbd {
        font: 10px/1 Consolas, Monaco, monospace;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 3px;
        padding: 1px 4px;
        color: #475569;
      }

      .btn-primary kbd, .btn-danger kbd, .btn-active kbd {
        background: rgba(255,255,255,0.18);
        border-color: rgba(255,255,255,0.28);
        color: rgba(255,255,255,0.88);
      }

      main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 272px;
        gap: 12px;
        padding: 12px;
        height: calc(100vh - 52px);
      }

      .script-panel {
        border: 1px solid #1e293b;
        border-radius: 8px;
        background: #0f172a;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
      }

      .script-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 14px;
        border-bottom: 1px solid #1e3a5f;
        flex-shrink: 0;
      }

      .script-label {
        flex: 1;
        font-size: 11px;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .edited-badge {
        font-size: 10px;
        font-weight: 700;
        color: #f59e0b;
        letter-spacing: 0.3px;
      }

      .script-body {
        flex: 1;
        overflow: auto;
        min-height: 0;
      }

      pre {
        margin: 0;
        padding: 16px 18px;
        color: #e2e8f0;
        font: 13px/1.6 Consolas, Monaco, "Courier New", monospace;
        white-space: pre;
      }

      textarea.script-editor {
        display: none;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 16px 18px;
        border: 0;
        outline: 0;
        resize: none;
        background: #0f172a;
        color: #e2e8f0;
        font: 13px/1.6 Consolas, Monaco, "Courier New", monospace;
        white-space: pre;
        tab-size: 2;
      }

      .script-panel.editing pre { display: none; }
      .script-panel.editing textarea.script-editor { display: block; }

      aside {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
        overflow-y: auto;
      }

      .card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px 14px;
        flex-shrink: 0;
      }

      .card-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #64748b;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 7px;
      }

      .count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        background: #0284c7;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        border-radius: 9px;
      }

      .session-grid {
        display: grid;
        grid-template-columns: 50px 1fr;
        gap: 5px 8px;
        font-size: 12px;
      }

      .session-key { color: #64748b; font-weight: 500; padding-top: 1px; }

      .session-val {
        color: #1e293b;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .session-val.muted { color: #94a3b8; font-weight: 400; }

      .shortcut-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

      .shortcut-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
      }

      .shortcut-key { flex-shrink: 0; }
      .shortcut-desc { color: #475569; line-height: 1.4; }

      .card.actions-card {
        flex: 1;
        min-height: 120px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .actions-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        flex: 1;
      }

      .action-row {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        font-size: 12px;
        color: #334155;
        line-height: 1.35;
      }

      .action-type {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 46px;
        height: 17px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .t-click  { background: #dbeafe; color: #1d4ed8; }
      .t-dbl    { background: #dbeafe; color: #1d4ed8; }
      .t-rclik  { background: #dbeafe; color: #1d4ed8; }
      .t-type   { background: #dcfce7; color: #166534; }
      .t-select { background: #fed7aa; color: #9a3412; }
      .t-exists { background: #f3e8ff; color: #7e22ce; }
      .t-text   { background: #fce7f3; color: #9d174d; }
      .t-nav    { background: #f1f5f9; color: #475569; }

      .action-target {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .empty-note { color: #94a3b8; font-size: 12px; font-style: italic; }

      @media (max-width: 860px) {
        header { flex-wrap: wrap; height: auto; padding: 8px 14px; gap: 7px; }
        main { grid-template-columns: 1fr; height: auto; }
        .script-panel { min-height: 55vh; }
        aside { overflow-y: visible; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">
        <img class="brand-logo" src="${escapeHtmlAttribute(logoDataUri)}" alt="">
        <span class="brand-name">OrbitTest Forge</span>
        <span class="brand-tag">Recorder</span>
      </div>
      <div class="header-status">
        <span class="status-dot" id="dot"></span>
        <span id="statusText">Recording</span>
      </div>
      <div class="header-spacer"></div>
      <div class="header-actions">
        <button type="button" id="verify">Verify Exists <kbd>Ctrl+Shift+V</kbd></button>
        <button type="button" id="verifyText">Verify Text <kbd>Ctrl+Shift+T</kbd></button>
        <button type="button" id="edit">Edit Script</button>
        <button type="button" id="live" hidden>Live Script</button>
        <button type="button" class="btn-primary" id="copy">Copy Script</button>
        <button type="button" class="btn-danger" id="stop">Stop <kbd>Ctrl+Shift+S</kbd></button>
      </div>
    </header>

    <main>
      <div class="script-panel" id="scriptWrap">
        <div class="script-toolbar">
          <span class="script-label">Generated Script</span>
          <span class="edited-badge" id="editBadge" hidden>&#9679; Edited</span>
        </div>
        <div class="script-body">
          <pre id="script"></pre>
          <textarea class="script-editor" id="scriptEditor" spellcheck="false" aria-label="Editable OrbitTest script"></textarea>
        </div>
      </div>

      <aside>
        <div class="card">
          <div class="card-title">Session</div>
          <div class="session-grid">
            <span class="session-key">URL</span>
            <span class="session-val muted" id="url">Waiting</span>
            <span class="session-key">Steps</span>
            <span class="session-val" id="steps">0</span>
            <span class="session-key">Output</span>
            <span class="session-val muted" id="output">Copy only</span>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Keyboard Shortcuts</div>
          <div class="shortcut-list">
            <div class="shortcut-row">
              <span class="shortcut-key"><kbd>Ctrl+Shift+V</kbd></span>
              <span class="shortcut-desc">Verify next click — records an exists check</span>
            </div>
            <div class="shortcut-row">
              <span class="shortcut-key"><kbd>Ctrl+Shift+T</kbd></span>
              <span class="shortcut-desc">Verify next click — records a text assertion</span>
            </div>
            <div class="shortcut-row">
              <span class="shortcut-key"><kbd>Ctrl+Shift+S</kbd></span>
              <span class="shortcut-desc">Stop recording from the app browser</span>
            </div>
          </div>
        </div>

        <div class="card actions-card">
          <div class="card-title">
            Recent Actions
            <span class="count-badge" id="actionCount">0</span>
          </div>
          <ol class="actions-list" id="events">
            <li class="empty-note">No actions recorded yet.</li>
          </ol>
        </div>
      </aside>
    </main>

    <script>
      const els = {
        dot:          document.getElementById('dot'),
        statusText:   document.getElementById('statusText'),
        scriptWrap:   document.getElementById('scriptWrap'),
        script:       document.getElementById('script'),
        scriptEditor: document.getElementById('scriptEditor'),
        editBadge:    document.getElementById('editBadge'),
        url:          document.getElementById('url'),
        steps:        document.getElementById('steps'),
        output:       document.getElementById('output'),
        events:       document.getElementById('events'),
        actionCount:  document.getElementById('actionCount'),
        verify:       document.getElementById('verify'),
        verifyText:   document.getElementById('verifyText'),
        edit:         document.getElementById('edit'),
        live:         document.getElementById('live'),
        copy:         document.getElementById('copy'),
        stop:         document.getElementById('stop')
      };

      const ACTION_CONFIG = {
        click:         { cls: 't-click',  label: 'CLICK' },
        doubleClick:   { cls: 't-dbl',    label: '2\xD7CLK' },
        rightClick:    { cls: 't-rclik',  label: 'R-CLK' },
        type:          { cls: 't-type',   label: 'TYPE' },
        select:        { cls: 't-select', label: 'SELECT' },
        assertVisible: { cls: 't-exists', label: 'EXISTS' },
        assertText:    { cls: 't-text',   label: 'TEXT' },
        navigation:    { cls: 't-nav',    label: 'NAV' }
      };

      let latestScript = '';
      let generatedScript = '';
      let editMode = false;
      let saveTimer = null;
      let sseSource = null;
      let pollTimer = null;

      function resetVerifyButtons() {
        if (els.verify.classList.contains('btn-active')) {
          els.verify.classList.remove('btn-active');
          els.verify.disabled = false;
          els.verify.innerHTML = 'Verify Exists <kbd>Ctrl+Shift+V</kbd>';
        }
        if (els.verifyText.classList.contains('btn-active')) {
          els.verifyText.classList.remove('btn-active');
          els.verifyText.disabled = false;
          els.verifyText.innerHTML = 'Verify Text <kbd>Ctrl+Shift+T</kbd>';
        }
      }

      async function loadState() {
        try {
          const res = await fetch('/api/state', { cache: 'no-store' });
          if (!res.ok) return;
          const state = await res.json();

          generatedScript = state.generatedScript || state.script || '';

          if (!editMode) {
            latestScript = state.script || '';
            els.script.textContent = latestScript;
            els.scriptEditor.value = latestScript;
          }

          els.editBadge.hidden = !state.scriptEdited;
          els.url.textContent = state.startUrl || 'Waiting';
          els.url.classList.toggle('muted', !state.startUrl);
          els.steps.textContent = String(state.stepCount || 0);
          els.actionCount.textContent = String(state.stepCount || 0);

          if (state.scriptEdited) {
            els.output.textContent = 'Edited script';
            els.output.classList.remove('muted');
          } else if (state.outputMode === 'file') {
            els.output.textContent = state.outputPath;
            els.output.classList.remove('muted');
          } else {
            els.output.textContent = 'Copy only';
            els.output.classList.add('muted');
          }

          const stopped = !state.running;
          els.dot.classList.toggle('stopped', stopped);
          els.statusText.textContent = stopped
            ? ('Stopped' + (state.stopReason ? ': ' + state.stopReason : ''))
            : 'Recording';
          els.stop.disabled = stopped;

          if (!els.verify.classList.contains('btn-active')) {
            els.verify.disabled = stopped;
          }
          if (!els.verifyText.classList.contains('btn-active')) {
            els.verifyText.disabled = stopped;
          }

          const events = state.events || [];
          if (!events.length) {
            els.events.innerHTML = '<li class="empty-note">No actions recorded yet.</li>';
          } else {
            els.events.innerHTML = '';
            for (const ev of events) {
              const cfg = ACTION_CONFIG[ev.action] || { cls: 't-nav', label: (ev.action || '?').toUpperCase().slice(0, 6) };
              const li = document.createElement('li');
              li.className = 'action-row';

              const badge = document.createElement('span');
              badge.className = 'action-type ' + cfg.cls;
              badge.textContent = cfg.label;

              const tgt = document.createElement('span');
              tgt.className = 'action-target';

              let label = '';
              if (ev.action === 'assertText' && ev.text) {
                label = '“' + ev.text.slice(0, 60) + '”';
              } else if (ev.locator) {
                label = ev.locator.name || ev.locator.text || ev.locator.selector || ev.locator.role || '';
                if (ev.action === 'type' && !ev.secret && ev.value) {
                  label += ' → “' + String(ev.value).slice(0, 36) + '”';
                }
                if (ev.secret) label += ' [secret]';
              }

              tgt.textContent = label || '—';
              li.append(badge, tgt);
              els.events.appendChild(li);
            }
          }
        } catch (_) {}
      }

      function connectSSE() {
        if (sseSource) sseSource.close();
        sseSource = new EventSource('/api/events');

        sseSource.addEventListener('action', () => {
          resetVerifyButtons();
          loadState();
        });

        sseSource.addEventListener('stop', () => {
          loadState();
          sseSource.close();
          sseSource = null;
        });

        sseSource.onerror = () => {
          if (sseSource && sseSource.readyState === EventSource.CLOSED) {
            sseSource = null;
            if (!pollTimer) {
              pollTimer = setInterval(loadState, 2000);
            }
          }
        };
      }

      async function saveEditedScript(script) {
        await fetch('/api/script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edited: true, script })
        });
      }

      function scheduleSave() {
        clearTimeout(saveTimer);
        latestScript = els.scriptEditor.value;
        saveTimer = setTimeout(() => saveEditedScript(els.scriptEditor.value).catch(() => {}), 300);
      }

      async function enterEditMode() {
        editMode = true;
        latestScript = els.scriptEditor.value || latestScript || generatedScript;
        els.scriptEditor.value = latestScript;
        els.scriptWrap.classList.add('editing');
        els.edit.textContent = 'Editing…';
        els.edit.disabled = true;
        els.live.hidden = false;
        els.scriptEditor.focus();
        await saveEditedScript(els.scriptEditor.value);
      }

      async function exitEditMode() {
        editMode = false;
        clearTimeout(saveTimer);
        await fetch('/api/script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edited: false })
        });
        latestScript = generatedScript;
        els.script.textContent = latestScript;
        els.scriptEditor.value = latestScript;
        els.scriptWrap.classList.remove('editing');
        els.edit.textContent = 'Edit Script';
        els.edit.disabled = false;
        els.live.hidden = true;
        await loadState();
      }

      function activateVerifyBtn(btn, label) {
        btn.disabled = true;
        btn.classList.add('btn-active');
        btn.textContent = 'Click target in app…';
        setTimeout(() => {
          if (btn.classList.contains('btn-active')) {
            btn.classList.remove('btn-active');
            btn.disabled = false;
            btn.innerHTML = label;
          }
        }, 4000);
      }

      els.verify.addEventListener('click', async () => {
        activateVerifyBtn(els.verify, 'Verify Exists <kbd>Ctrl+Shift+V</kbd>');
        await fetch('/api/verify-next', { method: 'POST' }).catch(() => {});
      });

      els.verifyText.addEventListener('click', async () => {
        activateVerifyBtn(els.verifyText, 'Verify Text <kbd>Ctrl+Shift+T</kbd>');
        await fetch('/api/verify-next-text', { method: 'POST' }).catch(() => {});
      });

      els.edit.addEventListener('click', () => enterEditMode().catch(() => {}));
      els.live.addEventListener('click', () => exitEditMode().catch(() => {}));

      els.scriptEditor.addEventListener('input', scheduleSave);

      els.scriptEditor.addEventListener('keydown', ev => {
        if (ev.key !== 'Tab') return;
        ev.preventDefault();
        const s = els.scriptEditor.selectionStart;
        const e2 = els.scriptEditor.selectionEnd;
        const v = els.scriptEditor.value;
        els.scriptEditor.value = v.slice(0, s) + '  ' + v.slice(e2);
        els.scriptEditor.selectionStart = s + 2;
        els.scriptEditor.selectionEnd = s + 2;
        scheduleSave();
      });

      els.copy.addEventListener('click', async () => {
        if (editMode) {
          await saveEditedScript(els.scriptEditor.value).catch(() => {});
          latestScript = els.scriptEditor.value;
        }
        try {
          await navigator.clipboard.writeText(latestScript);
          const prev = els.copy.innerHTML;
          els.copy.textContent = 'Copied!';
          setTimeout(() => { els.copy.innerHTML = prev; }, 1400);
        } catch (_) {
          els.copy.textContent = 'Copy failed';
          setTimeout(() => { els.copy.innerHTML = 'Copy Script'; }, 1400);
        }
      });

      els.stop.addEventListener('click', async () => {
        if (editMode) await saveEditedScript(els.scriptEditor.value).catch(() => {});
        await fetch('/api/stop', { method: 'POST' }).catch(() => {});
        await loadState();
      });

      loadState();
      connectSSE();
    </script>
  </body>
</html>`;
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = {
  startForgeServer
};
