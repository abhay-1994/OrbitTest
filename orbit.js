const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Browser = require('./core/browser');
const { launchChrome, closeChrome } = require('./core/launcher');
const getWebSocketUrl = require('./core/target');
const { activateTarget, closeTarget, listPageTargets } = require('./core/target');
const { afterEach, beforeEach, test, run, expect } = require('./runner/runner');
const { describeLocator } = require('./pages/helpers/locators');
const { renderReportLogo } = require('./runner/report-logo');

class Orbit {
  constructor(options = {}) {
    this.browser = null;
    this.chromeLaunch = null;
    this.chromePort = null;
    this.currentTargetId = null;
    this.windowOrder = [];
    this.trace = createTraceState(options.trace);
    this.debug = createDebugState(options.debug);
    this.dialogs = createDialogState();
    this.smartReport = createSmartReportState(options.smartReport);
    this.verbose = Boolean(options.verbose);
    this.defaultActionOptions = {
      actionTimeout: options.actionTimeout || 0,
      log: Boolean(options.verbose)
    };
  }

  async launch() {
    const { port, launch } = await launchChrome({ log: this.verbose });
    this.chromeLaunch = launch;
    this.chromePort = port;
    const wsUrl = await getWebSocketUrl(port);
    this.currentTargetId = getTargetIdFromWebSocketUrl(wsUrl);
    this.windowOrder = this.currentTargetId ? [this.currentTargetId] : [];

    this.browser = new Browser(wsUrl, { log: this.verbose });
    await this.browser.start();
    this.startDialogCapture();
    await this.startSmartReportCapture();
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
      expression: "({ url: location.href, title: document.title })",
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
      title: value.title || ''
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
    if (!this.trace.enabled && !this.debug.enabled && !this.smartReport.enabled) {
      return fn();
    }

    const location = getUserSourceLocation(new Error().stack);

    await this.pauseForDebugger(`Next step: ${name}`, {
      name,
      location
    });

    if (!this.trace.enabled) {
      const result = await fn();
      await this.settleAfterSmartAction(name);
      return result;
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
    if (!this.trace.enabled) {
      return;
    }

    if (this.trace.steps.some(step => step.status === 'failed')) {
      return;
    }

    const serialized = serializeTraceError(error);
    const step = {
      index: this.trace.steps.length + 1,
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

    this.trace.steps.push(step);
    await this.captureTraceSnapshot(step);
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
      encodedDataLength: null
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
      pageErrors: cloneSmartEntries(this.smartReport.pageErrors, 20),
      failedRequests: cloneSmartEntries(dedupeSmartRequests(this.smartReport.failedRequests), 20),
      slowRequests: cloneSmartEntries(this.smartReport.slowRequests, 20),
      recentRequests: cloneSmartEntries(this.smartReport.recentRequests, 120),
      navigations: cloneSmartEntries(this.smartReport.navigations, 20),
      lifecycle: cloneSmartEntries(this.smartReport.lifecycle, 20),
      setupErrors: cloneSmartEntries(this.smartReport.setupErrors, 10),
      slowRequestMs: this.smartReport.slowRequestMs
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

function createDialogState() {
  return {
    open: null,
    history: [],
    waiters: [],
    maxDialogs: 30,
    nextId: 1,
    unsubscribe: []
  };
}

function createSmartReportState(smartReport) {
  if (!smartReport || !smartReport.enabled) {
    return {
      enabled: false
    };
  }

  return {
    enabled: true,
    slowRequestMs: normalizeSmartNumber(smartReport.slowRequestMs, 2000),
    maxConsoleMessages: 80,
    maxConsoleErrors: 30,
    maxPageErrors: 30,
    maxFailedRequests: 40,
    maxSlowRequests: 40,
    maxRecentRequests: 240,
    maxNavigations: 40,
    maxLifecycle: 60,
    maxDialogs: 30,
    consoleMessages: [],
    consoleErrors: [],
    pageErrors: [],
    dialogs: [],
    failedRequests: [],
    slowRequests: [],
    recentRequests: [],
    navigations: [],
    lifecycle: [],
    setupErrors: [],
    requests: new Map(),
    fetchDisabled: false,
    unsubscribe: []
  };
}

function normalizeSmartNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function boundedPush(list, value, limit) {
  list.push(value);

  while (list.length > limit) {
    list.shift();
  }
}

function cloneSmartEntries(entries, limit) {
  return entries.slice(-limit).map(entry => ({ ...entry }));
}

function dedupeSmartRequests(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const key = entry.requestId || `${entry.method}:${entry.url}:${entry.startedAt}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function formatRemoteObject(value) {
  if (!value) {
    return '';
  }

  if (value.value !== undefined) {
    return String(value.value);
  }

  return value.description || value.type || '';
}

function getStackTopLocation(stackTrace) {
  const frame = stackTrace?.callFrames?.[0];

  if (!frame) {
    return null;
  }

  return {
    url: frame.url || null,
    functionName: frame.functionName || null,
    line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null,
    column: Number.isFinite(frame.columnNumber) ? frame.columnNumber + 1 : null
  };
}

function shouldCaptureSmartResponseBody(entry) {
  const status = Number(entry.status || 0);
  const mimeType = String(entry.mimeType || '').toLowerCase();

  return status >= 400 ||
    mimeType.includes('json') ||
    mimeType.includes('text/plain');
}

function shouldCaptureSmartFetchBody(entry, params) {
  const status = Number(params.responseStatusCode || entry.status || 0);

  return status >= 400;
}

function normalizeFetchHeaders(headers = []) {
  if (Array.isArray(headers)) {
    return headers
      .filter(header => header && header.name)
      .map(header => ({
        name: String(header.name),
        value: String(header.value ?? '')
      }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value ?? '')
  }));
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

function serializeDialogForTrace(dialog) {
  return {
    type: dialog.type || 'alert',
    message: dialog.message || '',
    url: dialog.url || null,
    openedAt: dialog.openedAt || null,
    handled: Boolean(dialog.handled),
    handledAt: dialog.handledAt || null,
    handledBy: dialog.handledBy || null,
    handleError: dialog.handleError || null
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

function normalizeTimeoutOption(options = {}, fallback = 5000) {
  if (typeof options === 'number' || typeof options === 'string') {
    return normalizeNonNegativeInteger(options, fallback);
  }

  if (!options || typeof options !== 'object') {
    return fallback;
  }

  return normalizeNonNegativeInteger(options.timeout ?? options.timeoutMs, fallback);
}

function normalizeAlertOptions(options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const commandTimeout = normalizeNonNegativeInteger(
    source.commandTimeout ?? source.commandTimeoutMs ?? source.handleTimeout ?? source.handleTimeoutMs,
    5000
  );

  return {
    accept: source.accept !== false,
    timeout: normalizeTimeoutOption(options, 5000),
    commandTimeout,
    ...(source.promptText !== undefined ? { promptText: source.promptText } : {})
  };
}

function normalizePermissionOptions(originOrOptions = {}) {
  if (typeof originOrOptions === 'string' || isUrlLike(originOrOptions)) {
    return {
      origin: normalizeOrigin(originOrOptions),
      browserContextId: null,
      timeout: 5000
    };
  }

  const source = originOrOptions && typeof originOrOptions === 'object'
    ? originOrOptions
    : {};

  return {
    origin: normalizeOrigin(source.origin ?? source.url),
    browserContextId: source.browserContextId || null,
    timeout: normalizeTimeoutOption(source, 5000)
  };
}

function normalizeWindowWaitOptions(options = {}) {
  if (typeof options === 'number' || typeof options === 'string' || options instanceof RegExp || typeof options === 'function') {
    return {
      timeout: typeof options === 'number' ? normalizeTimeoutOption(options, 5000) : 5000,
      interval: 150,
      switchTo: false,
      excludeCurrent: true,
      selector: typeof options === 'number' ? null : options,
      id: null,
      url: null,
      title: null,
      index: null,
      predicate: null
    };
  }

  const source = options && typeof options === 'object' ? options : {};
  const index = source.index === undefined ? null : normalizeWindowIndexValue(source.index);

  return {
    timeout: normalizeTimeoutOption(source, 5000),
    interval: normalizeNonNegativeInteger(source.interval ?? source.intervalMs, 150),
    switchTo: Boolean(source.switchTo),
    excludeCurrent: source.excludeCurrent !== false && source.includeCurrent !== true,
    selector: source.selector ?? null,
    id: source.id ?? source.targetId ?? null,
    url: source.url ?? source.href ?? null,
    title: source.title ?? source.name ?? null,
    index,
    predicate: typeof source.predicate === 'function'
      ? source.predicate
      : typeof source.match === 'function'
        ? source.match
        : null
  };
}

function matchesWindowTarget(target, options = {}) {
  if (options.index !== null && options.index !== undefined) {
    if (target.index !== options.index) {
      return false;
    }
  }

  if (options.id) {
    if (target.id !== String(options.id)) {
      return false;
    }
  }

  if (options.url !== null && options.url !== undefined) {
    if (!matchesWindowValue(target.url, options.url, target)) {
      return false;
    }
  }

  if (options.title !== null && options.title !== undefined) {
    if (!matchesWindowValue(target.title, options.title, target)) {
      return false;
    }
  }

  if (options.selector !== null && options.selector !== undefined) {
    if (!matchesWindowSelector(target, options.selector)) {
      return false;
    }
  }

  if (options.predicate) {
    if (!options.predicate(target)) {
      return false;
    }
  }

  return true;
}

function resolveWindowTarget(targets, selector = 0) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return null;
  }

  if (typeof selector === 'number') {
    return getTargetAtIndex(targets, selector);
  }

  if (typeof selector === 'string') {
    const value = selector.trim();

    if (!value) {
      return null;
    }

    return targets.find(target => target.id === value) ||
      targets.find(target => target.url === value || target.title === value) ||
      targets.find(target => matchesWindowSelector(target, value)) ||
      null;
  }

  if (selector instanceof RegExp || typeof selector === 'function') {
    return targets.find(target => matchesWindowSelector(target, selector)) || null;
  }

  if (selector && typeof selector === 'object') {
    if (selector.index !== undefined) {
      return getTargetAtIndex(targets, normalizeWindowIndexValue(selector.index));
    }

    const targetId = selector.id ?? selector.targetId;

    if (targetId) {
      const byId = targets.find(target => target.id === String(targetId));

      if (byId) {
        return byId;
      }
    }

    const options = normalizeWindowWaitOptions({
      ...selector,
      excludeCurrent: false
    });

    return targets.find((target, index) => matchesWindowTarget({ ...target, index }, options)) || null;
  }

  return null;
}

function orderTargets(targets, order) {
  const byId = new Map(targets.map(target => [target.id, target]));
  const ordered = [];
  const seen = new Set();

  for (const id of order) {
    const target = byId.get(id);

    if (target) {
      ordered.push(target);
      seen.add(id);
    }
  }

  for (const target of targets) {
    if (!seen.has(target.id)) {
      ordered.push(target);
    }
  }

  return ordered;
}

function formatWindowSelector(selector) {
  if (selector === null || selector === undefined) {
    return 'current window/tab';
  }

  if (typeof selector === 'number') {
    return `index ${selector}`;
  }

  if (typeof selector === 'string') {
    return `"${selector}"`;
  }

  if (selector instanceof RegExp) {
    return selector.toString();
  }

  if (typeof selector === 'function') {
    return 'predicate function';
  }

  if (selector && typeof selector === 'object') {
    const entries = ['index', 'id', 'targetId', 'url', 'title', 'name']
      .filter(key => selector[key] !== undefined)
      .map(key => `${key}: ${String(selector[key])}`);

    return entries.length ? `{ ${entries.join(', ')} }` : 'window selector object';
  }

  return String(selector);
}

function serializeDialogForUser(dialog) {
  if (!dialog) {
    return null;
  }

  return {
    id: dialog.id,
    type: dialog.type || 'alert',
    message: dialog.message || '',
    defaultPrompt: dialog.defaultPrompt || '',
    url: dialog.url || null,
    openedAt: dialog.openedAt || null,
    closedAt: dialog.closedAt || null,
    handled: Boolean(dialog.handled),
    handledAt: dialog.handledAt || null,
    handledBy: dialog.handledBy || null
  };
}

function matchesWindowSelector(target, selector) {
  if (typeof selector === 'string') {
    const value = selector.trim();

    return target.id === value ||
      matchesWindowValue(target.url, value, target) ||
      matchesWindowValue(target.title, value, target);
  }

  if (selector instanceof RegExp) {
    return matchesWindowValue(target.id, selector, target) ||
      matchesWindowValue(target.url, selector, target) ||
      matchesWindowValue(target.title, selector, target);
  }

  if (typeof selector === 'function') {
    return Boolean(selector(target));
  }

  if (selector && typeof selector === 'object') {
    const options = normalizeWindowWaitOptions({
      ...selector,
      excludeCurrent: false
    });

    return matchesWindowTarget(target, options);
  }

  return false;
}

function matchesWindowValue(value, pattern, target) {
  const text = String(value || '');

  if (Array.isArray(pattern)) {
    return pattern.some(current => matchesWindowValue(value, current, target));
  }

  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }

  if (typeof pattern === 'function') {
    return Boolean(pattern(text, target));
  }

  const expected = String(pattern ?? '').trim();

  if (!expected) {
    return text === '';
  }

  return text === expected || text.includes(expected);
}

function getTargetAtIndex(targets, index) {
  if (!Number.isInteger(index)) {
    return null;
  }

  const normalized = index < 0 ? targets.length + index : index;

  return targets[normalized] || null;
}

function normalizeWindowIndexValue(value) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return Number.NaN;
  }

  return number;
}

function normalizeOrigin(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (isUrlLike(value)) {
    return value.origin === 'null' ? '' : value.origin;
  }

  const origin = String(value).trim();

  if (!origin) {
    return '';
  }

  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(origin)) {
    return origin;
  }

  try {
    const url = new URL(origin);
    return url.origin === 'null' ? '' : url.origin;
  } catch (error) {
    return origin;
  }
}

function isUrlLike(value) {
  return value &&
    typeof value === 'object' &&
    typeof value.href === 'string' &&
    typeof value.origin === 'string';
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
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

function renderTraceHtml(trace) {
  const statusClass = trace.meta.status === 'passed' ? 'passed' : trace.meta.status === 'failed' ? 'failed' : 'running';
  const rows = trace.steps.map(step => {
    const screenshot = step.screenshot
      ? `<a href="${escapeHtml(toHref(step.screenshot))}"><img src="${escapeHtml(toHref(step.screenshot))}" alt="${escapeHtml(step.name)} screenshot"></a>`
      : `<span class="muted">No screenshot${step.screenshotError ? `: ${escapeHtml(step.screenshotError)}` : ''}</span>`;
    const error = step.error
      ? `<div class="error">${escapeHtml(step.error.message)}</div>`
      : '';
    const dialog = step.dialog
      ? `<div class="dialog">Browser ${escapeHtml(step.dialog.type || 'dialog')}: ${escapeHtml(step.dialog.message || '')}${step.dialog.handled ? ' <span class="muted">(auto-closed for screenshot)</span>' : ''}</div>`
      : '';

    return `
      <article class="step ${escapeHtml(step.status)}">
        <div class="step-header">
          <div>
            <span class="index">${step.index}</span>
            <strong>${escapeHtml(step.name)}</strong>
          </div>
          <span class="badge ${escapeHtml(step.status)}">${escapeHtml(step.status)}</span>
        </div>
        <div class="meta">
          <span>${formatDuration(step.durationMs)}</span>
          ${step.url ? `<a href="${escapeHtml(step.url)}">${escapeHtml(step.url)}</a>` : '<span class="muted">No URL</span>'}
          ${step.title ? `<span>${escapeHtml(step.title)}</span>` : ''}
        </div>
        ${dialog}
        ${error}
        <div class="shot">${screenshot}</div>
      </article>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitTest Trace</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d9e0e8;
      --pass: #127a43;
      --pass-bg: #e7f6ee;
      --fail: #b42318;
      --fail-bg: #fde8e7;
      --running: #175cd3;
      --running-bg: #e8f0fe;
      --link: #175cd3;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }

    main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      letter-spacing: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .report-logo {
      width: 56px;
      height: 56px;
      flex: 0 0 56px;
      display: block;
    }

    a {
      color: var(--link);
      overflow-wrap: anywhere;
    }

    .muted,
    .meta {
      color: var(--muted);
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 24px 0;
    }

    .metric,
    .step {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .metric {
      padding: 14px;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }

    .metric strong {
      font-size: 24px;
    }

    .steps {
      display: grid;
      gap: 16px;
    }

    .step {
      overflow: hidden;
    }

    .step-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    .index {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      margin-right: 8px;
      border-radius: 50%;
      background: #eef2f7;
      font-weight: 700;
    }

    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 10px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
    }

    .badge.passed { color: var(--pass); background: var(--pass-bg); }
    .badge.failed { color: var(--fail); background: var(--fail-bg); }
    .badge.running { color: var(--running); background: var(--running-bg); }
    .status.passed { color: var(--pass); }
    .status.failed { color: var(--fail); }
    .status.running { color: var(--running); }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 16px;
      font-size: 13px;
    }

    .error {
      margin: 0 16px 12px;
      padding: 10px 12px;
      border-radius: 8px;
      color: var(--fail);
      background: var(--fail-bg);
      font-weight: 700;
    }

    .dialog {
      margin: 0 16px 12px;
      padding: 10px 12px;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      background: #fff7ed;
      color: #9a3412;
      font-weight: 700;
    }

    .shot {
      padding: 0 16px 16px;
    }

    .shot img {
      display: block;
      width: 100%;
      max-height: 680px;
      object-fit: contain;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    @media (max-width: 720px) {
      main {
        padding: 22px 12px 36px;
      }

      .brand {
        align-items: flex-start;
      }

      .report-logo {
        width: 48px;
        height: 48px;
        flex-basis: 48px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="brand">
      ${renderReportLogo()}
      <div>
        <h1>OrbitTest Trace</h1>
        <div class="muted">${escapeHtml(trace.meta.testName)}${trace.meta.testFile ? ` - ${escapeHtml(trace.meta.testFile)}` : ''}</div>
      </div>
    </header>

    <section class="summary">
      <div class="metric"><span>Status</span><strong class="status ${statusClass}">${escapeHtml(trace.meta.status.toUpperCase())}</strong></div>
      <div class="metric"><span>Steps</span><strong>${trace.steps.length}</strong></div>
      <div class="metric"><span>Attempt</span><strong>${trace.meta.attempt}</strong></div>
      <div class="metric"><span>Updated</span><strong>${escapeHtml(new Date(trace.meta.updatedAt).toLocaleTimeString())}</strong></div>
    </section>

    <section class="steps">
      ${rows || '<p class="muted">No steps recorded.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'step';
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

function toHref(filePath) {
  return filePath.replace(/\\/g, '/');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = Orbit;
module.exports.Orbit = Orbit;
module.exports.test = test;
module.exports.beforeEach = beforeEach;
module.exports.afterEach = afterEach;
module.exports.expect = expect;
module.exports.run = run;
