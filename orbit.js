const Browser = require('./core/browser');
const { launchChrome, closeChrome } = require('./core/launcher');
const getWebSocketUrl = require('./core/target');
const { afterEach, beforeEach, test, run, expect } = require('./runner/runner');

class Orbit {
  constructor(options = {}) {
    this.browser = null;
    this.chromeLaunch = null;
    this.defaultActionOptions = {
      actionTimeout: options.actionTimeout || 0
    };
  }

  async launch() {
    const { port, launch } = await launchChrome();
    this.chromeLaunch = launch;
    const wsUrl = await getWebSocketUrl(port);

    this.browser = new Browser(wsUrl);
    await this.browser.start();
  }

  async open(url, options) {
    await this.browser.goto(url, options);
  }

  async click(locator, options) {
    await this.browser.page.click(locator, this.withActionDefaults(options));
  }

  async hover(locator, options) {
    await this.browser.page.hover(locator, this.withActionDefaults(options));
  }

  async doubleClick(locator, options) {
    await this.browser.page.doubleClick(locator, this.withActionDefaults(options));
  }

  async rightClick(locator, options) {
    await this.browser.page.rightClick(locator, this.withActionDefaults(options));
  }

  async type(locator, value, options) {
    await this.browser.page.type(locator, value, this.withActionDefaults(options));
  }

  async hasText(text, options) {
    return this.browser.page.hasText(text, this.withActionDefaults(options));
  }

  async waitForText(text, options) {
    return this.browser.page.waitForText(text, this.withActionDefaults(options));
  }

  async exists(locator, options) {
    return this.browser.page.exists(locator, this.withActionDefaults(options));
  }

  async waitFor(locator, options) {
    return this.browser.page.waitFor(locator, this.withActionDefaults(options));
  }

  async text(locator, options) {
    return this.browser.page.text(locator, this.withActionDefaults(options));
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

  withActionDefaults(options = {}) {
    return {
      ...this.defaultActionOptions,
      ...options
    };
  }

  async close() {
    if (this.browser) {
      this.browser.close();
    }

    await closeChrome(this.chromeLaunch);
    this.chromeLaunch = null;
  }
}

module.exports = Orbit;
module.exports.Orbit = Orbit;
module.exports.test = test;
module.exports.beforeEach = beforeEach;
module.exports.afterEach = afterEach;
module.exports.expect = expect;
module.exports.run = run;
