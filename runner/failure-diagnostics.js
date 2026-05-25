// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function unique(values) {
  return Array.from(new Set(values));
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

  const ariaAlert = smartReport.ariaAlerts?.[0];

  if (ariaAlert) {
    return {
      title: 'Application displayed an error notification',
      likelyCause: `The page showed an accessible alert or status message: "${ariaAlert.text}"`,
      nextActions: [
        'This message was captured from an ARIA alert or live region — it is the app\'s own error output.',
        'Check whether this is the expected error state for the test flow.',
        'Add an explicit assertion for this message if testing a negative case.'
      ]
    };
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

  const corsError = (smartReport.consoleErrors || []).find(e =>
    /cors policy|cross-origin|blocked by cors/i.test(e.text || '')
  );

  if (corsError) {
    return {
      title: 'CORS policy blocked a request',
      likelyCause: `The browser blocked a cross-origin request: ${corsError.text}`,
      nextActions: [
        'Verify the API server returns the correct Access-Control-Allow-Origin header.',
        'Check that the test environment domain matches the expected CORS origin.',
        'If testing across environments, confirm the server\'s CORS config includes the test URL.'
      ]
    };
  }

  const rateLimited = (smartReport.failedRequests || []).find(r => Number(r.status) === 429);

  if (rateLimited) {
    return {
      title: 'Rate limit hit during the test run',
      likelyCause: `The server returned HTTP 429 (Too Many Requests) for: ${rateLimited.method || 'GET'} ${rateLimited.url || 'unknown URL'}`,
      nextActions: [
        'Add a delay between test runs or reduce parallel workers.',
        'Check whether the test environment has a rate-limit bypass header.',
        'Use request interception to avoid hitting real rate limits in CI.'
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

  const consoleWarning = smartReport.consoleWarnings?.[smartReport.consoleWarnings.length - 1];

  if (consoleWarning) {
    return {
      title: 'Browser console warning detected',
      likelyCause: `The browser logged a warning during the run: ${consoleWarning.text || consoleWarning.type}`,
      nextActions: [
        'Console warnings can indicate deprecated APIs, failed resource loads, or soft validation errors.',
        'Review the Smart Report Evidence section for the full warning text and source location.',
        'If this warning precedes a failure, it may describe the root cause.'
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
    /login failed/i,
    /has been blocked by cors policy/i,
    /refused to (load|connect|execute)/i,
    /cross-origin request blocked/i,
    /rate limit(ed)?/i,
    /too many requests/i,
    /session (expired|invalid|not found)/i,
    /token (expired|invalid|missing|revoked)/i,
    /forbidden/i,
    /not found/i,
    /service unavailable/i,
    /payment (declined|failed)/i,
    /card (declined|invalid)/i,
    /insufficient funds/i,
    /validation (failed|error)/i,
    /field (is )?required/i,
    /something went wrong/i,
    /internal server error/i,
    /bad gateway/i,
    /gateway timeout/i
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

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

module.exports = {
  buildFailureDiagnostics,
  findKnownPageError
};
