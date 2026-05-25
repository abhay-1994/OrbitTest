// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Browser = require('./browser');
const { launchChrome, closeChrome } = require('./launcher');
const getWebSocketUrl = require('./target');
const { activateTarget, closeTarget, listPageTargets } = require('./target');
const { describeLocator } = require('../pages/helpers/locators');
const { dispatchMouseEvent } = require('../pages/helpers/input');
const {
  buildEvaluationExpression,
  deserializeRemoteValue,
  formatEvaluationError,
  formatEvaluationLabel
} = require('./browser/evaluation');
const {
  clampInteger,
  createMouseApi,
  createVisualApi,
  decodePng,
  normalizePoint,
  pickScreenshotOptions,
  rgbToHex
} = require('./visual');
const { createStorageApi } = require('./storage');
const { resolveFramePath } = require('./frames');
const { resolveShadowPath } = require('./shadow');
const { renderTraceHtml, slugify, formatDuration, toHref, escapeHtml } = require('./reports/trace');
const { createDialogState, serializeDialogForUser, serializeDialogForTrace } = require('./browser/dialogs');
const {
  createSmartReportState,
  boundedPush,
  cloneSmartEntries,
  dedupeSmartRequests,
  formatRemoteObject,
  getStackTopLocation,
  shouldCaptureSmartResponseBody,
  shouldCaptureSmartFetchBody,
  normalizeFetchHeaders,
  sanitizeHeaders,
  shouldCaptureRequestBody
} = require('./browser/smart-report');
const {
  normalizeWindowWaitOptions,
  matchesWindowTarget,
  resolveWindowTarget,
  orderTargets,
  formatWindowSelector,
  matchesWindowSelector
} = require('./browser/windows');
const {
  normalizeBrowserDisplay,
  normalizeViewportOptions,
  normalizeTimeoutOption,
  normalizeAlertOptions,
  normalizePermissionOptions,
  normalizeNonNegativeInteger,
  normalizeOrigin,
  isUrlLike
} = require('./normalize');

class Orbit {
  constructor(options = {}) {
    this.browser = null;
    this.chromeLaunch = null;
    this.chromePort = null;
    this.currentTargetId = null;
    this.windowOrder = [];
    this.trace = createTraceState(options.trace);
    this.debug = createDebugState(options.debug);
    this.studio = createStudioState(options.studio);
    this.dialogs = createDialogState();
    this.smartReport = createSmartReportState(options.smartReport);
    this.verbose = Boolean(options.verbose);
    this.browserDisplay = normalizeBrowserDisplay(options.browserDisplay);
    this.viewport = normalizeViewportOptions(options.viewport || this.studio.viewport);
    this.defaultActionOptions = {
      actionTimeout: options.actionTimeout || 0,
      log: Boolean(options.verbose)
    };
    this.mouse = createMouseApi(this);
    this.visual = createVisualApi(this);
    this.storage = createStorageApi(this);
  }

  async launch() {
    const { port, launch } = await launchChrome({
      log: this.verbose,
      headless: this.browserDisplay === 'hide'
    });
    this.chromeLaunch = launch;
    this.chromePort = port;
    const wsUrl = await getWebSocketUrl(port);
    this.currentTargetId = getTargetIdFromWebSocketUrl(wsUrl);
    this.windowOrder = this.currentTargetId ? [this.currentTargetId] : [];

    this.browser = new Browser(wsUrl, { log: this.verbose });
    await this.browser.start();
    await this.applyViewportOverride();
    await this.prepareVisibleBrowserWindow();
    this.startDialogCapture();
    await this.startSmartReportCapture();
  }

