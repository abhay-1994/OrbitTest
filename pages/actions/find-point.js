const { buildLocatorExpression, describeLocator } = require("../helpers/locators");

async function findPoint(connection, target) {
  const response = await connection.send("Runtime.evaluate", {
    expression: buildLocatorExpression(target, "point"),
    returnByValue: true
  });

  const value = response.result?.result?.value;

  if (!value) {
    throw new Error(`No visible element found for ${describeLocator(target)}`);
  }

  return value;
}

module.exports = findPoint;
