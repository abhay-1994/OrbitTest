const { executeAction } = require("../helpers/execution");
const { buildLocatorExpression, describeLocator } = require("../helpers/locators");

async function exists(connection, target, options = {}) {
  return executeAction(`exists ${describeLocator(target)}`, options, async () => {
    const response = await connection.send("Runtime.evaluate", {
      expression: buildLocatorExpression(target, "exists"),
      returnByValue: true
    });

    return Boolean(response.result?.result?.value);
  });
}

module.exports = exists;
