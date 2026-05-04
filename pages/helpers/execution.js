async function executeAction(name, options, fn) {
  const settings = normalizeExecutionOptions(options);
  const startedAt = Date.now();
  let lastError = null;

  log(settings, `Action: ${name}`);

  for (let attempt = 0; attempt <= settings.retries; attempt++) {
    try {
      const result = settings.timeout
        ? await withTimeout(fn(), settings.timeout, `${name} timed out after ${settings.timeout}ms`)
        : await fn();

      log(settings, `Action passed: ${name} (${Date.now() - startedAt}ms)`);
      return result;
    } catch (error) {
      lastError = error;

      if (attempt >= settings.retries) {
        break;
      }

      log(settings, `Retrying action: ${name} (${attempt + 1}/${settings.retries})`);
      await delay(settings.retryDelay);
    }
  }

  const message = lastError?.message || String(lastError);
  throw new Error(`Action failed: ${name}. ${message}`);
}

function normalizeExecutionOptions(options = {}) {
  return {
    retries: normalizeInteger(options.actionRetries || options.retries || 0, 0),
    retryDelay: normalizeInteger(options.retryDelay || options.retryDelayMs || 100, 100),
    timeout: normalizeInteger(options.actionTimeout || options.actionTimeoutMs || 0, 0),
    log: options.log !== false
  };
}

function normalizeInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function withTimeout(promise, timeoutMs, message) {
  let timeout = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

function log(settings, message) {
  if (settings.log) {
    console.log(message);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  executeAction
};
