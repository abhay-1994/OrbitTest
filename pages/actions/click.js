const findClickablePoint = require("./find-clickable-point");
const { executeAction } = require("../helpers/execution");
const { showClickPoint } = require("../helpers/click-visualizer");
const { describeLocator } = require("../helpers/locators");
const { dispatchMouseEvent } = require("../helpers/input");
const { delay, normalizeWaitOptions, waitUntil } = require("../helpers/wait");

async function click(connection, target, options = {}) {
  return executeAction(`click ${describeLocator(target)}`, options, async () => {
    logAction(options, "Finding:", describeLocator(target));

    let point = null;
    const waitOptions = normalizeWaitOptions(options);

    await waitUntil(
      async () => {
        point = await findClickablePoint(connection, target, options);
        return Boolean(point);
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to click ${describeLocator(target)}`
    );

    const { x, y } = point;
    const navigationWatcher = createNavigationWatcher(connection, options);

    logAction(options, "Clicking at:", x, y);

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
      button: "left",
      clickCount: 1
    }, options)).dialogOpened) {
      return;
    }

    await dispatchMouseEvent(connection, {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    }, options);

    await navigationWatcher.wait();
  });
}

function createNavigationWatcher(connection, options = {}) {
  if (!shouldWaitForNavigation(options)) {
    return {
      wait: async () => false
    };
  }

  const detectionTimeout = normalizeInteger(
    options.navigationDetectionTimeout ?? options.navigationDetectionTimeoutMs,
    500
  );
  const loadTimeout = normalizeInteger(
    options.navigationTimeout ?? options.navigationTimeoutMs,
    10000
  );

  const frameNavigation = connection
    .waitForEvent("Page.frameNavigated", detectionTimeout)
    .then(() => true)
    .catch(() => false);
  const sameDocumentNavigation = connection
    .waitForEvent("Page.navigatedWithinDocument", detectionTimeout)
    .then(() => true)
    .catch(() => false);

  return {
    async wait() {
      const navigated = await Promise.race([frameNavigation, sameDocumentNavigation]);

      if (!navigated) {
        return false;
      }

      await waitForDocumentReady(connection, loadTimeout);
      return true;
    }
  };
}

function shouldWaitForNavigation(options = {}) {
  return Boolean(
    options.waitForNavigation === true ||
    options.navigationTimeout !== undefined ||
    options.navigationTimeoutMs !== undefined ||
    options.navigationDetectionTimeout !== undefined ||
    options.navigationDetectionTimeoutMs !== undefined
  ) && !options.noWaitAfter;
}

async function waitForDocumentReady(connection, timeoutMs) {
  const startedAt = Date.now();
  let stableCompleteCount = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const response = await connection.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true
      }, {
        timeoutMs: Math.min(3000, Math.max(1, timeoutMs))
      });

      if (response.result?.result?.value === "complete") {
        stableCompleteCount++;

        if (stableCompleteCount >= 2) {
          return;
        }
      } else {
        stableCompleteCount = 0;
      }
    } catch (error) {
      stableCompleteCount = 0;
    }

    await delay(100);
  }
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function logAction(options, ...args) {
  if (options.log !== false) {
    console.log(...args);
  }
}

module.exports = click;
