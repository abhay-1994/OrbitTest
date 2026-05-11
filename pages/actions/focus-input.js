const { buildLocatorExpression } = require("../helpers/locators");

async function focusInput(connection, target, options = {}) {
  const response = await connection.send("Runtime.evaluate", {
    expression: buildLocatorExpression(target, "focusInput"),
    returnByValue: true
  }, {
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
