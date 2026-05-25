// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { executeAction } = require("../helpers/execution");
const { buildRuntimeEvaluateParams } = require("../helpers/runtime");
const { delay, normalizeWaitOptions } = require("../helpers/wait");

async function hasText(connection, text, options = {}) {
  return executeAction(`hasText "${text}"`, options, async () => {
    const waitOptions = normalizeCheckWaitOptions(options);

    return waitForText(connection, text, waitOptions);
  });
}

async function waitForText(connection, text, options) {
  const startedAt = Date.now();
  const targetText = String(text).toLowerCase();
  let lastError = null;

  while (true) {
    try {
      const response = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
        `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(targetText)})`,
        options
      ));

      if (response.result?.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.text || `Could not check text "${text}"`);
      }

      if (Boolean(response.result?.result?.value)) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }

    const elapsed = Date.now() - startedAt;

    if (elapsed >= options.timeout) {
      break;
    }

    await delay(Math.min(options.interval, options.timeout - elapsed));
  }

  if (lastError) {
    throw lastError;
  }

  return false;
}

function normalizeCheckWaitOptions(options = {}) {
  if (typeof options === "number") {
    return normalizeWaitOptions(options);
  }

  const waitOptions = normalizeWaitOptions({
    ...options,
    timeout: options.timeout ?? options.timeoutMs ?? 5000
  });

  return {
    ...options,
    ...waitOptions
  };
}

module.exports = hasText;
