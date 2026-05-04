const findClickablePoint = require("./find-clickable-point");
const { executeAction } = require("../helpers/execution");
const { describeLocator } = require("../helpers/locators");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function rightClick(connection, target, options = {}) {
  return executeAction(`rightClick ${describeLocator(target)}`, options, async () => {
    console.log("Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findClickablePoint(connection, target);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to right click ${describeLocator(target)}`
    );

    const { x, y } = point;

    console.log("Right clicking at:", x, y);

    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y
    });

    await connection.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "right",
      clickCount: 1
    });

    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "right",
      clickCount: 1
    });
  });
}

module.exports = rightClick;
