const Browser = require('./core/browser');
const { launchChrome, closeChrome } = require('./core/launcher');
const getWebSocketUrl = require('./core/target');
const { test, run, expect } = require('./runner/runner');

class Orbit {
  constructor() {
    this.browser = null;
  }

  async launch() {
    const { port } = await launchChrome();
    const wsUrl = await getWebSocketUrl(port);

    this.browser = new Browser(wsUrl);
    await this.browser.start();
  }

  async open(url) {
    await this.browser.goto(url);
    await this.browser.waitForLoad();
  }

  async click(text) {
    await this.browser.page.click(text);
  }

  async type(text, value) {
    await this.browser.page.type(text, value);
  }

  async hasText(text) {
    return this.browser.page.hasText(text);
  }

  async screenshot(filePath) {
    return this.browser.screenshot(filePath);
  }

  // 🔥 NEW
  async close() {
    if (this.browser) {
      this.browser.close();
    }

    await closeChrome();
  }
}

module.exports = Orbit;
module.exports.Orbit = Orbit;
module.exports.test = test;
module.exports.expect = expect;
module.exports.run = run;
