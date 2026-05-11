const findClickablePoint = require("./find-clickable-point");
const { executeAction } = require("../helpers/execution");
const { showClickPoint } = require("../helpers/click-visualizer");
const { describeLocator } = require("../helpers/locators");
const { dispatchMouseEvent } = require("../helpers/input");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function rightClick(connection, target, options = {}) {
  return executeAction(`rightClick ${describeLocator(target)}`, options, async () => {
    logAction(options, "Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findClickablePoint(connection, target, options);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to right click ${describeLocator(target)}`
    );

    const { x, y } = point;

    logAction(options, "Right clicking at:", x, y);

    await showClickPoint(connection, x, y, options);

    if ((await dispatchMouseEvent(connection, {
      type: "mouseMoved",
      x,
      y
    }, options)).dialogOpened) {
      return;
    }

    if ((await dispatchMouseEvent(connection, {
      type: "mousePressed",
      x,
      y,
      button: "right",
      clickCount: 1
    }, options)).dialogOpened) {
      return;
    }

    await dispatchMouseEvent(connection, {
      type: "mouseReleased",
      x,
      y,
      button: "right",
      clickCount: 1
    }, options);
  });
}

function logAction(options, ...args) {
  if (options.log !== false) {
    console.log(...args);
  }
}

module.exports = rightClick;