  async prepareVisibleBrowserWindow() {
    if (this.browserDisplay !== 'show' || !this.browser?.connection) {
      return;
    }

    try {
      const windowResponse = await this.browser.connection.send('Browser.getWindowForTarget', {
        targetId: this.currentTargetId
      }, {
        timeoutMs: 1000
      });
      const windowId = windowResponse.result?.windowId;

      if (windowId !== undefined && windowId !== null) {
        await this.browser.connection.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            windowState: 'maximized'
          }
        }, {
          timeoutMs: 1000
        });
      }
    } catch (error) {
      // Some Chrome builds do not allow window management through CDP.
    }

    try {
      await this.browser.connection.send('Page.bringToFront', {}, {
        timeoutMs: 1000
      });
    } catch (error) {
      // The run can continue even if Windows does not grant focus.
    }
  }

  async open(url, options) {
    return this.traceStep(`open ${url}`, () => this.browser.goto(url, options));
  }

  async click(locator, options) {
    return this.traceStep(`click ${formatLocator(locator)}`, () => {
      return this.browser.page.click(locator, this.withActionDefaults(options));
    });
  }

  async hover(locator, options) {
    return this.traceStep(`hover ${formatLocator(locator)}`, () => {
      return this.browser.page.hover(locator, this.withActionDefaults(options));
    });
  }

  async doubleClick(locator, options) {
    return this.traceStep(`doubleClick ${formatLocator(locator)}`, () => {
      return this.browser.page.doubleClick(locator, this.withActionDefaults(options));
    });
  }

  async rightClick(locator, options) {
    return this.traceStep(`rightClick ${formatLocator(locator)}`, () => {
      return this.browser.page.rightClick(locator, this.withActionDefaults(options));
    });
  }

  async type(locator, value, options) {
    return this.traceStep(`type into ${formatLocator(locator)}`, () => {
      return this.browser.page.type(locator, value, this.withActionDefaults(options));
    });
  }

  async hasText(text, options) {
    return this.traceStep(`hasText "${text}"`, () => {
      return this.browser.page.hasText(text, this.withActionDefaults(options));
    });
  }

  async waitForText(text, options) {
    return this.traceStep(`waitForText "${text}"`, () => {
      return this.browser.page.waitForText(text, this.withActionDefaults(options));
    });
  }

  async exists(locator, options) {
    return this.traceStep(`exists ${formatLocator(locator)}`, () => {
      return this.browser.page.exists(locator, this.withActionDefaults(options));
    });
  }

  async all(locator = this.css("*"), options) {
    return this.traceStep(`all ${formatLocator(locator)}`, () => {
      return this.browser.page.all(locator, this.withActionDefaults(options));
    });
  }

  async elements(locator = this.css("*"), options) {
    return this.all(locator, options);
  }

  async waitFor(locator, options) {
    return this.traceStep(`waitFor ${formatLocator(locator)}`, () => {
      return this.browser.page.waitFor(locator, this.withActionDefaults(options));
    });
  }

  async text(locator, options) {
    return this.traceStep(`text ${formatLocator(locator)}`, () => {
      return this.browser.page.text(locator, this.withActionDefaults(options));
    });
  }

  async applyViewportOverride() {
    if (!this.viewport || !this.browser?.connection?.isOpen()) {
      return;
    }

    try {
      await this.browser.connection.send("Emulation.setDeviceMetricsOverride", {
        width: this.viewport.width,
        height: this.viewport.height,
        deviceScaleFactor: this.viewport.deviceScaleFactor,
        mobile: false
      }, {
        timeoutMs: 3000
      });
    } catch (error) {
      // Chrome can still run if viewport override is unavailable.
    }
  }

  async visibleText(locator, options) {
    return this.traceStep(`visibleText ${formatLocator(locator)}`, () => {
      return this.browser.page.visibleText(locator, this.withActionDefaults(options));
    });
  }

  async domText(locator, options) {
    return this.traceStep(`domText ${formatLocator(locator)}`, () => {
      return this.browser.page.domText(locator, this.withActionDefaults(options));
    });
  }

  async url(options) {
    return this.traceStep('url', async () => {
      const pageState = await this.readPageState(options);

      return pageState.url;
    });
  }

  async title(options) {
    return this.traceStep('title', async () => {
      const pageState = await this.readPageState(options);

      return pageState.title;
    });
  }

  async pageState(options) {
    return this.traceStep('pageState', () => this.readPageState(options));
  }

  async wait(ms) {
    return this.traceStep(`wait ${ms}ms`, () => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async screenshot(filePath, options = {}) {
    if (options.handleDialogs !== false) {
      await this.closeBlockingDialogForCapture('screenshot');
    }

    try {
      return await this.browser.screenshot(filePath, options);
    } catch (error) {
      if (options.handleDialogs !== false && await this.closeBlockingDialogForCapture('screenshot retry')) {
        return this.browser.screenshot(filePath, options);
      }

      throw error;
    }
  }

  async evaluate(expressionOrFunction, ...args) {
    return this.traceStep(`evaluate ${formatEvaluationLabel(expressionOrFunction)}`, () => {
      return this.evaluateOnPage(expressionOrFunction, args);
    });
  }

  async evaluateOnPage(expressionOrFunction, args = [], options = {}) {
    const connection = this.requireConnection();
    const expression = buildEvaluationExpression(expressionOrFunction, args);
    const response = await connection.send("Runtime.evaluate", {
      expression,
      ...(options.contextId ? { contextId: options.contextId } : {}),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, {
      timeoutMs: normalizeTimeoutOption(options, 10000)
    });

    if (response.result?.exceptionDetails) {
      throw new Error(formatEvaluationError(response.result.exceptionDetails));
    }

    return deserializeRemoteValue(response.result?.result);
  }

  async dispatchVisualMouse(params, options = {}) {
    const connection = this.requireConnection();
    const result = await dispatchMouseEvent(connection, params, this.withActionDefaults(options));

    return !result.dialogOpened;
  }

  async captureVisualFrame(options = {}) {
    if (options.handleDialogs !== false) {
      await this.closeBlockingDialogForCapture('visual capture');
    }

    const screenshotOptions = pickScreenshotOptions(options);
    const attempts = options.attempts || [
      { format: 'png', fromSurface: true, captureBeyondViewport: false, ...screenshotOptions },
      { format: 'png', fromSurface: false, captureBeyondViewport: false, ...screenshotOptions }
    ];
    const response = await this.browser.captureScreenshot({
      timeoutMs: normalizeTimeoutOption(options, 30000),
      attempts
    });

    return response.result?.data || '';
  }

  async readVisualPixel(point, options = {}) {
    const normalized = normalizePoint(point, options.y);
    const base64 = await this.captureVisualFrame(options);
    const image = decodePng(Buffer.from(base64, 'base64'));
    const dpr = options.devicePixels ? 1 : await this.getDeviceScaleFactor();
    const x = clampInteger(Math.round(normalized.x * dpr), 0, image.width - 1);
    const y = clampInteger(Math.round(normalized.y * dpr), 0, image.height - 1);
    const pixel = image.getPixel(x, y);

    return {
      x: normalized.x,
      y: normalized.y,
      deviceX: x,
      deviceY: y,
      r: pixel.r,
      g: pixel.g,
      b: pixel.b,
      a: pixel.a,
      hex: rgbToHex(pixel.r, pixel.g, pixel.b)
    };
  }

  async getDeviceScaleFactor() {
    try {
      const value = await this.evaluateOnPage('window.devicePixelRatio || 1', [], { timeout: 1000 });
      const number = Number(value);

      return Number.isFinite(number) && number > 0 ? number : 1;
    } catch (error) {
      return 1;
    }
  }

  requireConnection() {
    if (!this.browser?.connection?.isOpen()) {
      throw new Error('Browser is not launched or the connection is closed.');
    }

    return this.browser.connection;
  }

  async waitForAlert(options = {}) {
    const timeoutMs = normalizeTimeoutOption(options, 5000);
    const dialog = await this.waitForDialog(timeoutMs);

    return serializeDialogForUser(dialog);
  }

  async alertText(options = {}) {
    const dialog = this.dialogs.open ||
      (options.includeHandled === false ? null : this.dialogs.history[this.dialogs.history.length - 1]) ||
      await this.waitForDialog(normalizeTimeoutOption(options, 5000));

    if (!dialog) {
      throw new Error("No alert/dialog is available.");
    }

    return dialog.message || '';
  }

  async acceptAlert(options = {}) {
    return this.handleAlert({
      ...normalizeAlertOptions(options),
      accept: true
    });
  }

  async dismissAlert(options = {}) {
    return this.handleAlert({
      ...normalizeAlertOptions(options),
      accept: false
    });
  }

  async handleAlert(options = {}) {
    const alertOptions = normalizeAlertOptions(options);
    const dialog = this.dialogs.open || await this.waitForDialog(alertOptions.timeout);

    if (!dialog) {
      throw new Error(`Timed out after ${alertOptions.timeout}ms waiting for alert/dialog.`);
    }

    if (!this.browser?.connection?.isOpen()) {
      throw new Error("Cannot handle alert/dialog because the browser connection is closed.");
    }

    try {
      await this.browser.connection.send("Page.handleJavaScriptDialog", {
        accept: alertOptions.accept,
        ...(alertOptions.promptText !== undefined ? { promptText: String(alertOptions.promptText) } : {})
      }, {
        timeoutMs: alertOptions.commandTimeout
      });

      dialog.handled = true;
      dialog.handledAt = new Date().toISOString();
      dialog.handledBy = alertOptions.accept ? 'acceptAlert' : 'dismissAlert';
      dialog.closedAt = dialog.closedAt || dialog.handledAt;
      this.dialogs.open = null;
      return serializeDialogForUser(dialog);
    } catch (error) {
      dialog.handleError = error.message || String(error);
      throw error;
    }
  }

  async waitForDialog(timeoutMs) {
    if (this.dialogs.open) {
      return this.dialogs.open;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for alert/dialog.`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        this.dialogs.waiters = this.dialogs.waiters.filter(waiter => waiter !== onDialog);
      };

      const onDialog = dialog => {
        cleanup();
        resolve(dialog);
      };

      this.dialogs.waiters.push(onDialog);
    });
  }

  async grantNotifications(originOrOptions = {}) {
    return this.setNotificationPermission(originOrOptions, 'granted');
  }

  async denyNotifications(originOrOptions = {}) {
    return this.setNotificationPermission(originOrOptions, 'denied');
  }

  async resetNotificationPermission(originOrOptions = {}) {
    const options = normalizePermissionOptions(originOrOptions);
    const origin = options.origin || await this.getCurrentOrigin();

    await this.browser.connection.send("Browser.resetPermissions", {
      ...(options.browserContextId ? { browserContextId: options.browserContextId } : {})
    }, {
      timeoutMs: options.timeout
    });

    return {
      origin,
      permission: 'default'
    };
  }

  async setNotificationPermission(originOrOptions = {}, permission) {
    const options = normalizePermissionOptions(originOrOptions);
    const origin = options.origin || await this.getCurrentOrigin();

    if (!origin) {
      throw new Error("Notification permission requires an origin. Open a page first or pass { origin }.");
    }

    await this.browser.connection.send("Browser.setPermission", {
      origin,
      permission: {
        name: 'notifications'
      },
      setting: permission,
      ...(options.browserContextId ? { browserContextId: options.browserContextId } : {})
    }, {
      timeoutMs: options.timeout
    });

    return {
      origin,
      permission
    };
  }

  async getNotificationPermission() {
    const response = await this.browser.connection.send("Runtime.evaluate", {
      expression: "typeof Notification === 'undefined' ? 'unsupported' : Notification.permission",
      returnByValue: true
    }, {
      timeoutMs: 3000
    });

    return response.result?.result?.value || 'unknown';
  }

  async windows() {
    return this.listWindows();
  }

  async listWindows() {
    this.ensureChromePort();
    const targets = await this.getPageTargets();

    return targets.map((target, index) => ({
      index,
      id: target.id,
      title: target.title,
      url: target.url,
      active: target.id === this.currentTargetId
    }));
  }

  async newWindow(url = 'about:blank', options = {}) {
    if (!this.browser?.connection?.isOpen()) {
      throw new Error("Cannot open a new window because the browser connection is closed.");
    }

    const timeoutMs = normalizeTimeoutOption(options, 5000);
    const response = await this.browser.connection.send("Target.createTarget", {
      url: String(url || 'about:blank')
    }, {
      timeoutMs
    });
    const targetId = response.result?.targetId;

    if (!targetId) {
      throw new Error("Chrome did not return a target id for the new window.");
    }

    const target = await this.waitForWindowTarget(targetId, timeoutMs);

    if (options.switchTo !== false) {
      await this.switchToWindow(targetId);
    }

    return {
      id: target.id,
      title: target.title,
      url: target.url
    };
  }

  async waitForWindow(options = {}) {
    this.ensureChromePort();
    const waitOptions = normalizeWindowWaitOptions(options);
    const startedAt = Date.now();

    while (Date.now() - startedAt < waitOptions.timeout) {
      const targets = await this.getPageTargets();
      const matchOptions = {
        ...waitOptions,
        index: waitOptions.index < 0 ? targets.length + waitOptions.index : waitOptions.index
      };
      const target = targets.find((current, index) => {
        if (matchOptions.excludeCurrent && current.id === this.currentTargetId) {
          return false;
        }

        return matchesWindowTarget({ ...current, index }, matchOptions);
      });

      if (target) {
        if (waitOptions.switchTo) {
          await this.switchToWindow(target.id);
        }

        return {
          id: target.id,
          title: target.title,
          url: target.url
        };
      }

      await delay(waitOptions.interval);
    }

    throw new Error(`Timed out after ${waitOptions.timeout}ms waiting for window/tab.`);
  }

  async switchToWindow(selector = 0) {
    this.ensureChromePort();
    const targets = await this.getPageTargets();
    const target = resolveWindowTarget(targets, selector);

    if (!target) {
      throw new Error(`Could not find window/tab: ${formatWindowSelector(selector)}`);
    }

    await activateTarget(this.chromePort, target.id);
    await this.switchBrowserTarget(target);

    return {
      id: target.id,
      title: target.title,
      url: target.url
    };
  }

  async closeWindow(selector = null, options = {}) {
    this.ensureChromePort();
    const targets = await this.getPageTargets();
    const target = resolveWindowTarget(targets, selector === null ? this.currentTargetId : selector);

    if (!target) {
      throw new Error(`Could not find window/tab: ${formatWindowSelector(selector)}`);
    }

    await closeTarget(this.chromePort, target.id);
    this.windowOrder = this.windowOrder.filter(id => id !== target.id);

    if (target.id === this.currentTargetId && options.switchTo !== false) {
      const remaining = (await this.getPageTargets()).filter(current => current.id !== target.id);

      if (remaining[0]) {
        await this.switchBrowserTarget(remaining[0]);
      } else {
        this.currentTargetId = null;
      }
    }

    return {
      id: target.id,
      title: target.title,
      url: target.url
    };
  }

  async switchBrowserTarget(target) {
    this.cleanupPageListeners();

    if (this.browser) {
      this.browser.close();
    }

    this.dialogs.open = null;
    this.currentTargetId = target.id;
    this.browser = new Browser(target.webSocketDebuggerUrl, { log: this.verbose });
    await this.browser.start();
    this.startDialogCapture();
    await this.startSmartReportCapture();
  }

  async waitForWindowTarget(targetId, timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const target = (await this.getPageTargets()).find(current => current.id === targetId);

      if (target) {
        return target;
      }

      await delay(100);
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for new window/tab.`);
  }

  async getCurrentOrigin() {
    const response = await this.browser.connection.send("Runtime.evaluate", {
      expression: "location.origin === 'null' ? '' : location.origin",
      returnByValue: true
    }, {
      timeoutMs: 3000
    });

    return response.result?.result?.value || '';
  }

  async readPageState(options = {}) {
    if (!this.browser || !this.browser.connection || !this.browser.connection.isOpen()) {
      throw new Error("Cannot read page state because the browser connection is closed.");
    }

    const response = await this.browser.connection.send("Runtime.evaluate", {
      expression: "({ url: location.href, title: document.title, viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio || 1 } })",
      returnByValue: true
    }, {
      timeoutMs: normalizeTimeoutOption(options, 1000)
    });

    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.text || "Could not read page state.");
    }

    const value = response.result?.result?.value || {};

    return {
      url: value.url || '',
      title: value.title || '',
      viewport: value.viewport || null
    };
  }

  ensureChromePort() {
    if (!this.chromePort) {
      throw new Error("Chrome target management is not available before launch.");
    }
  }

  async getPageTargets() {
    const targets = await listPageTargets(this.chromePort);
    this.updateWindowOrder(targets);

    return orderTargets(targets, this.windowOrder);
  }

  updateWindowOrder(targets) {
    const ids = new Set(targets.map(target => target.id));
    this.windowOrder = this.windowOrder.filter(id => ids.has(id));

    for (const target of targets) {
      if (!this.windowOrder.includes(target.id)) {
        this.windowOrder.push(target.id);
      }
    }
  }

  cleanupPageListeners() {
    if (this.dialogs.unsubscribe) {
      this.dialogs.unsubscribe.splice(0).forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch (error) {
          // Ignore listener cleanup errors while switching windows.
        }
      });
    }

    if (this.smartReport.unsubscribe) {
      this.smartReport.unsubscribe.splice(0).forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch (error) {
          // Ignore listener cleanup errors while switching windows.
        }
      });
    }
  }

  css(selector) {
    return { css: selector };
  }

  xpath(selector) {
    return { xpath: selector };
  }

  near(target, anchor) {
    return { type: "near", target, anchor };
  }

  within(anchor, target) {
    return this.near(target, anchor);
  }

  nth(locator, index) {
    return { type: "nth", locator, index };
  }

  first(locator) {
    return this.nth(locator, 0);
  }

  last(locator) {
    return this.nth(locator, -1);
  }

  getByRole(role, name) {
    return { role, name };
  }

  getByAttribute(name, value) {
    return { attribute: name, value };
  }

  async frame(locatorOrPath, options = {}) {
    return this.traceStep(`frame ${formatFrameLocator(locatorOrPath)}`, () => {
      return resolveFramePath(this, null, locatorOrPath, this.withActionDefaults(options));
    });
  }

  async withFrame(locatorOrPath, fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('withFrame() expects a callback function.');
    }

    const frame = await this.frame(locatorOrPath, options);
    return fn(frame);
  }

  async shadow(locatorOrPath, options = {}) {
    return this.traceStep(`shadow ${formatFrameLocator(locatorOrPath)}`, () => {
      return resolveShadowPath(this, null, locatorOrPath, this.withActionDefaults(options));
    });
  }

  async withShadow(locatorOrPath, fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('withShadow() expects a callback function.');
    }

    const shadow = await this.shadow(locatorOrPath, options);
    return fn(shadow);
  }

  withActionDefaults(options = {}) {
    if (typeof options === "number") {
      return {
        ...this.defaultActionOptions,
        timeout: options
      };
    }

    return {
      ...this.defaultActionOptions,
      ...options
    };
  }

  async traceStep(name, fn) {
    if (!this.trace.enabled && !this.debug.enabled && !this.smartReport.enabled && !this.studio.enabled) {
      return fn();
    }

    const location = getUserSourceLocation(new Error().stack);

    await this.pauseForDebugger(`Next step: ${name}`, {
      name,
      location
    });

    if (!this.trace.enabled) {
      const startedAt = Date.now();
      const startedAtIso = new Date().toISOString();
      let status = 'passed';
      let errorInfo = null;

      try {
        return await fn();
      } catch (error) {
        status = 'failed';
        errorInfo = serializeTraceError(error);
        throw error;
      } finally {
        const endedAt = new Date().toISOString();
        await this.settleAfterSmartAction(name);
        await this.captureStudioFrame({
          name,
          status,
          startedAt: startedAtIso,
          endedAt,
          durationMs: Date.now() - startedAt,
          location,
          error: errorInfo
        });
      }
    }

    const step = {
      index: this.trace.steps.length + 1,
      name,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: 0,
      url: null,
      title: null,
      screenshot: null,
      location,
      error: null
    };

    this.trace.steps.push(step);

    const startedAt = Date.now();

    try {
      const result = await fn();
      step.status = 'passed';
      return result;
    } catch (error) {
      step.status = 'failed';
      step.error = {
        name: error.name || 'Error',
        message: error.message || String(error)
      };
      throw error;
    } finally {
      step.durationMs = Date.now() - startedAt;
      step.endedAt = new Date().toISOString();
      await this.settleAfterSmartAction(name);
      await this.captureTraceSnapshot(step);
      await this.writeTrace({ status: 'running' });
      await this.captureStudioFrame(step);
    }
  }

  async settleAfterSmartAction(name) {
    if (!this.smartReport.enabled) {
      return;
    }

    if (!/^(click|doubleClick|rightClick|type into)\b/.test(name)) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async pauseForDebugger(message, step = null) {
    if (!this.debug.enabled || this.debug.paused === false) {
      return;
    }

    if (process.env.ORBITTEST_STEP_AUTO_CONTINUE === '1') {
      return;
    }

    const pageState = await this.getDebugPageState();

    if (this.debug.inspector) {
      const command = await this.debug.inspector.pause({
        ...(step || { name: message, location: null }),
        pageState
      });

      if (command === 'stop') {
        throw new Error('Step run stopped by user');
      }

      return;
    }

    if (!process.stdin.isTTY) {
      return;
    }

    const location = pageState.url ? `\nURL: ${pageState.url}` : '';

    console.log(`\n[Orbit step] ${message}${location}`);
    const answer = await askQuestion('Press Enter to continue, q then Enter to stop: ');

    if (String(answer).trim().toLowerCase() === 'q') {
      throw new Error('Step run stopped by user');
    }
  }

  async getDebugPageState() {
    if (!this.browser || !this.browser.connection || !this.browser.connection.isOpen()) {
      return {};
    }

    try {
      const response = await this.browser.connection.send("Runtime.evaluate", {
        expression: `(() => {
          const errorSelectors = [
            '[role="alert"]',
            '.oxd-alert-content-text',
            '.oxd-input-field-error-message',
            '.error',
            '.alert',
            '.invalid-feedback'
          ];
          const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const visibleMessages = Array.from(document.querySelectorAll(errorSelectors.join(',')))
            .filter(visible)
            .map(element => element.innerText || element.textContent || '')
            .map(text => text.trim())
            .filter(Boolean)
            .filter((text, index, all) => all.indexOf(text) === index)
            .slice(0, 10);
          const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();

          return {
            url: location.href,
            title: document.title,
            visibleMessages,
            visibleErrorText: visibleMessages.join(' | ') || null,
            textSnippet: bodyText.slice(0, 1200)
          };
        })()`,
        returnByValue: true
      }, {
        timeoutMs: 1000
      });

      return response.result?.result?.value || {};
    } catch (error) {
      return {};
    }
  }

  async captureTraceSnapshot(step) {
    if (!this.browser || !this.browser.connection || !this.browser.connection.isOpen()) {
      return;
    }

    const isPostActionSnapshot = isPostActionSnapshotStep(step.name);

    if (isPostActionSnapshot) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (isPostActionSnapshot) {
      await this.captureTraceStepScreenshot(step);
      await this.captureTracePageState(step);
      return;
    }

    await this.captureTracePageState(step);
    await this.captureTraceStepScreenshot(step);
  }

  async captureTracePageState(step) {
    const dialog = await this.closeBlockingDialogForCapture('trace page state');

    if (dialog && !step.dialog) {
      step.dialog = serializeDialogForTrace(dialog);
    }

    try {
      const value = await this.readPageState({ timeout: 1000 });

      step.url = value.url || null;
      step.title = value.title || null;
    } catch (error) {
      step.pageStateError = error.message || String(error);
    }
  }

  async captureTraceStepScreenshot(step) {
    try {
      fs.mkdirSync(this.trace.screenshotsDir, { recursive: true });
      const screenshotPath = path.join(
        this.trace.screenshotsDir,
        `${String(step.index).padStart(2, '0')}-${slugify(step.name)}.png`
      );

      const dialog = await this.closeBlockingDialogForCapture('trace screenshot');

      if (dialog && !step.dialog) {
        step.dialog = serializeDialogForTrace(dialog);
      }

      try {
        await this.captureTraceScreenshot(screenshotPath);
      } catch (error) {
        const lateDialog = await this.closeBlockingDialogForCapture('trace screenshot retry');

        if (!lateDialog) {
          throw error;
        }

        if (!step.dialog) {
          step.dialog = serializeDialogForTrace(lateDialog);
        }

        await this.captureTraceScreenshot(screenshotPath);
      }

      step.screenshot = path.relative(this.trace.dir, screenshotPath);
    } catch (error) {
      step.screenshotError = error.message || String(error);
    }
  }

  async captureTraceScreenshot(screenshotPath) {
    return this.browser.screenshot(screenshotPath, {
      fast: true,
      handleDialogs: false,
      timeoutMs: 7000
    });
  }

  async captureStudioFrame(step) {
    if (!this.studio.enabled || !this.studio.captureFrames || typeof this.studio.emit !== 'function') {
      return;
    }

    const frameIndex = ++this.studio.nextFrameIndex;
    const frame = {
      index: frameIndex,
      testIndex: this.studio.testIndex,
      testName: this.studio.testName,
      file: this.studio.testFile,
      attempt: this.studio.attempt,
      stepIndex: step.index || frameIndex,
      name: step.name || 'step',
      status: step.status || 'unknown',
      startedAt: step.startedAt || null,
      endedAt: step.endedAt || new Date().toISOString(),
      durationMs: step.durationMs || 0,
      url: step.url || null,
      title: step.title || null,
      viewport: null,
      location: step.location || null,
      error: step.error || null,
      screenshot: null,
      screenshotWidth: null,
      screenshotHeight: null,
      screenshotError: null
    };

    try {
      fs.mkdirSync(this.studio.framesDir, { recursive: true });
      const screenshotPath = path.join(
        this.studio.framesDir,
        `${String(frameIndex).padStart(3, '0')}-${slugify(frame.name)}.png`
      );

      const dialog = await this.closeBlockingDialogForCapture('studio frame');

      if (dialog && !frame.dialog) {
        frame.dialog = serializeDialogForTrace(dialog);
      }

      const pageState = await this.readPageState({ timeout: 1000 }).catch(() => null);
      if (pageState) {
        frame.url = pageState.url || frame.url;
        frame.title = pageState.title || frame.title;
        frame.viewport = pageState.viewport || null;
      }

      await this.browser.screenshot(screenshotPath, {
        fast: true,
        handleDialogs: false,
        timeoutMs: 5000
      });

      try {
        const image = decodePng(fs.readFileSync(screenshotPath));
        frame.screenshotWidth = image.width;
        frame.screenshotHeight = image.height;
      } catch (_) {}

      frame.screenshot = path.relative(process.cwd(), screenshotPath).replace(/\\/g, '/');
    } catch (error) {
      frame.screenshotError = error.message || String(error);
    }

    this.studio.emit('frame', frame);
  }

  startDialogCapture() {
    if (!this.browser?.connection?.isOpen()) {
      return;
    }

    const connection = this.browser.connection;

    this.dialogs.unsubscribe.push(
      connection.onEvent("Page.javascriptDialogOpening", message => this.recordDialogOpening(message.params || {})),
      connection.onEvent("Page.javascriptDialogClosed", message => this.recordDialogClosed(message.params || {}))
    );
  }

  recordDialogOpening(params) {
    const dialog = {
      id: this.dialogs.nextId++,
      url: params.url || null,
      frameId: params.frameId || null,
      message: params.message || '',
      type: params.type || 'alert',
      defaultPrompt: params.defaultPrompt || '',
      hasBrowserHandler: params.hasBrowserHandler !== false,
      openedAt: new Date().toISOString(),
      closedAt: null,
      handled: false,
      handledAt: null,
      handledBy: null,
      handleError: null
    };

    this.dialogs.open = dialog;
    boundedPush(this.dialogs.history, dialog, this.dialogs.maxDialogs);

    if (this.smartReport.enabled) {
      boundedPush(this.smartReport.dialogs, dialog, this.smartReport.maxDialogs);
    }

    this.dialogs.waiters.splice(0).forEach(waiter => waiter(dialog));
  }

  recordDialogClosed() {
    if (!this.dialogs.open) {
      return;
    }

    this.dialogs.open.closedAt = new Date().toISOString();
    this.dialogs.open = null;
  }

  async closeBlockingDialogForCapture(reason) {
    const dialog = this.dialogs.open;

    if (!dialog || !this.browser?.connection?.isOpen()) {
      return null;
    }

    try {
      await this.browser.connection.send("Page.handleJavaScriptDialog", {
        accept: true
      }, {
        timeoutMs: 1000
      });

      dialog.handled = true;
      dialog.handledAt = new Date().toISOString();
      dialog.handledBy = reason;
      dialog.closedAt = dialog.closedAt || dialog.handledAt;
      this.dialogs.open = null;
      await new Promise(resolve => setTimeout(resolve, 250));
      return dialog;
    } catch (error) {
      dialog.handleError = error.message || String(error);
      return null;
    }
  }

  async writeTrace({ status = 'running', error = null } = {}) {
    if (!this.trace.enabled) {
      return null;
    }

    fs.mkdirSync(this.trace.dir, { recursive: true });

    this.trace.status = status;
    this.trace.error = error || null;
    this.trace.updatedAt = new Date().toISOString();

    const trace = {
      meta: {
        tool: 'OrbitTest',
        testName: this.trace.testName,
        testFile: this.trace.testFile,
        attempt: this.trace.attempt,
        status: this.trace.status,
        startedAt: this.trace.startedAt,
        updatedAt: this.trace.updatedAt
      },
      error: this.trace.error,
      steps: this.trace.steps
    };

    fs.writeFileSync(this.trace.jsonPath, `${JSON.stringify(trace, null, 2)}\n`);
    fs.writeFileSync(this.trace.htmlPath, renderTraceHtml(trace));

    return {
      json: this.trace.jsonPath,
      html: this.trace.htmlPath
    };
  }

  async recordTestFailure(error) {
    if (!this.trace.enabled && !this.studio.enabled) {
      return;
    }

    if (this.trace.enabled && this.trace.steps.some(step => step.status === 'failed')) {
      return;
    }

    const serialized = serializeTraceError(error);
    const step = {
      index: this.trace.enabled ? this.trace.steps.length + 1 : this.studio.nextFrameIndex + 1,
      name: `test failure: ${serialized.message}`,
      status: 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      url: null,
      title: null,
      screenshot: null,
      location: getUserSourceLocation(serialized.stack),
      error: serialized
    };

    if (this.trace.enabled) {
      this.trace.steps.push(step);
      await this.captureTraceSnapshot(step);
    }

    await this.captureStudioFrame(step);
  }

  async startSmartReportCapture() {
    if (!this.smartReport.enabled || !this.browser?.connection) {
      return;
    }

    const connection = this.browser.connection;
    this.smartReport.fetchDisabled = false;

    try {
      await connection.send("Network.enable", {}, { timeoutMs: 3000 });
    } catch (error) {
      boundedPush(this.smartReport.setupErrors, {
        message: error.message || String(error),
        at: new Date().toISOString()
      }, 10);
    }

    try {
      await connection.send("Fetch.enable", {
        patterns: [{
          urlPattern: "*",
          requestStage: "Response"
        }]
      }, {
        timeoutMs: 3000
      });
    } catch (error) {
      boundedPush(this.smartReport.setupErrors, {
        message: `Fetch response capture unavailable: ${error.message || String(error)}`,
        at: new Date().toISOString()
      }, 10);
    }

    this.smartReport.unsubscribe.push(
      connection.onEvent("Runtime.consoleAPICalled", message => this.recordSmartConsole(message.params || {})),
      connection.onEvent("Runtime.exceptionThrown", message => this.recordSmartPageError(message.params || {})),
      connection.onEvent("Network.requestWillBeSent", message => this.recordSmartRequestStart(message.params || {})),
      connection.onEvent("Network.responseReceived", message => this.recordSmartResponse(message.params || {})),
      connection.onEvent("Network.responseReceivedExtraInfo", message => this.recordSmartResponseExtraInfo(message.params || {})),
      connection.onEvent("Network.loadingFailed", message => this.recordSmartRequestFailure(message.params || {})),
      connection.onEvent("Network.loadingFinished", message => {
        this.recordSmartRequestFinish(message.params || {}).catch(() => {});
      }),
      connection.onEvent("Fetch.requestPaused", message => {
        this.handleSmartFetchPaused(message.params || {}).catch(() => {});
      }),
      connection.onEvent("Page.frameNavigated", message => this.recordSmartNavigation(message.params || {})),
      connection.onEvent("Page.lifecycleEvent", message => this.recordSmartLifecycle(message.params || {}))
    );
  }

  recordSmartConsole(params) {
    const entry = {
      type: params.type || 'log',
      text: Array.isArray(params.args) ? params.args.map(formatRemoteObject).join(' ') : '',
      at: params.timestamp ? new Date(params.timestamp).toISOString() : new Date().toISOString(),
      location: getStackTopLocation(params.stackTrace)
    };

    boundedPush(this.smartReport.consoleMessages, entry, this.smartReport.maxConsoleMessages);

    if (['error', 'assert'].includes(entry.type)) {
      boundedPush(this.smartReport.consoleErrors, entry, this.smartReport.maxConsoleErrors);
    } else if (entry.type === 'warning') {
      boundedPush(this.smartReport.consoleWarnings, entry, this.smartReport.maxConsoleWarnings);
    }
  }

  recordSmartPageError(params) {
    const details = params.exceptionDetails || {};
    const entry = {
      text: details.text || 'Uncaught exception',
      message: details.exception?.description || details.exception?.value || details.text || 'Uncaught exception',
      at: new Date().toISOString(),
      location: getStackTopLocation(details.stackTrace) || {
        url: details.url || null,
        line: Number.isFinite(details.lineNumber) ? details.lineNumber + 1 : null,
        column: Number.isFinite(details.columnNumber) ? details.columnNumber + 1 : null
      }
    };

    boundedPush(this.smartReport.pageErrors, entry, this.smartReport.maxPageErrors);
  }

  recordSmartRequestStart(params) {
    const request = params.request || {};
    const previousEntry = this.smartReport.requests.get(params.requestId);

    if (previousEntry && params.redirectResponse) {
      previousEntry.status = params.redirectResponse.status ?? previousEntry.status;
      previousEntry.statusText = params.redirectResponse.statusText || previousEntry.statusText;
      previousEntry.redirectedTo = request.url || null;
      previousEntry.mimeType = params.redirectResponse.mimeType || previousEntry.mimeType || null;

      if (previousEntry.timestamp && params.timestamp) {
        previousEntry.durationMs = Math.max(0, Math.round((params.timestamp - previousEntry.timestamp) * 1000));
      }
    }

    const entry = {
      requestId: params.requestId,
      method: request.method || 'GET',
      url: request.url || '',
      type: params.type || null,
      status: null,
      statusText: null,
      failed: false,
      errorText: null,
      startedAt: new Date().toISOString(),
      timestamp: params.timestamp || null,
      durationMs: null,
      encodedDataLength: null,
      requestHeaders: sanitizeHeaders(request.headers),
      requestBody: shouldCaptureRequestBody(request.method) && request.postData
        ? String(request.postData).slice(0, 1000)
        : null
    };

    this.smartReport.requests.set(params.requestId, entry);
    boundedPush(this.smartReport.recentRequests, entry, this.smartReport.maxRecentRequests);
  }

  recordSmartResponse(params) {
    const entry = this.smartReport.requests.get(params.requestId);

    if (!entry) {
      return;
    }

    const response = params.response || {};
    entry.status = response.status ?? null;
    entry.statusText = response.statusText || null;
    entry.mimeType = response.mimeType || null;
    entry.responseHeaders = sanitizeHeaders(response.headers);

    if (Number(entry.status) >= 400) {
      entry.failed = true;
      entry.errorText = `${entry.status} ${entry.statusText || ''}`.trim();
      boundedPush(this.smartReport.failedRequests, entry, this.smartReport.maxFailedRequests);
    }
  }

  recordSmartResponseExtraInfo(params) {
    const entry = this.smartReport.requests.get(params.requestId);

    if (!entry) {
      return;
    }

    entry.status = params.statusCode ?? entry.status;

    if (params.headers && !entry.statusText) {
      entry.statusText = params.headers.status || params.headers.Status || entry.statusText;
    }

    if (Number(entry.status) >= 400) {
      entry.failed = true;
      entry.errorText = `${entry.status} ${entry.statusText || ''}`.trim();
      boundedPush(this.smartReport.failedRequests, entry, this.smartReport.maxFailedRequests);
    }
  }

  recordSmartRequestFailure(params) {
    const entry = this.smartReport.requests.get(params.requestId) || {
      requestId: params.requestId,
      method: 'GET',
      url: '',
      type: params.type || null,
      startedAt: new Date().toISOString(),
      timestamp: params.timestamp || null
    };

    entry.failed = true;
    entry.errorText = params.errorText || 'Request failed';
    entry.canceled = Boolean(params.canceled);

    if (entry.timestamp && params.timestamp) {
      entry.durationMs = Math.max(0, Math.round((params.timestamp - entry.timestamp) * 1000));
    }

    boundedPush(this.smartReport.failedRequests, entry, this.smartReport.maxFailedRequests);
  }

  async recordSmartRequestFinish(params) {
    const entry = this.smartReport.requests.get(params.requestId);

    if (!entry) {
      return;
    }

    if (entry.timestamp && params.timestamp) {
      entry.durationMs = Math.max(0, Math.round((params.timestamp - entry.timestamp) * 1000));
    }

    entry.encodedDataLength = params.encodedDataLength ?? null;

    if (entry.durationMs !== null && entry.durationMs >= this.smartReport.slowRequestMs) {
      boundedPush(this.smartReport.slowRequests, entry, this.smartReport.maxSlowRequests);
    }

    await this.captureSmartResponseBody(entry);
  }

  async captureSmartResponseBody(entry) {
    if (!entry || entry.responseBodyCaptured || !this.browser?.connection?.isOpen()) {
      return;
    }

    if (!shouldCaptureSmartResponseBody(entry)) {
      return;
    }

    entry.responseBodyCaptured = true;

    try {
      const response = await this.browser.connection.send("Network.getResponseBody", {
        requestId: entry.requestId
      }, {
        timeoutMs: 5000
      });
      const body = response.result?.body || '';
      const decodedBody = response.result?.base64Encoded
        ? Buffer.from(body, 'base64').toString('utf8')
        : body;

      entry.responseBody = decodedBody.slice(0, 2000);
      entry.responseBodyTruncated = decodedBody.length > 2000;
    } catch (error) {
      entry.responseBodyError = error.message || String(error);
    }
  }

  async handleSmartFetchPaused(params) {
    if (!this.browser?.connection?.isOpen()) {
      return;
    }

    const networkId = params.networkId || params.requestId;
    const entry = this.smartReport.requests.get(networkId);

    if (entry && params.responseStatusCode) {
      entry.status = params.responseStatusCode;
      entry.statusText = params.responseStatusText || entry.statusText || null;

      if (Number(entry.status) >= 400) {
        entry.failed = true;
        entry.errorText = `${entry.status} ${entry.statusText || ''}`.trim();
        boundedPush(this.smartReport.failedRequests, entry, this.smartReport.maxFailedRequests);
      }
    }

    let fulfilledFromCapturedBody = false;

    try {
      if (entry && shouldCaptureSmartFetchBody(entry, params)) {
        const response = await this.browser.connection.send("Fetch.getResponseBody", {
          requestId: params.requestId
        }, {
          timeoutMs: 3000
        });
        const body = response.result?.body || '';
        const decodedBody = response.result?.base64Encoded
          ? Buffer.from(body, 'base64').toString('utf8')
          : body;

        entry.responseBodyCaptured = true;
        entry.responseBody = decodedBody.slice(0, 2000);
        entry.responseBodyTruncated = decodedBody.length > 2000;
        entry.responseBodyError = null;
        fulfilledFromCapturedBody = await this.fulfillSmartFetchResponse(params, body, response.result?.base64Encoded);
      }
    } catch (error) {
      if (entry && !entry.responseBodyError) {
        entry.responseBodyError = error.message || String(error);
      }
    } finally {
      if (fulfilledFromCapturedBody) {
        return;
      }

      try {
        await this.browser.connection.send("Fetch.continueRequest", {
          requestId: params.requestId
        }, {
          timeoutMs: 3000
        });
      } catch (error) {
        // The page may close while smart evidence is being gathered.
      }
    }
  }

  async fulfillSmartFetchResponse(params, body, base64Encoded) {
    if (!params.responseStatusCode) {
      return false;
    }

    try {
      await this.browser.connection.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: params.responseStatusCode,
        responsePhrase: params.responseStatusText || '',
        responseHeaders: normalizeFetchHeaders(params.responseHeaders),
        body: base64Encoded ? body : Buffer.from(body || '', 'utf8').toString('base64')
      }, {
        timeoutMs: 3000
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  recordSmartNavigation(params) {
    const frame = params.frame || {};

    if (!frame.url) {
      return;
    }

    boundedPush(this.smartReport.navigations, {
      url: frame.url,
      name: frame.name || null,
      mimeType: frame.mimeType || null,
      at: new Date().toISOString()
    }, this.smartReport.maxNavigations);
  }

  recordSmartLifecycle(params) {
    if (!params.name) {
      return;
    }

    boundedPush(this.smartReport.lifecycle, {
      name: params.name,
      frameId: params.frameId || null,
      at: new Date().toISOString()
    }, this.smartReport.maxLifecycle);
  }

  async getSmartReportEvidence() {
    if (!this.smartReport.enabled) {
      return null;
    }

    await this.waitForSmartReportSettled();

    await Promise.all(Array.from(this.smartReport.requests.values()).map(request => {
      return this.captureSmartResponseBody(request);
    }));

    await this.stopSmartResponseCapture();
    await this.closeBlockingDialogForCapture('smart report page state');

    return {
      enabled: true,
      capturedAt: new Date().toISOString(),
      pageState: await this.getDebugPageState(),
      dialogs: cloneSmartEntries(this.smartReport.dialogs, 20),
      consoleMessages: cloneSmartEntries(this.smartReport.consoleMessages, 20),
      consoleErrors: cloneSmartEntries(this.smartReport.consoleErrors, 20),
      consoleWarnings: cloneSmartEntries(this.smartReport.consoleWarnings, 20),
      pageErrors: cloneSmartEntries(this.smartReport.pageErrors, 20),
      failedRequests: cloneSmartEntries(dedupeSmartRequests(this.smartReport.failedRequests), 20),
      slowRequests: cloneSmartEntries(this.smartReport.slowRequests, 20),
      recentRequests: cloneSmartEntries(this.smartReport.recentRequests, 120),
      navigations: cloneSmartEntries(this.smartReport.navigations, 20),
      lifecycle: cloneSmartEntries(this.smartReport.lifecycle, 20),
      setupErrors: cloneSmartEntries(this.smartReport.setupErrors, 10),
      slowRequestMs: this.smartReport.slowRequestMs,
      ariaAlerts: await this.captureAriaAlerts()
    };
  }

  async stopSmartResponseCapture() {
    if (!this.smartReport.enabled || this.smartReport.fetchDisabled || !this.browser?.connection?.isOpen()) {
      return;
    }

    this.smartReport.fetchDisabled = true;

    try {
      await this.browser.connection.send("Fetch.disable", {}, {
        timeoutMs: 1000
      });
    } catch (error) {
      boundedPush(this.smartReport.setupErrors, {
        message: `Fetch response capture cleanup failed: ${error.message || String(error)}`,
        at: new Date().toISOString()
      }, 10);
    }
  }

  async captureAriaAlerts() {
    if (!this.browser?.connection?.isOpen()) {
      return [];
    }

    try {
      const result = await this.browser.connection.send('Runtime.evaluate', {
        expression: `(function() {
          var selectors = ['[role="alert"]', '[role="status"]', '[aria-live="assertive"]', '[aria-live="polite"]', '[aria-atomic="true"]'];
          var seen = new Set();
          var alerts = [];
          for (var i = 0; i < selectors.length; i++) {
            try {
              var nodes = document.querySelectorAll(selectors[i]);
              for (var j = 0; j < nodes.length; j++) {
                var el = nodes[j];
                var text = (el.innerText || el.textContent || '').trim();
                if (text && text.length >= 2 && text.length <= 300 && !seen.has(text)) {
                  seen.add(text);
                  alerts.push({ role: el.getAttribute('role') || el.tagName.toLowerCase(), text: text });
                }
              }
            } catch(e) {}
          }
          return alerts;
        })()`,
        returnByValue: true
      }, { timeoutMs: 3000 });

      return Array.isArray(result.result?.value) ? result.result.value : [];
    } catch (error) {
      return [];
    }
  }

  async waitForSmartReportSettled(timeoutMs = 5000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const pending = Array.from(this.smartReport.requests.values()).some(request => {
        return !request.failed &&
          request.status === null &&
          request.durationMs === null &&
          Date.now() - Date.parse(request.startedAt) < 10000;
      });

      if (!pending) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    for (const request of this.smartReport.requests.values()) {
      if (request.status === null && request.durationMs === null && !request.failed) {
        request.pending = true;
        request.errorText = request.errorText || 'No response captured before the test finished';
      }
    }
  }

  async close() {
    this.cleanupPageListeners();

    if (this.browser) {
      this.browser.close();
    }

    await closeChrome(this.chromeLaunch);
    this.chromeLaunch = null;
  }
}

function createTraceState(trace) {
  if (!trace || !trace.enabled) {
    return {
      enabled: false,
      steps: []
    };
  }

  const dir = path.resolve(trace.dir);

  return {
    enabled: true,
    dir,
    screenshotsDir: path.join(dir, 'screenshots'),
    jsonPath: path.join(dir, 'trace.json'),
    htmlPath: path.join(dir, 'trace.html'),
    testName: trace.testName || 'Untitled test',
    testFile: trace.testFile || null,
    attempt: trace.attempt || 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: null,
    error: null,
    steps: []
  };
}

function createDebugState(debug) {
  if (!debug || !debug.enabled) {
    return {
      enabled: false
    };
  }

  return {
    enabled: true,
    paused: debug.pauseBeforeActions !== false,
    inspector: debug.inspector || null
  };
}

function createStudioState(studio) {
  if (!studio || !studio.enabled) {
    return {
      enabled: false,
      captureFrames: false,
      nextFrameIndex: 0,
      emit: null
    };
  }

  const dir = studio.dir
    ? path.resolve(studio.dir)
    : path.join(process.cwd(), 'reports', 'studio-frames');

  return {
    enabled: true,
    captureFrames: studio.captureFrames !== false,
    framesDir: dir,
    testIndex: studio.testIndex || null,
    testName: studio.testName || 'Untitled test',
    testFile: studio.testFile || null,
    attempt: studio.attempt || 1,
    viewport: normalizeViewportOptions(studio.viewport),
    nextFrameIndex: 0,
    emit: typeof studio.emit === 'function' ? studio.emit : null
  };
}

function isPostActionSnapshotStep(name) {
  return /^(click|doubleClick|rightClick)\b/.test(String(name || ''));
}

function serializeTraceError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack || ''
    };
  }

  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || ''
  };
}

