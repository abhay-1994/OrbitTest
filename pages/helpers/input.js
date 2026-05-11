async function dispatchMouseEvent(connection, params, options = {}) {
  let unsubscribe = null;
  let timeout = null;
  const commandTimeoutMs = normalizeInteger(
    options.inputCommandTimeout ?? options.inputCommandTimeoutMs,
    10000
  );

  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const dialogPromise = new Promise(resolve => {
    unsubscribe = connection.onEvent("Page.javascriptDialogOpening", () => {
      cleanup();
      resolve("dialog");
    });

    timeout = setTimeout(cleanup, normalizeInteger(
      options.dialogDetectionTimeout ?? options.dialogDetectionTimeoutMs,
      1000
    ));
  });
  const commandPromise = connection
    .send("Input.dispatchMouseEvent", params, {
      timeoutMs: commandTimeoutMs
    })
    .then(() => "sent");

  try {
    const result = await Promise.race([commandPromise, dialogPromise]);

    if (result === "dialog") {
      commandPromise.catch(() => {});
      return {
        dialogOpened: true
      };
    }

    return {
      dialogOpened: false
    };
  } catch (error) {
    if (isInputDispatchTimeout(error)) {
      throw new Error(`Mouse input was not delivered within ${commandTimeoutMs}ms. Increase inputCommandTimeoutMs if the page is intentionally blocking input.`);
    }

    throw error;
  } finally {
    cleanup();
  }
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function isInputDispatchTimeout(error) {
  return /Timed out after \d+ms running Input\.dispatchMouseEvent/.test(String(error?.message || error));
}

module.exports = {
  dispatchMouseEvent
};
