const Connection = require('./connection');
const Page = require('../pages/page');
const fs = require('fs');
const path = require('path');

class Browser {
  constructor(wsUrl, options = {}) {
    this.log = Boolean(options.log);
    this.connection = new Connection(wsUrl, {
      log: this.log
    });
    this.page = null;
  }

  async start() {
    await this.connection.connect();

    await this.connection.send("Page.enable");
    await this.connection.send("DOM.enable");
    await this.connection.send("Runtime.enable");
    await this.connection.send("Page.setLifecycleEventsEnabled", {
      enabled: true
    });

    this.page = new Page(this.connection);

    this.logMessage("Browser ready");
  }

  async waitForLoad(timeoutMs = 15000) {
    this.logMessage("Waiting for page load...");

    const startedAt = Date.now();
    let lastState = "unknown";
    let stableCompleteCount = 0;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await this.connection.send("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true
        }, {
          timeoutMs: 3000
        });

        lastState = response.result?.result?.value || "unknown";

        if (lastState === "complete") {
          stableCompleteCount++;

          if (stableCompleteCount >= 2) {
            this.logMessage("Page loaded");
            return;
          }
        } else {
          stableCompleteCount = 0;
        }
      } catch (error) {
        stableCompleteCount = 0;
        lastState = error.message || String(error);
      }

      await delay(150);
    }

    throw new Error(`Page did not finish loading after ${timeoutMs}ms. Last state: ${lastState}`);
  }

  async goto(url, options = {}) {
    const timeoutMs = options.timeout || options.timeoutMs || 15000;

    this.logMessage("Navigating to:", url);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.connection.send("Page.navigate", { url }, { timeoutMs });
        const result = response.result || {};

        if (result.errorText) {
          throw new Error(result.errorText);
        }

        await this.waitForLoad(timeoutMs);
        return;
      } catch (error) {
        if (attempt === 3 || !isRetryableNavigationError(error)) {
          throw new Error(`Navigation failed for ${url}: ${error.message || error}`);
        }

        this.logMessage(`Retrying navigation (${attempt + 1}/3)...`);
        await delay(500 * attempt);
      }
    }
  }

  logMessage(...args) {
    if (this.log) {
      console.log(...args);
    }
  }

  async screenshot(filePath, options = {}) {
    const response = await this.captureScreenshot(options);

    if (response.error) {
      throw new Error(response.error.message);
    }

    const outputPath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, response.result.data, "base64");

    return outputPath;
  }

  async captureScreenshot(options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const startedAt = Date.now();
    let lastError = null;

    try {
      await this.connection.send("Page.bringToFront", {}, { timeoutMs: 1000 });
    } catch (error) {
      // Screenshot can still work when bringToFront is unavailable.
    }

    const attempts = Array.isArray(options.attempts)
      ? options.attempts
      : options.fast
        ? [
          { format: "png", fromSurface: true },
          { format: "png", fromSurface: false }
        ]
        : [
          { format: "png", fromSurface: true },
          { format: "png", fromSurface: false },
          { format: "png", fromSurface: true, captureBeyondViewport: false },
          { format: "png", fromSurface: false, captureBeyondViewport: false }
        ];

    for (const params of attempts) {
      const elapsed = Date.now() - startedAt;
      const remaining = timeoutMs - elapsed;

      if (remaining <= 0) {
        break;
      }

      try {
        return await this.connection.send("Page.captureScreenshot", params, {
          timeoutMs: Math.max(500, Math.min(remaining, Math.ceil(timeoutMs / attempts.length)))
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to capture screenshot");
  }

  close() {
    this.connection.close();
  }
}

function isRetryableNavigationError(error) {
  const message = String(error.message || error).toLowerCase();

  return message.includes("timeout") ||
    message.includes("context") ||
    message.includes("closed") ||
    message.includes("detached") ||
    message.includes("navigation") ||
    message.includes("net::err_aborted");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = Browser;
