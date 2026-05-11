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
        found = await focusInput(connection, target, options);
        return found;
      },
      waitOptions,
      `Timed out after ${waitOptions.timeout}ms waiting to type into ${describeLocator(target)}`
    );

    if (!found) {
      throw new Error(`No input found for ${describeLocator(target)}`);
    }

    await typeLikeKeyboard(connection, value, options);
    await syncActiveInputValue(connection, value);
  });
}

async function typeLikeKeyboard(connection, value, options = {}) {
  const delayMs = normalizeDelay(options.delay || options.delayMs);

  for (const char of Array.from(String(value))) {
    await connection.send("Input.dispatchKeyEvent", {
      type: "char",
      text: char,
      unmodifiedText: char
    });

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }
}

async function syncActiveInputValue(connection, value) {
  const expression = `(() => {
    const element = document.activeElement;
    const value = ${JSON.stringify(String(value))};

    if (!element) {
      return { synced: false, reason: 'No active element' };
    }

    if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { synced: true, value: element.textContent };
    }

    if (!('value' in element)) {
      return { synced: false, reason: 'Active element has no value property' };
    }

    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { synced: true, value: element.value };
  })()`;

  await connection.send("Runtime.evaluate", {
    expression,
    returnByValue: true
  });
}

function normalizeDelay(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return Math.floor(number);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = type;
