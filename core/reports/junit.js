// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const path = require('path');

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

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  renderJunitReport
};
