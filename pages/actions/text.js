// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { executeAction } = require("../helpers/execution");
const { buildLocatorExpression, describeLocator } = require("../helpers/locators");
const { delay, normalizeWaitOptions } = require("../helpers/wait");

async function text(connection, target, options = {}) {
  return executeAction(`text ${describeLocator(target)}`, options, async () => {
    const waitOptions = normalizeTextWaitOptions(options);
    const startedAt = Date.now();
    let lastError = null;

    while (true) {
      try {
        const response = await connection.send("Runtime.evaluate", {
          expression: buildLocatorExpression(target, "text"),
          returnByValue: true
        }, {
          timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
        });

        if (response.result?.exceptionDetails) {
          throw new Error(response.result.exceptionDetails.text || `Could not evaluate ${describeLocator(target)}`);
        }

        const value = response.result?.result?.value;

        if (value !== null && value !== undefined) {
          return value;
        }
      } catch (error) {
        lastError = error;
      }

      const elapsed = Date.now() - startedAt;

      if (elapsed >= waitOptions.timeout) {
        break;
      }

      await delay(Math.min(waitOptions.interval, waitOptions.timeout - elapsed));
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error(`No visible element found for ${describeLocator(target)} after ${waitOptions.timeout}ms`);
  });
}

module.exports = text;

function normalizeTextWaitOptions(options = {}) {
  if (typeof options === "number") {
    return normalizeWaitOptions(options);
  }

  return normalizeWaitOptions({
    ...options,
    timeout: options.timeout ?? options.timeoutMs ?? 5000
  });
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
