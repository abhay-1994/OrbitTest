const Connection = require('./connection');
const Page = require('../page/page');
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

    this.page = new Page(this.connection);

    console.log("Browser ready");
  }

  async waitForLoad(timeoutMs = 10000) {
    console.log("Waiting for page load...");

    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const response = await this.connection.send("Runtime.evaluate", {
            expression: "document.readyState",
            returnByValue: true
          });

          const state = response.result?.result?.value;

          if (state === "complete") {
            console.log("Page loaded");
            resolve();
            return;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error(`Page did not finish loading. Last readyState: ${state}`));
            return;
          }

          setTimeout(check, 200);
        } catch (error) {
          reject(error);
        }
      };

      check();
    });
  }

  async goto(url) {
    console.log("Navigating to:", url);

    for (let i = 0; i < 3; i++) {
      try {
        const response = await this.connection.send("Page.navigate", { url });

        if (response.error) {
          throw new Error(response.error.message);
        }

        return;
      } catch (error) {
        if (i === 2) {
          throw new Error(`Navigation failed: ${error.message || error}`);
        }

        console.log("Retrying navigation...");
        await new Promise(resolve => setTimeout(resolve, 500));
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

module.exports = Browser;
