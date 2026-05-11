const click = require("./actions/click");
const doubleClick = require("./actions/double-click");
const exists = require("./actions/exists");
const all = require("./actions/all");
const findClickablePoint = require("./actions/find-clickable-point");
const focusInput = require("./actions/focus-input");
const getHTML = require("./actions/get-html");
const hasText = require("./actions/has-text");
const hover = require("./actions/hover");
const rightClick = require("./actions/right-click");
const text = require("./actions/text");
const type = require("./actions/type");
const waitFor = require("./actions/wait-for");
const waitForText = require("./actions/wait-for-text");

class Page {
  constructor(connection) {
    this.connection = connection;
  }

  async getHTML() {
    return getHTML(this.connection);
  }

  async click(target, options = {}) {
    return click(this.connection, target, options);
  }

  async hover(target, options = {}) {
    return hover(this.connection, target, options);
  }

  async doubleClick(target, options = {}) {
    return doubleClick(this.connection, target, options);
  }

  async rightClick(target, options = {}) {
    return rightClick(this.connection, target, options);
  }

  async type(target, value, options = {}) {
    return type(this.connection, target, value, options);
  }

  async hasText(value, options = {}) {
    return hasText(this.connection, value, options);
  }

  async waitForText(value, options = {}) {
    return waitForText(this.connection, value, options);
  }

  async exists(target, options = {}) {
    return exists(this.connection, target, options);
  }

  async all(target, options = {}) {
    return all(this.connection, target, options);
  }

  async waitFor(target, options = {}) {
    return waitFor(this.connection, target, options);
  }

  async text(target, options = {}) {
    return text(this.connection, target, options);
  }

  async findClickablePoint(target) {
    return findClickablePoint(this.connection, target);
  }

  async focusInput(target) {
    return focusInput(this.connection, target);
  }
}

module.exports = Page;
