// Unit tests for core/browser/smart-report.js and runner/failure-diagnostics.js
// Run with: node --test tests/unit/smart-report.unit.js

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../../core/browser/smart-report');

const { buildFailureDiagnostics } = require('../../runner/failure-diagnostics');
const {
  createSmartFailure,
  getSmartFailureSignals
} = require('../../runner/runner');

// ---------------------------------------------------------------------------
// createSmartReportState
// ---------------------------------------------------------------------------
describe('createSmartReportState', () => {
  it('returns disabled state when smartReport is falsy', () => {
    assert.deepEqual(createSmartReportState(null), { enabled: false });
    assert.deepEqual(createSmartReportState(undefined), { enabled: false });
    assert.deepEqual(createSmartReportState({}), { enabled: false });
    assert.deepEqual(createSmartReportState({ enabled: false }), { enabled: false });
  });

  it('returns enabled state with default slowRequestMs of 2000', () => {
    const state = createSmartReportState({ enabled: true });
    assert.equal(state.enabled, true);
    assert.equal(state.slowRequestMs, 2000);
  });

  it('respects custom slowRequestMs', () => {
    const state = createSmartReportState({ enabled: true, slowRequestMs: 5000 });
    assert.equal(state.slowRequestMs, 5000);
  });

  it('initialises all required list fields as empty arrays', () => {
    const state = createSmartReportState({ enabled: true });
    for (const field of [
      'consoleMessages', 'consoleErrors', 'consoleWarnings',
      'pageErrors', 'dialogs', 'failedRequests',
      'slowRequests', 'recentRequests', 'navigations',
      'lifecycle', 'setupErrors', 'unsubscribe'
    ]) {
      assert.ok(Array.isArray(state[field]), `${field} should be an array`);
      assert.equal(state[field].length, 0, `${field} should start empty`);
    }
  });

  it('initialises requests as a Map', () => {
    const state = createSmartReportState({ enabled: true });
    assert.ok(state.requests instanceof Map);
    assert.equal(state.requests.size, 0);
  });
});

// ---------------------------------------------------------------------------
// normalizeSmartNumber
// ---------------------------------------------------------------------------
describe('normalizeSmartNumber', () => {
  it('returns the value when it is a valid positive number', () => {
    assert.equal(normalizeSmartNumber(3000, 2000), 3000);
    assert.equal(normalizeSmartNumber(0, 2000), 0);
  });

  it('floors decimal values', () => {
    assert.equal(normalizeSmartNumber(1234.9, 2000), 1234);
  });

  it('returns fallback for NaN, null, undefined, negative', () => {
    assert.equal(normalizeSmartNumber(NaN, 2000), 2000);
    assert.equal(normalizeSmartNumber(null, 2000), 2000);
    assert.equal(normalizeSmartNumber(undefined, 2000), 2000);
    assert.equal(normalizeSmartNumber(-1, 2000), 2000);
  });

  it('parses numeric strings', () => {
    assert.equal(normalizeSmartNumber('5000', 2000), 5000);
  });
});

// ---------------------------------------------------------------------------
// boundedPush
// ---------------------------------------------------------------------------
describe('boundedPush', () => {
  it('appends items up to the limit', () => {
    const list = [];
    boundedPush(list, 'a', 3);
    boundedPush(list, 'b', 3);
    boundedPush(list, 'c', 3);
    assert.deepEqual(list, ['a', 'b', 'c']);
  });

  it('evicts the oldest item when the limit is exceeded', () => {
    const list = ['a', 'b', 'c'];
    boundedPush(list, 'd', 3);
    assert.deepEqual(list, ['b', 'c', 'd']);
  });

  it('works with a limit of 1', () => {
    const list = [];
    boundedPush(list, 'x', 1);
    boundedPush(list, 'y', 1);
    assert.deepEqual(list, ['y']);
  });
});

