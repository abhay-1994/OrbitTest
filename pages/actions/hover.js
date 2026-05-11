const findPoint = require("./find-point");
const { executeAction } = require("../helpers/execution");
const { describeLocator } = require("../helpers/locators");
const { dispatchMouseEvent } = require("../helpers/input");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function hover(connection, target, options = {}) {
  return executeAction(`hover ${describeLocator(target)}`, options, async () => {
    logAction(options, "Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findPoint(connection, target, options);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to hover ${describeLocator(target)}`
    );

    const { x, y } = point;

    logAction(options, "Hovering at:", x, y);

    await dispatchMouseEvent(connection, {
      type: "mouseMoved",
      x,
      y
    }, options);
  });
}

function logAction(options, ...args) {
  if (options.log !== false) {
    console.log(...args);
  }
}

module.exports = hover;
