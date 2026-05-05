const exists = require("./exists");
const { executeAction } = require("../helpers/execution");
const { describeLocator } = require("../helpers/locators");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function waitFor(connection, target, options = {}) {
  return executeAction(`waitFor ${describeLocator(target)}`, options, async () => {
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      () => exists(connection, target, { log: false, timeout: 0 }),
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting for ${describeLocator(target)}`
    );

    return true;
  });
}

module.exports = waitFor;