// ---------------------------------------------------------------------------
// cloneSmartEntries
// ---------------------------------------------------------------------------
describe('cloneSmartEntries', () => {
  it('returns shallow clones of the last N entries', () => {
    const entries = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }];
    const result = cloneSmartEntries(entries, 3);
    assert.equal(result.length, 3);
    assert.deepEqual(result, [{ a: 3 }, { a: 4 }, { a: 5 }]);
  });

  it('does not return the original objects (shallow clone)', () => {
    const original = [{ a: 1 }];
    const result = cloneSmartEntries(original, 5);
    assert.notEqual(result[0], original[0]);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(cloneSmartEntries([], 5), []);
  });

  it('returns all entries when limit exceeds length', () => {
    const entries = [{ a: 1 }, { a: 2 }];
    assert.equal(cloneSmartEntries(entries, 100).length, 2);
  });
});

// ---------------------------------------------------------------------------
// dedupeSmartRequests
// ---------------------------------------------------------------------------
describe('dedupeSmartRequests', () => {
  it('removes duplicate requestIds, keeping first occurrence', () => {
    const entries = [
      { requestId: '1', url: 'a' },
      { requestId: '2', url: 'b' },
      { requestId: '1', url: 'a-duplicate' }
    ];
    const result = dedupeSmartRequests(entries);
    assert.equal(result.length, 2);
    assert.equal(result[0].url, 'a');
    assert.equal(result[1].url, 'b');
  });

  it('falls back to method:url:startedAt key when requestId is missing', () => {
    const entries = [
      { method: 'GET', url: '/foo', startedAt: 't1' },
      { method: 'GET', url: '/foo', startedAt: 't1' },
      { method: 'GET', url: '/bar', startedAt: 't1' }
    ];
    const result = dedupeSmartRequests(entries);
    assert.equal(result.length, 2);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(dedupeSmartRequests([]), []);
  });
});

// ---------------------------------------------------------------------------
// formatRemoteObject
// ---------------------------------------------------------------------------
describe('formatRemoteObject', () => {
  it('returns empty string for null/undefined', () => {
    assert.equal(formatRemoteObject(null), '');
    assert.equal(formatRemoteObject(undefined), '');
  });

  it('returns string of .value when present', () => {
    assert.equal(formatRemoteObject({ value: 42 }), '42');
    assert.equal(formatRemoteObject({ value: 'hello' }), 'hello');
  });

  it('returns description when value is absent', () => {
    assert.equal(formatRemoteObject({ description: 'Error: oops' }), 'Error: oops');
  });

  it('falls back to type', () => {
    assert.equal(formatRemoteObject({ type: 'object' }), 'object');
  });
});

// ---------------------------------------------------------------------------
// getStackTopLocation
// ---------------------------------------------------------------------------
describe('getStackTopLocation', () => {
  it('returns null when stackTrace is absent', () => {
    assert.equal(getStackTopLocation(null), null);
    assert.equal(getStackTopLocation(undefined), null);
    assert.equal(getStackTopLocation({}), null);
    assert.equal(getStackTopLocation({ callFrames: [] }), null);
  });

  it('returns the first frame details with 1-based line/column', () => {
    const stackTrace = {
      callFrames: [
        { url: 'https://example.com/app.js', functionName: 'handleClick', lineNumber: 9, columnNumber: 14 }
      ]
    };
    const result = getStackTopLocation(stackTrace);
    assert.equal(result.url, 'https://example.com/app.js');
    assert.equal(result.functionName, 'handleClick');
    assert.equal(result.line, 10);
    assert.equal(result.column, 15);
  });

  it('handles missing functionName gracefully', () => {
    const stackTrace = { callFrames: [{ url: 'https://example.com/app.js', lineNumber: 0, columnNumber: 0 }] };
    const result = getStackTopLocation(stackTrace);
    assert.equal(result.functionName, null);
    assert.equal(result.line, 1);
  });
});

// ---------------------------------------------------------------------------
// shouldCaptureSmartResponseBody
// ---------------------------------------------------------------------------
describe('shouldCaptureSmartResponseBody', () => {
  it('captures for 4xx statuses', () => {
    assert.equal(shouldCaptureSmartResponseBody({ status: 400 }), true);
    assert.equal(shouldCaptureSmartResponseBody({ status: 401 }), true);
    assert.equal(shouldCaptureSmartResponseBody({ status: 404 }), true);
    assert.equal(shouldCaptureSmartResponseBody({ status: 500 }), true);
  });

  it('captures for JSON MIME type', () => {
    assert.equal(shouldCaptureSmartResponseBody({ status: 200, mimeType: 'application/json' }), true);
    assert.equal(shouldCaptureSmartResponseBody({ status: 200, mimeType: 'application/json; charset=utf-8' }), true);
  });

  it('captures for text/plain', () => {
    assert.equal(shouldCaptureSmartResponseBody({ status: 200, mimeType: 'text/plain' }), true);
  });

  it('does not capture for 200 HTML', () => {
    assert.equal(shouldCaptureSmartResponseBody({ status: 200, mimeType: 'text/html' }), false);
  });

  it('does not capture for 200 image', () => {
    assert.equal(shouldCaptureSmartResponseBody({ status: 200, mimeType: 'image/png' }), false);
  });
});

