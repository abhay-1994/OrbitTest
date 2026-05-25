// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { executeAction } = require("../helpers/execution");
const { buildLocatorExpression, describeLocator } = require("../helpers/locators");
const { buildRuntimeEvaluateParams } = require("../helpers/runtime");
const { delay, normalizeWaitOptions } = require("../helpers/wait");

const TEXT_ACTIONS = {
  text: {
    action: "text",
    label: "text",
    missingMessage: "No visible element found"
  },
  visibleText: {
    action: "visibleText",
    label: "visibleText",
    missingMessage: "No visible element found"
  },
  domText: {
    action: "domText",
    label: "domText",
    missingMessage: "No element found"
  }
};

async function readText(connection, target, options = {}, mode = "text") {
  const config = TEXT_ACTIONS[mode] || TEXT_ACTIONS.text;

  return executeAction(`${config.label} ${describeLocator(target)}`, options, async () => {
    const waitOptions = normalizeTextWaitOptions(options);
    const startedAt = Date.now();
    let lastError = null;

    while (true) {
      try {
        const response = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
          buildLocatorExpression(target, config.action),
          options
        ), {
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

    throw new Error(`${config.missingMessage} for ${describeLocator(target)} after ${waitOptions.timeout}ms`);
  });
}

async function text(connection, target, options = {}) {
  return readText(connection, target, options, "text");
}

async function visibleText(connection, target, options = {}) {
  return readText(connection, target, options, "visibleText");
}

async function domText(connection, target, options = {}) {
  return readText(connection, target, options, "domText");
}

module.exports = text;
module.exports.visibleText = visibleText;
module.exports.domText = domText;

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
