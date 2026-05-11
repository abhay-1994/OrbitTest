const findClickablePoint = require("./find-clickable-point");
const { executeAction } = require("../helpers/execution");
const { showClickPoint } = require("../helpers/click-visualizer");
const { describeLocator } = require("../helpers/locators");
const { dispatchMouseEvent } = require("../helpers/input");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function doubleClick(connection, target, options = {}) {
  return executeAction(`doubleClick ${describeLocator(target)}`, options, async () => {
    logAction(options, "Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findClickablePoint(connection, target, options);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to double click ${describeLocator(target)}`
    );

    const { x, y } = point;

    logAction(options, "Double clicking at:", x, y);

    await showClickPoint(connection, x, y, options);

    if ((await dispatchMouseEvent(connection, {
      type: "mouseMoved",
      x,
      y
    }, options)).dialogOpened) {
      return;
    }

    if (await dispatchClick(connection, x, y, 1, options)) {
      return;
    }

    await dispatchClick(connection, x, y, 2, options);
  });
}

function logAction(options, ...args) {
  if (options.log !== false) {
    console.log(...args);
  }
}

async function dispatchClick(connection, x, y, clickCount, options) {
  if ((await dispatchMouseEvent(connection, {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount
  }, options)).dialogOpened) {
    return true;
  }

  const result = await dispatchMouseEvent(connection, {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount
  }, options);

  return result.dialogOpened;
}

module.exports = doubleClick;
