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

  async click(locator) {
    await this.browser.page.click(locator);
  }

  async type(locator, value) {
    await this.browser.page.type(locator, value);
  }

  async hasText(text) {
    return this.browser.page.hasText(text);
  }

  async waitForText(text, options) {
    return this.browser.page.waitForText(text, options);
  }

  async exists(locator) {
    return this.browser.page.exists(locator);
  }

  async waitFor(locator, options) {
    return this.browser.page.waitFor(locator, options);
  }

  async text(locator) {
    return this.browser.page.text(locator);
  }

  async wait(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async screenshot(filePath) {
    return this.browser.screenshot(filePath);
  }

  css(selector) {
    return { css: selector };
  }

  xpath(selector) {
    return { xpath: selector };
  }

  getByRole(role, name) {
    return { role, name };
  }

  getByAttribute(name, value) {
    return { attribute: name, value };
  }

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
