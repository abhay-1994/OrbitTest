const { executeAction } = require("../helpers/execution");
const { buildLocatorExpression, describeLocator } = require("../helpers/locators");
const { delay, normalizeWaitOptions } = require("../helpers/wait");

async function all(connection, target, options = {}) {
  return executeAction(`all ${describeLocator(target)}`, options, async () => {
    const waitOptions = normalizeAllWaitOptions(options);
    const startedAt = Date.now();
    let lastError = null;

    while (true) {
      try {
        const response = await connection.send("Runtime.evaluate", {
          expression: buildLocatorExpression(target, "all"),
          returnByValue: true
        }, {
          timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
        });

        if (response.result?.exceptionDetails) {
          throw new Error(response.result.exceptionDetails.text || `Could not find all ${describeLocator(target)}`);
        }

        const value = response.result?.result?.value;
        const elements = Array.isArray(value) ? value : [];

        if (elements.length > 0 || waitOptions.timeout === 0 || options.allowEmpty === true) {
          return elements;
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

    return [];
  });
}

module.exports = all;

function normalizeAllWaitOptions(options = {}) {
  if (typeof options === "number") {
    return normalizeWaitOptions(options);
  }

  const hasExplicitTimeout = options.timeout !== undefined || options.timeoutMs !== undefined;

  return normalizeWaitOptions({
    ...options,
    timeout: hasExplicitTimeout ? options.timeout ?? options.timeoutMs : 0
  });
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
