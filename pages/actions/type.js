const focusInput = require("./focus-input");
const { executeAction } = require("../helpers/execution");
const { describeLocator } = require("../helpers/locators");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function type(connection, target, value, options = {}) {
  return executeAction(`type into ${describeLocator(target)}`, options, async () => {
    let found = false;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        found = await focusInput(connection, target);
        return found;
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to type into ${describeLocator(target)}`
    );

    if (!found) {
      throw new Error(`No input found for ${describeLocator(target)}`);
    }

    await connection.send("Input.insertText", {
      text: String(value)
    });
  });
}

module.exports = type;
