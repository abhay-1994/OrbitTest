// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { renderReportLogo } = require('../../runner/report-logo');

function renderTraceHtml(trace) {
  const statusClass = trace.meta.status === 'passed' ? 'passed' : trace.meta.status === 'failed' ? 'failed' : 'running';
  const rows = trace.steps.map(step => {
    const screenshot = step.screenshot
      ? `<a href="${escapeHtml(toHref(step.screenshot))}"><img src="${escapeHtml(toHref(step.screenshot))}" alt="${escapeHtml(step.name)} screenshot"></a>`
      : `<span class="muted">No screenshot${step.screenshotError ? `: ${escapeHtml(step.screenshotError)}` : ''}</span>`;
    const error = step.error
      ? `<div class="error">${escapeHtml(step.error.message)}</div>`
      : '';
    const dialog = step.dialog
      ? `<div class="dialog">Browser ${escapeHtml(step.dialog.type || 'dialog')}: ${escapeHtml(step.dialog.message || '')}${step.dialog.handled ? ' <span class="muted">(auto-closed for screenshot)</span>' : ''}</div>`
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
        ${dialog}
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

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .report-logo {
      width: 56px;
      height: 56px;
      flex: 0 0 56px;
      display: block;
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

    .dialog {
      margin: 0 16px 12px;
      padding: 10px 12px;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      background: #fff7ed;
      color: #9a3412;
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

    @media (max-width: 720px) {
      main {
        padding: 22px 12px 36px;
      }

      .brand {
        align-items: flex-start;
      }

      .report-logo {
        width: 48px;
        height: 48px;
        flex-basis: 48px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="brand">
      ${renderReportLogo()}
      <div>
        <h1>OrbitTest Trace</h1>
        <div class="muted">${escapeHtml(trace.meta.testName)}${trace.meta.testFile ? ` - ${escapeHtml(trace.meta.testFile)}` : ''}</div>
      </div>
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

module.exports = { renderTraceHtml, slugify, formatDuration, toHref, escapeHtml };
