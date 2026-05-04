const findClickablePoint = require("./find-clickable-point");
const { executeAction } = require("../helpers/execution");
const { describeLocator } = require("../helpers/locators");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function doubleClick(connection, target, options = {}) {
  return executeAction(`doubleClick ${describeLocator(target)}`, options, async () => {
    console.log("Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findClickablePoint(connection, target);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to double click ${describeLocator(target)}`
    );

    const { x, y } = point;

    console.log("Double clicking at:", x, y);

    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y
    });

    await dispatchClick(connection, x, y, 1);
    await dispatchClick(connection, x, y, 2);
  });
}

async function dispatchClick(connection, x, y, clickCount) {
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount
  });

  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount
  });
}

module.exports = doubleClick;
