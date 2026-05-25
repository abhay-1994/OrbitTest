// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { buildLocatorExpression, describeLocator } = require("../helpers/locators");
const { applyPointOffset, buildRuntimeEvaluateParams } = require("../helpers/runtime");

async function findClickablePoint(connection, target, options = {}) {
  const response = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
    buildLocatorExpression(target, "clickPoint"),
    options
  ), {
    timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
  });

  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || `Could not evaluate ${describeLocator(target)}`);
  }

  const value = response.result?.result?.value;

  if (!value) {
    let detail = '';
    try {
      const diagResponse = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
        buildLocatorExpression(target, "diagnose"),
        options
      ), { timeoutMs: 2000 });
      const d = diagResponse.result?.result?.value;
      if (d && typeof d === 'object') {
        if (d.total === 0) {
          detail = ' — no elements matched the locator';
        } else {
          const parts = [`${d.total} element${d.total === 1 ? '' : 's'} matched`];
          if (d.hidden > 0) parts.push(`${d.hidden} hidden`);
          if (d.disabled > 0) parts.push(`${d.disabled} disabled`);
          if (d.clipped > 0) parts.push(`${d.clipped} clipped out of view`);
          detail = ' — ' + parts.join(', ');
        }
      }
    } catch (_) {}
    throw new Error(`No clickable element found for ${describeLocator(target)}${detail}`);
  }

  return applyPointOffset(value, options);
}

module.exports = findClickablePoint;

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
