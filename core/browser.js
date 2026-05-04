const Connection = require('./connection');
const Page = require('../pages/page');
const fs = require('fs');
const path = require('path');

class Browser {
  constructor(wsUrl) {
    this.connection = new Connection(wsUrl);
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

    console.log("Browser ready");
  }

  async waitForLoad(timeoutMs = 15000) {
    console.log("Waiting for page load...");

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
            console.log("Page loaded");
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

    console.log("Navigating to:", url);

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

        console.log(`Retrying navigation (${attempt + 1}/3)...`);
        await delay(500 * attempt);
      }
    }
  }

  async screenshot(filePath) {
    const response = await this.connection.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    const outputPath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, response.result.data, "base64");

    return outputPath;
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
