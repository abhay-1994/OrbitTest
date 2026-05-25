// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function createSmartReportState(smartReport) {
  if (!smartReport || !smartReport.enabled) {
    return {
      enabled: false
    };
  }

  return {
    enabled: true,
    slowRequestMs: normalizeSmartNumber(smartReport.slowRequestMs, 2000),
    maxConsoleMessages: 80,
    maxConsoleErrors: 30,
    maxPageErrors: 30,
    maxFailedRequests: 40,
    maxSlowRequests: 40,
    maxRecentRequests: 240,
    maxNavigations: 40,
    maxLifecycle: 60,
    maxDialogs: 30,
    maxConsoleWarnings: 30,
    consoleMessages: [],
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    dialogs: [],
    failedRequests: [],
    slowRequests: [],
    recentRequests: [],
    navigations: [],
    lifecycle: [],
    setupErrors: [],
    requests: new Map(),
    fetchDisabled: false,
    unsubscribe: []
  };
}

function normalizeSmartNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function boundedPush(list, value, limit) {
  list.push(value);

  while (list.length > limit) {
    list.shift();
  }
}

function cloneSmartEntries(entries, limit) {
  return entries.slice(-limit).map(entry => ({ ...entry }));
}

function dedupeSmartRequests(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const key = entry.requestId || `${entry.method}:${entry.url}:${entry.startedAt}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function formatRemoteObject(value) {
  if (!value) {
    return '';
  }

  if (value.value !== undefined) {
    return String(value.value);
  }

  return value.description || value.type || '';
}

function getStackTopLocation(stackTrace) {
  const frame = stackTrace?.callFrames?.[0];

  if (!frame) {
    return null;
  }

  return {
    url: frame.url || null,
    functionName: frame.functionName || null,
    line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null,
    column: Number.isFinite(frame.columnNumber) ? frame.columnNumber + 1 : null
  };
}

function shouldCaptureSmartResponseBody(entry) {
  const status = Number(entry.status || 0);
  const mimeType = String(entry.mimeType || '').toLowerCase();

  return status >= 400 ||
    mimeType.includes('json') ||
    mimeType.includes('text/plain');
}

function shouldCaptureSmartFetchBody(entry, params) {
  const status = Number(params.responseStatusCode || entry.status || 0);

  return status >= 400;
}

function normalizeFetchHeaders(headers = []) {
  if (Array.isArray(headers)) {
    return headers
      .filter(header => header && header.name)
      .map(header => ({
        name: String(header.name),
        value: String(header.value ?? '')
      }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value ?? '')
  }));
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const sensitive = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-session-token|x-access-token|x-secret)$/i;
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = sensitive.test(key) ? '[redacted]' : String(value ?? '');
  }
  return result;
}

function shouldCaptureRequestBody(method) {
  return ['POST', 'PUT', 'PATCH'].includes(String(method || '').toUpperCase());
}

module.exports = {
  createSmartReportState,
  normalizeSmartNumber,
  boundedPush,
  cloneSmartEntries,
  dedupeSmartRequests,
  formatRemoteObject,
  getStackTopLocation,
  shouldCaptureSmartResponseBody,
  shouldCaptureSmartFetchBody,
  normalizeFetchHeaders,
  sanitizeHeaders,
  shouldCaptureRequestBody
};
