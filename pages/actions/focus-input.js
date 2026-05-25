// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { buildLocatorExpression } = require("../helpers/locators");
const { buildRuntimeEvaluateParams } = require("../helpers/runtime");

async function focusInput(connection, target, options = {}) {
  const response = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
    buildLocatorExpression(target, "focusInput"),
    options
  ), {
    timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
  });

  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text || "Could not focus input");
  }

  return Boolean(response.result?.result?.value);
}

module.exports = focusInput;

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
