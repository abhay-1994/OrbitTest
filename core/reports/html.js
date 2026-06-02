// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const path = require('path');
const { renderReportLogo } = require('../../runner/report-logo');

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
  const mobileSection = renderEnhancedMobileSection(report, reportsDir);
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

    .mobile-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
      padding: 18px;
    }

    .mobile-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
      margin-bottom: 14px;
    }

    .mobile-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 0.74fr);
      gap: 18px;
      align-items: start;
    }

    .mobile-shot img {
      display: block;
      width: 100%;
      max-height: 560px;
      object-fit: contain;
      background: #0f172a;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .mobile-chip-row,
    .mobile-artifact-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .mobile-chip,
    .mobile-artifact-links a {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel-soft);
      color: var(--text);
      font-size: 12px;
      font-weight: 800;
      text-decoration: none;
    }

    .mobile-artifact-links a {
      color: var(--info);
      background: #ffffff;
    }

    .mobile-list-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .mobile-list {
      padding: 10px;
      background: var(--panel-soft);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
    }

    .mobile-list strong {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
    }

    .mobile-list div {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
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
      .mobile-head { display: block; }
      .mobile-layout { grid-template-columns: 1fr; }
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
      ${mobileSection || ''}
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
  const screenshotResult = results.find(result => result.artifacts?.screenshot || result.artifacts?.mobile?.screenshot) || failedResults[0] || results[0] || null;
  const codeFrameResult = results.find(result => result.error?.codeFrame?.length) || failedResults[0] || results[0] || null;
  const traceResult = results.find(result => result.trace?.steps?.length) || null;
  const hasSmartEvidence = results.some(result => result.smartReport?.enabled);
  const hasScreenshot = results.some(result => result.artifacts?.screenshot || result.artifacts?.mobile?.screenshot);
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
    : result?.artifacts?.mobile?.screenshot
      ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.mobile.screenshot, reportsDir))}"><img src="${escapeHtml(toHrefForReport(result.artifacts.mobile.screenshot, reportsDir))}" alt="${escapeHtml(result.name || 'OrbitTest mobile screenshot')}"></a>`
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

function normalizeSmartUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}')
      .replace(/\b\d{4,}\b/g, '{n}');
    return `${parsed.host}${pathname}`;
  } catch (e) {
    return null;
  }
}

function findCommonFailureCauses(results) {
  const failedResults = results.filter(r => r.status === 'failed' && r.smartReport?.enabled);
  if (failedResults.length < 2) {
    return [];
  }

  const urlMap = new Map();

  for (const result of failedResults) {
    const requests = result.smartReport.failedRequests || [];
    for (const req of requests) {
      const normalized = normalizeSmartUrl(req.url || '');
      if (!normalized) {
        continue;
      }
      if (!urlMap.has(normalized)) {
        urlMap.set(normalized, []);
      }
      const existing = urlMap.get(normalized);
      if (!existing.find(e => e.testName === result.name)) {
        existing.push({
          testName: result.name,
          url: req.url,
          method: req.method || 'GET',
          status: req.status,
          errorText: req.errorText
        });
      }
    }
  }

  const common = [];
  for (const [normalized, entries] of urlMap) {
    if (entries.length >= 2) {
      common.push({ normalizedUrl: normalized, entries });
    }
  }

  return common.sort((a, b) => b.entries.length - a.entries.length);
}

