// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { buildLocatorExpression, describeLocator } = require("../helpers/locators");
const { applyPointOffset, buildRuntimeEvaluateParams } = require("../helpers/runtime");

async function findPoint(connection, target, options = {}) {
  const response = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
    buildLocatorExpression(target, "point"),
    options
  ), {
    timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
  });

  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || `Could not evaluate ${describeLocator(target)}`);
  }

  const value = response.result?.result?.value;

  if (!value) {
    throw new Error(`No visible element found for ${describeLocator(target)}`);
  }

  return applyPointOffset(value, options);
}

module.exports = findPoint;

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
