const findPoint = require("./find-point");
const { executeAction } = require("../helpers/execution");
const { describeLocator } = require("../helpers/locators");
const { normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function hover(connection, target, options = {}) {
  return executeAction(`hover ${describeLocator(target)}`, options, async () => {
    console.log("Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findPoint(connection, target);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to hover ${describeLocator(target)}`
    );

    const { x, y } = point;

    console.log("Hovering at:", x, y);

    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y
    });
  });
}

module.exports = hover;
