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

    const elapsed = Date.now() - startedAt;
    const remaining = options.timeout - elapsed;

    if (remaining <= 0) {
      break;
    }

    await delay(Math.min(options.interval, remaining));
  }

  if (lastError) {
    throw new Error(`${timeoutMessage}. Last error: ${lastError.message || lastError}`);
  }

  throw new Error(timeoutMessage);
}

function normalizeWaitOptions(options = {}) {
  if (typeof options === "number") {
    return {
      timeout: normalizeInteger(options, 5000),
      interval: 100
    };
  }

  return {
    timeout: normalizeInteger(options.timeout ?? options.timeoutMs, 5000),
    interval: Math.max(10, normalizeInteger(options.interval ?? options.intervalMs, 100))
  };
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  delay,
  normalizeWaitOptions,
  waitUntil
};
