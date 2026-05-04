const hasText = require("./has-text");
const { executeAction } = require("../helpers/execution");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function waitForText(connection, text, options = {}) {
  return executeAction(`waitForText "${text}"`, options, async () => {
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      () => hasText(connection, text, { log: false }),
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting for text "${text}"`
    );

    return true;
  });
}

module.exports = waitForText;
