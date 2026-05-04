async function waitUntil(check, options, timeoutMessage) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt <= options.timeout) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(options.interval);
  }

  if (lastError) {
    throw new Error(`${timeoutMessage}. Last error: ${lastError.message || lastError}`);
  }

  throw new Error(timeoutMessage);
}

function normalizeWaitOptions(options = {}) {
  if (typeof options === "number") {
    return {
      timeout: options,
      interval: 100
    };
  }

  return {
    timeout: Number(options.timeout || options.timeoutMs || 5000),
    interval: Number(options.interval || options.intervalMs || 100)
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  delay,
  normalizeWaitOptions,
  waitUntil
};