function getUserSourceLocation(stack) {
  const lines = String(stack || '').split(/\r?\n/).slice(1);

  for (const line of lines) {
    const location = parseStackLine(line);

    if (!location) {
      continue;
    }

    const normalized = location.file.replace(/\\/g, '/');

    if (normalized.includes('/node_modules/') ||
        normalized.endsWith('/orbit.js') ||
        normalized.includes('/runner/runner.js')) {
      continue;
    }

    return location;
  }

  return null;
}

function parseStackLine(line) {
  const match = String(line).match(/\(?([A-Za-z]:\\[^:)]+|\/[^:)]+):(\d+):(\d+)\)?$/);

  if (!match) {
    return null;
  }

  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3])
  };
}

function askQuestion(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

function getTargetIdFromWebSocketUrl(wsUrl) {
  const value = String(wsUrl || '');

  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const pageIndex = parts.lastIndexOf('page');

    if (pageIndex >= 0 && parts[pageIndex + 1]) {
      return decodeURIComponent(parts[pageIndex + 1]);
    }

    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : null;
  } catch (error) {
    const match = value.match(/\/devtools\/page\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatLocator(locator) {
  try {
    return describeLocator(locator);
  } catch (error) {
    return JSON.stringify(locator);
  }
}

function formatFrameLocator(locatorOrPath) {
  const framePath = Array.isArray(locatorOrPath) ? locatorOrPath : [locatorOrPath];

  return framePath.map(formatLocator).join(' -> ');
}

module.exports = Orbit;
module.exports.Orbit = Orbit;
