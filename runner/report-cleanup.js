// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require('fs');
const path = require('path');

function normalizeReportRetention(retention = {}) {
  return {
    keepLatest: retention.keepLatest !== false,
    passedRuns: normalizeInteger(retention.passedRuns, 10),
    failedRuns: normalizeInteger(retention.failedRuns, 30),
    maxAgeDays: normalizeInteger(retention.maxAgeDays, 30),
    autoCleanup: Boolean(retention.autoCleanup)
  };
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) { return fallback; }
  return Math.floor(number);
}

function cleanReports({ reportsDir = path.join(process.cwd(), 'reports'), retention = {}, currentRunId = null, dryRun = false } = {}) {
  const resolvedReportsDir = path.resolve(reportsDir);
  const rules = normalizeReportRetention(retention);
  const entries = collectReportEntries(resolvedReportsDir);
  const now = Date.now();
  const maxAgeMs = rules.maxAgeDays > 0 ? rules.maxAgeDays * 24 * 60 * 60 * 1000 : 0;
  const latestRunId = rules.keepLatest ? readLatestReportRunId(resolvedReportsDir) : null;
  const protectedRunIds = new Set([currentRunId, latestRunId].filter(Boolean));
  const byStatus = {
    passed: [],
    failed: [],
    unknown: []
  };

  for (const entry of entries) {
    if (protectedRunIds.has(entry.runId)) {
      entry.keepReason = entry.runId === currentRunId ? 'current run' : 'latest report';
      continue;
    }

    byStatus[entry.status]?.push(entry);
  }

  for (const list of Object.values(byStatus)) {
    list.sort((a, b) => b.endedAtMs - a.endedAtMs);
  }

  markOverflowForDeletion(byStatus.passed, rules.passedRuns);
  markOverflowForDeletion(byStatus.failed, rules.failedRuns);
  markOverflowForDeletion(byStatus.unknown, Math.max(rules.passedRuns, rules.failedRuns));

  if (maxAgeMs > 0) {
    for (const entry of entries) {
      if (!entry.deleteReason && !entry.keepReason && now - entry.endedAtMs > maxAgeMs) {
        entry.deleteReason = `older than ${rules.maxAgeDays} days`;
      }
    }
  }

  const deleted = [];
  const kept = [];

  for (const entry of entries) {
    if (!entry.deleteReason) {
      kept.push(toCleanReportResult(entry));
      continue;
    }

    if (!dryRun) {
      removeReportEntry(entry, resolvedReportsDir);
    }

    deleted.push(toCleanReportResult(entry));
  }

  return {
    reportsDir: path.relative(process.cwd(), resolvedReportsDir) || '.',
    dryRun,
    deleted,
    kept
  };
}

function readLatestReportRunId(reportsDir) {
  const latestReport = readReportJson(path.join(reportsDir, 'latest.json'));
  const runId = latestReport?.meta?.runId;

  return typeof runId === 'string' && runId.trim() ? runId : null;
}

function collectReportEntries(reportsDir) {
  return [
    ...collectRunDirectoryEntries(reportsDir),
    ...collectLegacyRootReportEntries(reportsDir)
  ];
}

function collectRunDirectoryEntries(reportsDir) {
  const runsDir = path.join(reportsDir, 'runs');

  if (!fs.existsSync(runsDir)) {
    return [];
  }

  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const runDir = path.join(runsDir, entry.name);
      const reportJson = path.join(runDir, 'report.json');
      const report = readReportJson(reportJson);

      return createReportEntry({
        type: 'run',
        runId: entry.name,
        paths: [runDir],
        report,
        fallbackPath: runDir
      });
    });
}

function collectLegacyRootReportEntries(reportsDir) {
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const legacy = new Map();

  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3})\.(html|json)$/);

    if (!match) {
      continue;
    }

    const runId = match[1];
    const current = legacy.get(runId) || [];
    current.push(path.join(reportsDir, entry.name));
    legacy.set(runId, current);
  }

  return Array.from(legacy.entries()).map(([runId, paths]) => {
    const jsonPath = paths.find(filePath => filePath.endsWith('.json'));
    const report = jsonPath ? readReportJson(jsonPath) : null;
    const legacyArtifactsDir = path.join(reportsDir, 'artifacts', runId);

    if (fs.existsSync(legacyArtifactsDir)) {
      paths.push(legacyArtifactsDir);
    }

    return createReportEntry({
      type: 'legacy',
      runId,
      paths,
      report,
      fallbackPath: paths[0]
    });
  });
}

function createReportEntry({ type, runId, paths, report, fallbackPath }) {
  const fallbackStat = safeStat(fallbackPath);
  const endedAt = report?.meta?.endedAt || report?.meta?.startedAt || null;
  const endedAtMs = endedAt ? Date.parse(endedAt) : fallbackStat?.mtimeMs || 0;

  return {
    type,
    runId,
    paths,
    status: report?.summary?.status || 'unknown',
    endedAt: endedAt || (fallbackStat ? fallbackStat.mtime.toISOString() : null),
    endedAtMs: Number.isFinite(endedAtMs) && endedAtMs > 0 ? endedAtMs : 0,
    deleteReason: null,
    keepReason: null
  };
}

function readReportJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

function markOverflowForDeletion(entries, keepCount) {
  const keep = Math.max(0, keepCount);

  entries.forEach((entry, index) => {
    if (index >= keep) {
      entry.deleteReason = `exceeds last ${keep} ${entry.status} run${keep === 1 ? '' : 's'}`;
    }
  });
}

function removeReportEntry(entry, reportsDir) {
  for (const filePath of entry.paths) {
    const resolved = path.resolve(filePath);

    if (!isInsideDirectory(resolved, reportsDir)) {
      continue;
    }

    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function isInsideDirectory(target, parent) {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function toCleanReportResult(entry) {
  return {
    runId: entry.runId,
    type: entry.type,
    status: entry.status,
    endedAt: entry.endedAt,
    reason: entry.deleteReason || entry.keepReason || 'kept',
    paths: entry.paths.map(filePath => path.relative(process.cwd(), filePath))
  };
}

module.exports = { cleanReports, normalizeReportRetention };