// ---------------------------------------------------------------------------
// shouldCaptureSmartFetchBody
// ---------------------------------------------------------------------------
describe('shouldCaptureSmartFetchBody', () => {
  it('captures when params responseStatusCode >= 400', () => {
    assert.equal(shouldCaptureSmartFetchBody({}, { responseStatusCode: 400 }), true);
    assert.equal(shouldCaptureSmartFetchBody({}, { responseStatusCode: 500 }), true);
  });

  it('falls back to entry.status when params has no responseStatusCode', () => {
    assert.equal(shouldCaptureSmartFetchBody({ status: 401 }, {}), true);
    assert.equal(shouldCaptureSmartFetchBody({ status: 200 }, {}), false);
  });

  it('does not capture for 2xx', () => {
    assert.equal(shouldCaptureSmartFetchBody({}, { responseStatusCode: 200 }), false);
    assert.equal(shouldCaptureSmartFetchBody({}, { responseStatusCode: 201 }), false);
  });
});

// ---------------------------------------------------------------------------
// normalizeFetchHeaders
// ---------------------------------------------------------------------------
describe('normalizeFetchHeaders', () => {
  it('converts array form to name/value objects', () => {
    const input = [{ name: 'content-type', value: 'application/json' }];
    const result = normalizeFetchHeaders(input);
    assert.deepEqual(result, [{ name: 'content-type', value: 'application/json' }]);
  });

  it('converts object form to array of name/value pairs', () => {
    const input = { 'content-type': 'application/json', 'x-request-id': '123' };
    const result = normalizeFetchHeaders(input);
    assert.ok(result.find(h => h.name === 'content-type' && h.value === 'application/json'));
    assert.ok(result.find(h => h.name === 'x-request-id' && h.value === '123'));
  });

  it('filters out entries with no name in array form', () => {
    const input = [{ name: 'valid', value: 'yes' }, { value: 'no-name' }];
    const result = normalizeFetchHeaders(input);
    assert.equal(result.length, 1);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(normalizeFetchHeaders([]), []);
    assert.deepEqual(normalizeFetchHeaders({}), []);
  });
});

// ---------------------------------------------------------------------------
// sanitizeHeaders  (NEW)
// ---------------------------------------------------------------------------
describe('sanitizeHeaders', () => {
  it('returns null for null/undefined/non-object input', () => {
    assert.equal(sanitizeHeaders(null), null);
    assert.equal(sanitizeHeaders(undefined), null);
    assert.equal(sanitizeHeaders('string'), null);
  });

  it('redacts Authorization header', () => {
    const result = sanitizeHeaders({ Authorization: 'Bearer secret-token' });
    assert.equal(result.Authorization, '[redacted]');
  });

  it('redacts Cookie and Set-Cookie headers (case-insensitive)', () => {
    const result = sanitizeHeaders({ cookie: 'session=abc123', 'set-cookie': 'token=xyz' });
    assert.equal(result.cookie, '[redacted]');
    assert.equal(result['set-cookie'], '[redacted]');
  });

  it('redacts x-api-key, x-auth-token, x-csrf-token', () => {
    const result = sanitizeHeaders({
      'x-api-key': 'key123',
      'x-auth-token': 'tok456',
      'x-csrf-token': 'csrf789'
    });
    assert.equal(result['x-api-key'], '[redacted]');
    assert.equal(result['x-auth-token'], '[redacted]');
    assert.equal(result['x-csrf-token'], '[redacted]');
  });

  it('preserves non-sensitive headers', () => {
    const result = sanitizeHeaders({
      'content-type': 'application/json',
      'accept': 'text/html',
      'x-request-id': 'abc'
    });
    assert.equal(result['content-type'], 'application/json');
    assert.equal(result['accept'], 'text/html');
    assert.equal(result['x-request-id'], 'abc');
  });

  it('converts values to strings', () => {
    const result = sanitizeHeaders({ 'x-count': 42 });
    assert.equal(result['x-count'], '42');
  });
});