function renderCommonCausesSection(commonCauses) {
  if (!commonCauses.length) {
    return '';
  }

  return `
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin-top:0;">Common Root Causes Across Failed Tests</h3>
      <p class="muted small">These network failures appeared in ${commonCauses[0].entries.length}+ separate failed tests — likely a shared infrastructure or environment issue.</p>
      <div class="evidence-list">
        ${commonCauses.map(cause => `
          <div class="evidence-item">
            <strong>${escapeHtml(cause.entries[0].method)} ${escapeHtml(cause.entries[0].errorText || String(cause.entries[0].status || ''))} — ${escapeHtml(cause.normalizedUrl)}</strong>
            <div class="muted small">Affected tests (${cause.entries.length}): ${cause.entries.map(e => escapeHtml(e.testName)).join(', ')}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderEnhancedMobileSection(report, reportsDir) {
  const results = report.results.filter(result => getMobileEvidence(result));

  if (results.length === 0) {
    return '';
  }

  return `
    <section>
      <h2>Mobile Evidence</h2>
      <p class="section-intro">Android-specific run evidence: device state, app context, UIAutomator output, screenshots, and mobile artifacts.</p>
      <div class="stacked">
        ${results.map(result => renderMobileEvidenceCard(result, reportsDir)).join('')}
      </div>
    </section>`;
}

function renderMobileEvidenceCard(result, reportsDir) {
  const mobile = getMobileEvidence(result);
  const device = mobile.device || {};
  const app = mobile.app || {};
  const ui = mobile.ui || {};
  const screenSize = formatScreenSize(device.screenSize);
  const factRows = [
    ['Device', formatMobileValue(device.model)],
    ['Android', formatMobileValue(device.androidVersion)],
    ['Serial', formatMobileValue(device.serial)],
    ['Screen', screenSize],
    ['Screen On', formatBooleanOrValue(device.screenOn)],
    ['Current Package', formatMobileValue(app.currentPackage)],
    ['Current Activity', formatMobileValue(app.currentActivity)],
    ['Configured Package', formatMobileValue(app.configuredPackage)],
    ['UI Nodes', formatCount(ui.nodeCount)],
    ['Clickable Nodes', formatCount(ui.clickableNodeCount)]
  ];
  const chips = [
    mobile.mode ? `Mode ${mobile.mode}` : null,
    mobile.provider || null,
    mobile.capturedAt ? `Captured ${mobile.capturedAt}` : null
  ].filter(Boolean);
  const errors = [
    mobile.screenshotError ? `Screenshot: ${mobile.screenshotError}` : null,
    mobile.uiDumpError ? `UI dump: ${mobile.uiDumpError}` : null,
    mobile.logcatError ? `Logcat: ${mobile.logcatError}` : null
  ].filter(Boolean);

  return `
    <article class="mobile-card">
      <div class="mobile-head">
        <div>
          <h3>${escapeHtml(result.name)}</h3>
          ${result.file ? `<div class="muted small">${escapeHtml(path.relative(process.cwd(), result.file))}</div>` : ''}
          <div class="mobile-chip-row">
            ${chips.map(chip => `<span class="mobile-chip">${escapeHtml(chip)}</span>`).join('')}
          </div>
        </div>
        <span class="badge ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span>
      </div>

      <div class="mobile-layout">
        <div class="stacked">
          <div class="fact-grid">
            ${factRows.map(([label, value]) => `
              <div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
            `).join('')}
          </div>

          ${renderMobileArtifactLinks(mobile, reportsDir)}

          <div class="mobile-list-grid">
            ${renderMobileList('Visible Text', ui.texts)}
            ${renderMobileList('Resource IDs', ui.resourceIds)}
            ${renderMobileList('Descriptions', ui.descriptions)}
          </div>

          ${errors.length ? `
            <div class="evidence-list">
              ${errors.map(error => `<div class="evidence-item"><strong>Capture Warning</strong>${escapeHtml(error)}</div>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="mobile-shot">
          ${renderMobileScreenshot(mobile, result, reportsDir)}
        </div>
      </div>
    </article>`;
}

function renderMobileScreenshot(mobile, result, reportsDir) {
  if (mobile.screenshot) {
    const href = toHrefForReport(mobile.screenshot, reportsDir);
    return `<a href="${escapeHtml(href)}"><img src="${escapeHtml(href)}" alt="${escapeHtml(result.name)} mobile screenshot"></a>`;
  }

  if (mobile.screenshotError) {
    return `<div class="empty-state">Mobile screenshot was not captured: ${escapeHtml(mobile.screenshotError)}</div>`;
  }

  return '<div class="empty-state">No mobile screenshot was captured for this test.</div>';
}

function renderMobileArtifactLinks(mobile, reportsDir) {
  const links = [
    ['screenshot', 'Screenshot'],
    ['uiXml', 'UI XML'],
    ['uiJson', 'UI JSON'],
    ['logcat', 'Logcat'],
    ['error', 'Error'],
    ['result', 'Result JSON'],
    ['metadata', 'Mobile JSON']
  ]
    .filter(([key]) => mobile[key])
    .map(([key, label]) => `<a href="${escapeHtml(toHrefForReport(mobile[key], reportsDir))}">${escapeHtml(label)}</a>`);

  if (links.length === 0) {
    return '<div class="muted">No mobile artifact files were captured.</div>';
  }

  return `<div class="mobile-artifact-links">${links.join('')}</div>`;
}

function renderMobileList(title, items = []) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  const body = values.length
    ? values.slice(0, 10).map(item => `<div>${escapeHtml(item)}</div>`).join('')
    : '<div>None captured</div>';

  return `
    <div class="mobile-list">
      <strong>${escapeHtml(title)}</strong>
      ${body}
    </div>`;
}

function getMobileEvidence(result) {
  return result?.artifacts?.mobile || null;
}

function formatScreenSize(value) {
  if (value && typeof value === 'object' && Number.isFinite(Number(value.width)) && Number.isFinite(Number(value.height))) {
    return `${value.width} x ${value.height}`;
  }

  return formatMobileValue(value);
}

function formatBooleanOrValue(value) {
  if (value === true) {
    return 'Yes';
  }

  if (value === false) {
    return 'No';
  }

  return formatMobileValue(value);
}

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '0';
}

function formatMobileValue(value) {
  if (value === undefined || value === null || value === '') {
    return 'Unknown';
  }

  if (typeof value === 'object') {
    if (value.error) {
      return `Unavailable: ${value.error}`;
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function renderEnhancedSmartReportSection(report) {
  const results = report.results.filter(result => result.smartReport?.enabled);

  if (results.length === 0) {
    return '';
  }

  const commonCauses = findCommonFailureCauses(report.results);

  return `
    <section>
      <h2>Smart Report Evidence</h2>
      ${renderCommonCausesSection(commonCauses)}
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
  const mobile = getMobileEvidence(result);
  const evidence = [
    result.artifacts.screenshot ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}">Screenshot</a>` : null,
    result.artifacts.trace ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.trace, reportsDir))}">Trace file</a>` : null,
    mobile?.screenshot ? `<a href="${escapeHtml(toHrefForReport(mobile.screenshot, reportsDir))}">Mobile screenshot</a>` : null,
    mobile ? '<span class="muted">Mobile evidence</span>' : null,
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
  const mobile = getMobileEvidence(result);
  const screenshot = result.artifacts.screenshot
    ? `<a href="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}"><img src="${escapeHtml(toHrefForReport(result.artifacts.screenshot, reportsDir))}" alt="${escapeHtml(result.name)} failure screenshot"></a>`
    : mobile?.screenshot
      ? `<a href="${escapeHtml(toHrefForReport(mobile.screenshot, reportsDir))}"><img src="${escapeHtml(toHrefForReport(mobile.screenshot, reportsDir))}" alt="${escapeHtml(result.name)} mobile failure screenshot"></a>`
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
            <h3>${mobile?.screenshot && !result.artifacts.screenshot ? 'Mobile Failure Screenshot' : 'Failure Screenshot'}</h3>
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
  const consoleWarnings = smartReport.consoleWarnings || [];
  const pageErrors = smartReport.pageErrors || [];
  const dialogs = smartReport.dialogs || [];
  const navigations = smartReport.navigations || [];
  const setupErrors = smartReport.setupErrors || [];
  const ariaAlerts = smartReport.ariaAlerts || [];
  const hasDetails = failedRequests.length ||
    slowRequests.length ||
    recentRequests.length ||
    consoleErrors.length ||
    consoleWarnings.length ||
    pageErrors.length ||
    dialogs.length ||
    navigations.length ||
    setupErrors.length ||
    ariaAlerts.length;

  return `
    <div>
      ${options.compact ? '' : '<h3>Smart Report Evidence</h3>'}
      <div class="fact-grid">
        <div class="fact"><span>Console Errors</span><strong>${consoleErrors.length}</strong></div>
        <div class="fact"><span>Console Warnings</span><strong>${consoleWarnings.length}</strong></div>
        <div class="fact"><span>Page Errors</span><strong>${pageErrors.length}</strong></div>
        <div class="fact"><span>ARIA Alerts</span><strong>${ariaAlerts.length}</strong></div>
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
          ${renderSmartAriaAlerts(ariaAlerts)}
          ${renderSmartPageErrors(pageErrors)}
          ${renderSmartDialogs(dialogs)}
          ${renderSmartConsoleErrors(consoleErrors)}
          ${renderSmartConsoleWarnings(consoleWarnings)}
          ${renderSmartRequests('Failed requests', failedRequests, { showHeaders: true })}
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

function renderSmartConsoleWarnings(warnings) {
  if (!warnings.length) {
    return '';
  }

  return `
    <h3>Console Warnings</h3>
    <div class="evidence-list">
      ${warnings.slice(-8).map(warning => `
        <div class="evidence-item">
          <strong>${escapeHtml(warning.type || 'warning')}</strong>
          <div>${escapeHtml(warning.text || '')}</div>
          ${renderSmartLocation(warning.location)}
        </div>
      `).join('')}
    </div>`;
}

function renderSmartAriaAlerts(alerts) {
  if (!alerts || !alerts.length) {
    return '';
  }

  return `
    <h3>ARIA Alerts &amp; Live Regions</h3>
    <div class="evidence-list">
      ${alerts.slice(0, 8).map(alert => `
        <div class="evidence-item">
          <strong>${escapeHtml(alert.role || 'alert')}</strong>
          <div>${escapeHtml(alert.text || '')}</div>
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
          ${request.requestBody ? `
            <details>
              <summary class="muted small">Request body</summary>
              <pre>${escapeHtml(request.requestBody)}${String(request.requestBody).length >= 1000 ? '\n...truncated' : ''}</pre>
            </details>` : ''}
          ${options.showHeaders && request.requestHeaders ? `
            <details>
              <summary class="muted small">Request headers</summary>
              <pre>${escapeHtml(renderHeadersText(request.requestHeaders))}</pre>
            </details>` : ''}
          ${options.showHeaders && request.responseHeaders ? `
            <details>
              <summary class="muted small">Response headers</summary>
              <pre>${escapeHtml(renderHeadersText(request.responseHeaders))}</pre>
            </details>` : ''}
          ${request.responseBody ? `<pre>${escapeHtml(request.responseBody)}${request.responseBodyTruncated ? '\n...truncated' : ''}</pre>` : ''}
          ${request.responseBodyError ? `<div class="muted small">Response body was not available: ${escapeHtml(request.responseBodyError)}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
}

function renderHeadersText(headers) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function unique(values) {
  return Array.from(new Set(values));
}

module.exports = { renderHtmlReport, renderEnhancedHtmlReport };
