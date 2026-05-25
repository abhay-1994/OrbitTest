// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

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

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

module.exports = {
  createCompactResult,
  createSummaryReport
};