// ---------------------------------------------------------------------------
// shouldCaptureRequestBody  (NEW)
// ---------------------------------------------------------------------------
describe('shouldCaptureRequestBody', () => {
  it('returns true for POST, PUT, PATCH (case-insensitive)', () => {
    assert.equal(shouldCaptureRequestBody('POST'), true);
    assert.equal(shouldCaptureRequestBody('PUT'), true);
    assert.equal(shouldCaptureRequestBody('PATCH'), true);
    assert.equal(shouldCaptureRequestBody('post'), true);
    assert.equal(shouldCaptureRequestBody('Patch'), true);
  });

  it('returns false for GET, DELETE, HEAD, OPTIONS', () => {
    assert.equal(shouldCaptureRequestBody('GET'), false);
    assert.equal(shouldCaptureRequestBody('DELETE'), false);
    assert.equal(shouldCaptureRequestBody('HEAD'), false);
    assert.equal(shouldCaptureRequestBody('OPTIONS'), false);
  });

  it('returns false for null/undefined', () => {
    assert.equal(shouldCaptureRequestBody(null), false);
    assert.equal(shouldCaptureRequestBody(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// buildFailureDiagnostics
// ---------------------------------------------------------------------------
describe('buildFailureDiagnostics', () => {
  it('returns null when result has no error', () => {
    assert.equal(buildFailureDiagnostics({ error: null }), null);
    assert.equal(buildFailureDiagnostics(null), null);
  });

  it('returns diagnostics object with title, summary, likelyCause, nextActions', () => {
    const result = { error: { message: 'Element not found', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.ok(diag, 'should return an object');
    assert.ok(typeof diag.title === 'string', 'title should be a string');
    assert.ok(typeof diag.summary === 'string', 'summary should be a string');
    assert.ok(typeof diag.likelyCause === 'string', 'likelyCause should be a string');
    assert.ok(Array.isArray(diag.nextActions), 'nextActions should be an array');
    assert.ok(diag.nextActions.length > 0, 'nextActions should not be empty');
  });

  it('identifies click target not actionable errors', () => {
    const result = { error: { message: 'No clickable element found for "Sign In"', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Click target was not actionable');
  });

  it('identifies timeout errors', () => {
    const result = { error: { message: 'Timed out waiting for element', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Timeout reached');
  });

  it('identifies element not found errors', () => {
    const result = { error: { message: 'No visible element found for locator', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Element was not found');
  });

  it('identifies assertion failures', () => {
    const result = { error: { message: 'Expected true to equal false', name: 'AssertionError' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Assertion failed');
  });

  it('identifies navigation failures', () => {
    const result = { error: { message: 'Navigation failed: net::ERR_CONNECTION_REFUSED', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Navigation failed');
  });

  it('identifies browser connection errors', () => {
    const result = { error: { message: 'Chrome connection closed unexpectedly', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Browser connection problem');
  });

  it('identifies invalid CSS selector errors', () => {
    const result = { error: { message: 'invalid css selector: div..broken', name: 'Error' } };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Invalid locator syntax');
  });

  // Smart report insight: visible page error text
  it('surfaces visible page error text as the top insight', () => {
    const result = {
      error: { message: 'No clickable element found', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: { visibleErrorText: 'Invalid credentials' },
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: [],
        ariaAlerts: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Page showed an error message');
    assert.ok(diag.likelyCause.includes('Invalid credentials'));
  });

  // Smart report insight: ARIA alert takes top priority over visible text
  it('surfaces ARIA alert as the highest-priority smart insight', () => {
    const result = {
      error: { message: 'No clickable element found', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [{ role: 'alert', text: 'Your session has expired. Please log in again.' }],
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Application displayed an error notification');
    assert.ok(diag.likelyCause.includes('Your session has expired'));
  });

  // Smart report insight: CORS error from consoleErrors
  it('identifies CORS errors from console errors', () => {
    const result = {
      error: { message: 'No visible element found', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [],
        failedRequests: [],
        consoleErrors: [{ type: 'error', text: 'Access to XMLHttpRequest at https://api.example.com has been blocked by CORS policy' }],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'CORS policy blocked a request');
  });

  // Smart report insight: HTTP 429 rate limiting
  it('identifies rate limiting (HTTP 429)', () => {
    const result = {
      error: { message: 'No visible element found', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [],
        failedRequests: [{ method: 'POST', url: 'https://api.example.com/login', status: 429, errorText: '429 Too Many Requests' }],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Rate limit hit during the test run');
    assert.ok(diag.likelyCause.includes('429'));
  });

  // Smart report insight: page JS error
  it('surfaces page JS errors', () => {
    const result = {
      error: { message: 'Timed out', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [],
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [{ text: 'Uncaught TypeError', message: 'Cannot read properties of undefined' }],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Browser error detected');
    assert.ok(diag.likelyCause.includes('Cannot read properties'));
  });

  // Smart report insight: network failure
  it('surfaces network failures when no higher-priority signal exists', () => {
    const result = {
      error: { message: 'Timed out', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [],
        failedRequests: [{ method: 'GET', url: 'https://api.example.com/config', status: 503, errorText: '503 Service Unavailable' }],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Network failure detected');
    assert.ok(diag.likelyCause.includes('503'));
  });

  // Smart report insight: slow request
  it('surfaces slow request when no errors are present', () => {
    const result = {
      error: { message: 'Timed out', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [],
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [{ method: 'GET', url: 'https://api.example.com/products', durationMs: 8500 }],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Slow request detected');
    assert.ok(diag.likelyCause.includes('8.50s'));
  });

  // Smart report insight: console warning (lowest priority)
  it('surfaces console warnings when nothing else is present', () => {
    const result = {
      error: { message: 'Timed out', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: {},
        ariaAlerts: [],
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [{ type: 'warning', text: 'auth token expiring in 30 seconds' }],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.equal(diag.title, 'Browser console warning detected');
    assert.ok(diag.likelyCause.includes('auth token expiring'));
  });

  it('deduplicates nextActions when both smartInsight and errorInsight contribute', () => {
    const result = {
      error: { message: 'No clickable element found', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: { visibleErrorText: 'Invalid credentials' },
        ariaAlerts: [],
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    };
    const diag = buildFailureDiagnostics(result);
    const unique = new Set(diag.nextActions);
    assert.equal(unique.size, diag.nextActions.length, 'nextActions should have no duplicates');
  });

  it('includes source location when failedStep has a location', () => {
    const result = {
      error: { message: 'Element not found', name: 'Error' },
      trace: {
        failedStep: {
          name: 'click "Submit"',
          url: 'https://example.com/checkout',
          location: { file: 'tests/checkout.test.js', line: 42 }
        }
      }
    };
    const diag = buildFailureDiagnostics(result);
    assert.ok(diag.source, 'source should be set from failedStep');
    assert.equal(diag.source.line, 42);
  });
});

// ---------------------------------------------------------------------------
// runner SmartReportError policy
// ---------------------------------------------------------------------------
describe('runner SmartReportError policy', () => {
  function smartReport(overrides = {}) {
    return {
      enabled: true,
      pageState: {},
      dialogs: [],
      failedRequests: [],
      pageErrors: [],
      consoleErrors: [],
      ...overrides
    };
  }

  it('does not create a SmartReportError when smart report is disabled or clean', () => {
    assert.equal(createSmartFailure(null), null);
    assert.equal(createSmartFailure({ enabled: false }), null);
    assert.equal(createSmartFailure(smartReport()), null);
  });

  it('does not crash when matching known page error text from pageState.textSnippet', () => {
    assert.doesNotThrow(() => {
      createSmartFailure(smartReport({
        pageState: {
          textSnippet: 'Invalid credentials provided. Please try again.'
        }
      }));
    });

    const error = createSmartFailure(smartReport({
      pageState: {
        textSnippet: 'Invalid credentials provided. Please try again.'
      }
    }));

    assert.equal(error.name, 'SmartReportError');
    assert.match(error.message, /Invalid credentials provided/);
    assert.doesNotMatch(error.stack, /findKnownPageError is not defined/);
  });

  it('turns BrowserStack demo failed-request evidence into an intentional SmartReportError', () => {
    const error = createSmartFailure(smartReport({
      pageState: {
        url: 'https://bstackdemo.com/?signin=true'
      },
      failedRequests: [{
        method: 'GET',
        url: 'https://bstackdemo.com/failed-request',
        status: 404,
        statusText: 'Not Found',
        errorText: '404 Not Found',
        responseBody: '<!DOCTYPE html><html><head><title>404: This page could not be found</title></head></html>'
      }]
    }));

    assert.equal(error.name, 'SmartReportError');
    assert.match(error.message, /GET https:\/\/bstackdemo\.com\/failed-request returned 404/);
    assert.equal(error.smartSignals[0].type, 'failed-request');
  });

  it('collects blocking signals from visible messages, dialogs, failed requests, page errors, and console errors', () => {
    const signals = getSmartFailureSignals(smartReport({
      pageState: {
        visibleErrorText: 'Invalid credentials'
      },
      dialogs: [{
        type: 'alert',
        message: 'Payment failed'
      }],
      failedRequests: [{
        method: 'POST',
        url: 'https://api.example.test/checkout',
        status: 500,
        errorText: 'Internal Server Error'
      }],
      pageErrors: [{
        message: 'ReferenceError: cart is not defined'
      }],
      consoleErrors: [{
        text: 'TypeError: Cannot read properties of undefined'
      }]
    }));

    assert.deepEqual(signals.map(signal => signal.type), [
      'visible-message',
      'browser-dialog',
      'failed-request',
      'page-error',
      'console-error'
    ]);
  });

  it('ignores non-blocking console noise but blocks failed request text without an HTTP status', () => {
    assert.deepEqual(getSmartFailureSignals(smartReport({
      consoleErrors: [{
        text: 'Analytics beacon skipped by test environment'
      }]
    })), []);

    const signals = getSmartFailureSignals(smartReport({
      failedRequests: [{
        method: 'POST',
        url: 'https://api.example.test/login',
        errorText: 'Login failed'
      }]
    }));

    assert.equal(signals.length, 1);
    assert.equal(signals[0].type, 'failed-request');
    assert.match(signals[0].summary, /Login failed/);
  });

  it('uses the highest-priority smart signal as the SmartReportError message', () => {
    const error = createSmartFailure(smartReport({
      pageState: {
        visibleErrorText: 'Unauthorized access'
      },
      failedRequests: [{
        method: 'GET',
        url: 'https://api.example.test/profile',
        status: 500,
        errorText: 'Server Error'
      }]
    }));

    assert.match(error.message, /Unauthorized access/);
    assert.doesNotMatch(error.message, /profile/);
  });
});

// ---------------------------------------------------------------------------
// findKnownPageError patterns  (via buildFailureDiagnostics with pageState)
// ---------------------------------------------------------------------------
describe('findKnownPageError pattern coverage', () => {
  function diagForText(text) {
    return buildFailureDiagnostics({
      error: { message: 'click failed', name: 'Error' },
      smartReport: {
        enabled: true,
        pageState: { textSnippet: text },
        ariaAlerts: [],
        failedRequests: [],
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        slowRequests: [],
        recentRequests: []
      }
    });
  }

  const matchingTexts = [
    'Invalid credentials provided',
    'Invalid username or email',
    'Invalid password, please try again',
    'This field is required',
    'Unauthorized access',
    'Access denied',
    'Login failed',
    'Has been blocked by CORS policy',
    'Refused to load the script',
    'Rate limited, please wait',
    'Too many requests, slow down',
    'Session expired, please log in',
    'Token expired',
    'Forbidden resource',
    'Something went wrong',
    'Internal server error',
    'Service unavailable',
    'Validation failed',
    'Payment declined'
  ];

  for (const text of matchingTexts) {
    it(`matches pattern for: "${text}"`, () => {
      const diag = diagForText(text);
      assert.equal(diag.title, 'Page showed an error message', `Expected match for: ${text}`);
    });
  }

  it('does not match generic safe text', () => {
    const diag = diagForText('Welcome to the store. Browse our products.');
    assert.notEqual(diag.title, 'Page showed an error message');
  });
});
