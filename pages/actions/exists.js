const { executeAction } = require("../helpers/execution");
const { buildLocatorExpression, describeLocator } = require("../helpers/locators");
const { delay, normalizeWaitOptions } = require("../helpers/wait");

async function exists(connection, target, options = {}) {
  return executeAction(`exists ${describeLocator(target)}`, options, async () => {
    const waitOptions = normalizeCheckWaitOptions(options);

    return waitForVisible(connection, target, waitOptions);
  });
}

async function waitForVisible(connection, target, options) {
  const startedAt = Date.now();
  let lastError = null;

  while (true) {
    try {
      const response = await connection.send("Runtime.evaluate", {
        expression: buildLocatorExpression(target, "exists"),
        returnByValue: true
      });

      if (response.result?.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.text || `Could not evaluate ${describeLocator(target)}`);
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

  return normalizeWaitOptions({
    ...options,
    timeout: options.timeout ?? options.timeoutMs ?? 5000
  });
}

module.exports = exists;
