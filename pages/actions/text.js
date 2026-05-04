const { executeAction } = require("../helpers/execution");
const { buildLocatorExpression, describeLocator } = require("../helpers/locators");

async function text(connection, target, options = {}) {
  return executeAction(`text ${describeLocator(target)}`, options, async () => {
    const response = await connection.send("Runtime.evaluate", {
      expression: buildLocatorExpression(target, "text"),
      returnByValue: true
    });

    const value = response.result?.result?.value;

    if (value === null || value === undefined) {
      throw new Error(`No element found for ${describeLocator(target)}`);
    }

    return value;
  });
}

module.exports = text;
