const { buildLocatorExpression } = require("../helpers/locators");

async function focusInput(connection, target) {
  const response = await connection.send("Runtime.evaluate", {
    expression: buildLocatorExpression(target, "focusInput"),
    returnByValue: true
  });

  return Boolean(response.result?.result?.value);
}

module.exports = focusInput;
