const { buildLocatorExpression, describeLocator } = require("../helpers/locators");

async function findClickablePoint(connection, target) {
  const response = await connection.send("Runtime.evaluate", {
    expression: buildLocatorExpression(target, "clickPoint"),
    returnByValue: true
  });

  const value = response.result?.result?.value;

  if (!value) {
    throw new Error(`No clickable element found for ${describeLocator(target)}`);
  }

  return value;
}

module.exports = findClickablePoint;
