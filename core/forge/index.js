// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { startForgeServer } = require("./server");
const {
  buildOrbitTestScript,
  formatLocator,
  normalizeForgeEvents
} = require("./script");

async function runForge(options = {}) {
  const logger = options.logger || console;
  const cwd = options.cwd || process.cwd();
  const requestedUrl = normalizeRequestedUrl(options.url || "");
  const attachedPages = new Set();
  const recorder = createRecorder({
    startUrl: requestedUrl,
    logger
  });
  let browser = null;
  let recorderBrowser = null;
  let server = null;
  let sigintCount = 0;

  const handleSigint = () => {
    sigintCount++;

    if (sigintCount > 1) {
      process.exit(130);
    }

    recorder.stop("Ctrl+C");
  };

  process.once("SIGINT", handleSigint);

  try {
    server = await startForgeServer({
      recorder,
      cwd,
      output: options.output,
      testName: options.testName,
      activateVerify: () => activateVerifyOnPages(attachedPages, "exists"),
      activateVerifyText: () => activateVerifyOnPages(attachedPages, "text")
    });

    const appLaunch = await launchForgeBrowser({
      role: "app",
      windowPosition: "0,0",
      windowSize: "1000,760"
    });
    browser = appLaunch.browser;

    browser.on("disconnected", () => {
      recorder.stop("app browser closed");
    });

    browser.on("targetcreated", async target => {
      if (target.type() !== "page") {
        return;
      }

      try {
        const page = await target.page();

        if (page) {
          await prepareForgePage(page, recorder, { attachedPages });
        }
      } catch (error) {
        recorder.warn(`Could not attach Forge to a new tab: ${error.message || error}`);
      }
    });

    const page = appLaunch.page;
    await prepareForgePage(page, recorder, { attachedPages });

    if (requestedUrl) {
      await page.goto(requestedUrl, {
        waitUntil: "domcontentloaded",
        timeout: options.navigationTimeout || 30000
      });
    } else {
      await page.goto("about:blank", {
        waitUntil: "domcontentloaded",
        timeout: 10000
      });
    }

    const recorderLaunch = await launchForgeBrowser({
      role: "recorder",
      windowPosition: "0,0",
      windowSize: "720,760",
      appMode: true,
      url: server.url
    });
    recorderBrowser = recorderLaunch.browser;

    recorderBrowser.on("disconnected", () => {
      recorder.stop("recorder browser closed");
    });

    const layout = await arrangeForgeWindows({
      appPage: page,
      recorderPage: recorderLaunch.page,
      logger
    });

    logger.log("");
    logger.log("OrbitTest Forge is recording.");
    logger.log(`Forge panel: ${server.url}`);
    logger.log(`Opened a fresh app browser and a separate recorder browser (${layout.mode} layout).`);
    logger.log("Use the Forge panel for live script preview, Copy Script, Verify Next Click, and Stop Recording.");
    logger.log("Forge will not create a file unless you pass --output.");
    logger.log("");

    await recorder.waitForStop();
  } finally {
    process.removeListener("SIGINT", handleSigint);

    if (browser && browser.isConnected()) {
      await browser.close().catch(() => {});
    }

    if (recorderBrowser && recorderBrowser.isConnected()) {
      await recorderBrowser.close().catch(() => {});
    }

    if (server) {
      await server.close().catch(() => {});
    }
  }

  const events = recorder.events.slice();
  const steps = normalizeForgeEvents(events);
  const outputPath = options.output ? path.resolve(cwd, options.output) : null;
  const scriptOverride = server && typeof server.getScriptOverride === "function"
    ? server.getScriptOverride()
    : null;
  const script = scriptOverride === null
    ? buildOrbitTestScript({
      events,
      startUrl: recorder.startUrl || requestedUrl,
      testName: options.testName
    })
    : scriptOverride;

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, script);
  }

  logger.log("OrbitTest Forge stopped.");
  logger.log(`Reason: ${recorder.stopReason || "recording stopped"}`);
  logger.log(`Steps: ${steps.length}`);

  if (outputPath) {
    logger.log(`File: ${path.relative(cwd, outputPath) || outputPath}`);
  } else {
    logger.log("File: not written. Use Copy Script in the Forge panel, or pass --output to export a file.");
    logger.log("");
    logger.log(script.trimEnd());
  }

  return {
    outputPath,
    script,
    steps,
    events,
    stopReason: recorder.stopReason || "recording stopped"
  };
}

async function launchForgeBrowser(options = {}) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: createForgeBrowserArgs(options)
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  if (options.url) {
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: 10000
    });
  }

  return { browser, page };
}

function createForgeBrowserArgs(options = {}) {
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-popup-blocking",
    `--window-position=${options.windowPosition || "0,0"}`,
    `--window-size=${options.windowSize || "1280,900"}`
  ];

  if (options.appMode && options.url) {
    args.push(`--app=${options.url}`);
  }

  return args;
}

async function arrangeForgeWindows({ appPage, recorderPage, logger = console } = {}) {
  const screen = await readScreenMetrics(appPage);
  const layout = calculateForgeWindowLayout(screen);

  try {
    await Promise.all([
      setPageWindowBounds(appPage, layout.app),
      setPageWindowBounds(recorderPage, layout.recorder)
    ]);
  } catch (error) {
    if (logger && typeof logger.warn === "function") {
      logger.warn(`Could not arrange Forge windows automatically: ${error.message || error}`);
    }
  }

  try {
    await appPage.bringToFront();
    await recorderPage.bringToFront();
  } catch (error) {
    // Window arrangement is best effort.
  }

  return layout;
}

function calculateForgeWindowLayout(screen = {}) {
  const left = normalizeInteger(screen.left, 0);
  const top = normalizeInteger(screen.top, 0);
  const width = clampInteger(screen.width, 900, 3840);
  const height = clampInteger(screen.height, 620, 2160);
  const gap = width >= 1300 ? 12 : 8;

  if (width < 1100) {
    const appHeight = Math.max(360, Math.floor((height - gap) * 0.56));
    const recorderHeight = Math.max(280, height - appHeight - gap);

    return {
      mode: "stacked",
      app: {
        left,
        top,
        width,
        height: appHeight
      },
      recorder: {
        left,
        top: top + appHeight + gap,
        width,
        height: recorderHeight
      }
    };
  }

  const recorderWidth = clampInteger(Math.round(width * 0.38), 480, 760);
  const appWidth = Math.max(680, width - recorderWidth - gap);

  return {
    mode: "side-by-side",
    app: {
      left,
      top,
      width: appWidth,
      height
    },
    recorder: {
      left: left + appWidth + gap,
      top,
      width: Math.max(420, width - appWidth - gap),
      height
    }
  };
}

async function readScreenMetrics(page) {
  try {
    const metrics = await page.evaluate(() => ({
      left: Number(window.screen?.availLeft || 0),
      top: Number(window.screen?.availTop || 0),
      width: Number(window.screen?.availWidth || window.screen?.width || window.outerWidth || 1366),
      height: Number(window.screen?.availHeight || window.screen?.height || window.outerHeight || 768)
    }));

    return {
      left: normalizeInteger(metrics.left, 0),
      top: normalizeInteger(metrics.top, 0),
      width: normalizeInteger(metrics.width, 1366),
      height: normalizeInteger(metrics.height, 768)
    };
  } catch (error) {
    return {
      left: 0,
      top: 0,
      width: 1366,
      height: 768
    };
  }
}

async function setPageWindowBounds(page, bounds) {
  if (!page || page.isClosed()) {
    return;
  }

  const session = await page.target().createCDPSession();

  try {
    const response = await session.send("Browser.getWindowForTarget");
    const windowId = response.windowId;

    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        windowState: "normal"
      }
    }).catch(() => {});

    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      }
    });
  } finally {
    await session.detach().catch(() => {});
  }
}

function clampInteger(value, min, max) {
  const number = normalizeInteger(value, min);

  return Math.min(max, Math.max(min, number));
}

function normalizeInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

async function prepareForgePage(page, recorder, options = {}) {
  if (page.__orbitForgeReady) {
    return;
  }

  page.__orbitForgeReady = true;
  const attachedPages = options.attachedPages || null;

  await page.exposeFunction("__orbittestForgeRecord", payload => {
    recorder.record(payload);
  });

  await page.evaluateOnNewDocument(installForgeClient);

  if (attachedPages) {
    attachedPages.add(page);
    page.once("close", () => attachedPages.delete(page));
  }

  page.on("domcontentloaded", () => {
    injectForgeClient(page).catch(error => {
      recorder.warn(`Could not refresh Forge panel: ${error.message || error}`);
    });
  });

  let hasSeenMainNavigation = false;
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) {
      const url = page.url();

      recorder.observeUrl(url);

      if (hasSeenMainNavigation) {
        recorder.record({
          type: "navigation",
          action: "navigation",
          url,
          time: Date.now()
        });
      }

      hasSeenMainNavigation = true;
    }
  });

  await injectForgeClient(page);
}

async function injectForgeClient(page) {
  if (page.isClosed()) {
    return;
  }

  await page.evaluate(installForgeClient);
}

function createRecorder(options = {}) {
  const events = [];
  const subscribers = [];
  const logger = options.logger || console;
  let startUrl = normalizeMeaningfulUrl(options.startUrl || "");
  let stopResolve = null;
  let stopped = false;
  let stopReason = "";

  return {
    events,
    get startUrl() {
      return startUrl;
    },
    get stopped() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    record(payload) {
      const event = normalizePayload(payload);

      if (!event) {
        return;
      }

      if (event.type === "forge:stop") {
        this.stop("recording control");
        return;
      }

      if (event.url) {
        const meaningful = normalizeMeaningfulUrl(event.url);

        if (!startUrl && meaningful) {
          startUrl = meaningful;
        }
      }

      if (event.type === "page") {
        return;
      }

      const replaced = replaceLiveEvent(events, event);

      if (!replaced) {
        events.push(event);
        logger.log(formatRecordedEvent(event, events.length));

        for (const fn of subscribers) {
          try {
            fn("action", event);
          } catch (_) {}
        }
      }
    },
    observeUrl(url) {
      const meaningful = normalizeMeaningfulUrl(url);

      if (!startUrl && meaningful) {
        startUrl = meaningful;
      }
    },
    stop(reason = "recording stopped") {
      if (stopped) {
        return;
      }

      stopped = true;
      stopReason = reason;

      if (stopResolve) {
        stopResolve();
      }

      for (const fn of subscribers) {
        try {
          fn("stop", { reason });
        } catch (_) {}
      }
    },
    waitForStop() {
      if (stopped) {
        return Promise.resolve();
      }

      return new Promise(resolve => {
        stopResolve = resolve;
      });
    },
    warn(message) {
      logger.warn ? logger.warn(message) : logger.log(message);
    },
    subscribe(fn) {
      subscribers.push(fn);

      return () => {
        const index = subscribers.indexOf(fn);

        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    }
  };
}

function replaceLiveEvent(events, event) {
  const previous = events[events.length - 1];

  if (!previous || !sameLiveLocator(previous.locator, event.locator)) {
    return false;
  }

  if (["input", "select"].includes(event.action) && previous.action === event.action) {
    events[events.length - 1] = event;
    return true;
  }

  return false;
}

function sameLiveLocator(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

async function activateVerifyOnPages(pages, mode = "exists") {
  let activated = false;

  for (const page of Array.from(pages)) {
    if (!page || page.isClosed()) {
      pages.delete(page);
      continue;
    }

    try {
      const result = await page.evaluate((verifyMode) => {
        if (typeof window.__orbittestForgeSetAssertNext !== "function") {
          return false;
        }

        window.__orbittestForgeSetAssertNext(verifyMode);
        return true;
      }, mode);

      activated = activated || Boolean(result);
    } catch (error) {
      // Some pages may be navigating while the user clicks the Forge panel.
    }
  }

  return activated;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    type: String(payload.type || payload.action || ""),
    action: String(payload.action || payload.type || ""),
    locator: payload.locator || null,
    value: payload.secret ? "" : payload.value,
    secret: Boolean(payload.secret),
    secretName: payload.secretName || null,
    text: payload.text || "",
    url: payload.url || "",
    title: payload.title || "",
    time: Number(payload.time || Date.now())
  };
}

function formatRecordedEvent(event, index) {
  const label = event.action || event.type;
  const target = event.locator ? recordedLocatorLabel(event.locator) : event.text || "";

  if (event.secret) {
    return `${index}. ${label} ${target} [secret]`.trim();
  }

  if (event.action === "input") {
    return `${index}. ${label} ${target} [text]`.trim();
  }

  if (event.action === "select" && event.value !== undefined && event.value !== "") {
    return `${index}. ${label} ${target} = ${String(event.value).slice(0, 80)}`.trim();
  }

  return `${index}. ${label} ${target}`.trim();
}

function recordedLocatorLabel(locator) {
  if (!locator || typeof locator !== "object") {
    return "";
  }

  const kind = locator.kind || locator.type;

  if (kind === "nth") {
    const label = recordedLocatorLabel(locator.locator || locator.target || locator.of);
    const index = Number(locator.index);
    const suffix = Number.isInteger(index) && index >= 0 ? ` #${index + 1}` : "";

    return `${label}${suffix}`.trim();
  }

  if (kind === "near") {
    const target = recordedLocatorLabel(locator.target || locator.locator || locator.of);
    const anchor = recordedLocatorLabel(locator.anchor || locator.near || locator.context || locator.within);

    return `${target} near ${anchor}`.trim();
  }

  return locator.name || locator.text || locator.selector || locator.role || "";
}

function normalizeRequestedUrl(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (/^(about|data|file|https?):/i.test(text)) {
    return text;
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(text)) {
    return `http://${text}`;
  }

  return `https://${text}`;
}

function normalizeMeaningfulUrl(url) {
  const text = String(url || "").trim();

  if (!text || /^(about:blank|data:)/i.test(text)) {
    return "";
  }

  return text;
}

function installForgeClient() {
  if (window.__orbittestForgeInstalled) {
    return;
  }

  window.__orbittestForgeInstalled = true;

  const state = {
    assertNext: false
  };

  function send(payload) {
    const api = window.__orbittestForgeRecord;

    if (typeof api !== "function") {
      return;
    }

    Promise.resolve(api({
      ...payload,
      url: location.href,
      title: document.title,
      time: Date.now()
    })).catch(() => {});
  }

  window.__orbittestForgeSetAssertNext = (mode) => {
    state.assertNext = mode || "exists";
    return true;
  };

  function eventElement(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path.find(item => item instanceof Element) || event.target;

    return target instanceof Element ? target : null;
  }

  function handleClick(event) {
    const target = eventElement(event);

    if (!target) {
      return;
    }

    const element = bestRecordTarget(target);
    const locator = locatorFor(element);

    if (!locator) {
      return;
    }

    if (state.assertNext) {
      const mode = state.assertNext;
      state.assertNext = false;
      event.preventDefault();
      event.stopPropagation();

      if (mode === "text") {
        const text = visibleText(element).slice(0, 120);

        if (text) {
          send({
            type: "assertText",
            action: "assertText",
            text,
            locator
          });
          return;
        }
      }

      send({
        type: "assertVisible",
        action: "assertVisible",
        locator
      });
      return;
    }

    if (isTextEntryElement(element)) {
      return;
    }

    send({
      type: "click",
      action: "click",
      locator
    });
  }

  function handleDoubleClick(event) {
    const target = eventElement(event);

    if (!target) {
      return;
    }

    const locator = locatorFor(bestRecordTarget(target));

    if (locator) {
      send({
        type: "doubleClick",
        action: "doubleClick",
        locator
      });
    }
  }

  function handleContextMenu(event) {
    const target = eventElement(event);

    if (!target) {
      return;
    }

    const locator = locatorFor(bestRecordTarget(target));

    if (locator) {
      send({
        type: "rightClick",
        action: "rightClick",
        locator
      });
    }
  }

  function handleInput(event) {
    const target = eventElement(event);

    if (!target || !isTextEntryElement(target)) {
      return;
    }

    const secret = isSecretInput(target);
    send({
      type: "input",
      action: "input",
      locator: locatorFor(target),
      value: secret ? "" : valueFor(target),
      secret,
      secretName: secret ? secretNameFor(target) : null
    });
  }

  function handleChange(event) {
    const target = eventElement(event);

    if (!target || target.tagName.toLowerCase() !== "select") {
      return;
    }

    send({
      type: "select",
      action: "select",
      locator: locatorFor(target),
      value: target.value
    });
  }

  function handleKeyDown(event) {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
      state.assertNext = "exists";
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "t") {
      state.assertNext = "text";
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
      send({ type: "forge:stop" });
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function bestRecordTarget(element) {
    const labelTarget = visibleLabelForHiddenControl(element);

    if (labelTarget) {
      return labelTarget;
    }

    const customSelectTarget = customSelectTargetFor(element);

    if (customSelectTarget) {
      return customSelectTarget;
    }

    const semanticTarget = element.closest([
      "[data-testid]",
      "[data-test]",
      "[data-cy]",
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "label",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='tab']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='menuitem']",
      "[contenteditable='true']"
    ].join(","));

    if (semanticTarget) {
      const labelledControl = labelControlFor(semanticTarget);

      if (labelledControl) {
        return labelledControl;
      }

      return semanticTarget;
    }

    let current = element;

    while (current && current instanceof Element && current !== document.body) {
      if (isCustomActionElement(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return element;
  }

  function visibleLabelForHiddenControl(element) {
    if (!element || !(element instanceof Element) || !isFormElement(element) || isVisible(element)) {
      return null;
    }

    const parentLabel = element.closest("label");

    if (parentLabel && isVisible(parentLabel)) {
      return parentLabel;
    }

    if (!element.id) {
      return null;
    }

    return Array.from(document.querySelectorAll(`label[for="${cssEscape(element.id)}"]`)).find(isVisible) || null;
  }

  function labelControlFor(element) {
    if (!element || !(element instanceof Element) || element.tagName.toLowerCase() !== "label") {
      return null;
    }

    const forId = clean(element.getAttribute("for"));
    const explicit = forId ? document.getElementById(forId) : null;

    if (explicit && isFormElement(explicit) && isVisible(explicit)) {
      return explicit;
    }

    return Array.from(element.querySelectorAll("input, textarea, select")).find(isVisible) || null;
  }

  function customSelectTargetFor(element) {
    if (!element || !(element instanceof Element)) {
      return null;
    }

    const nativeSelect = element.closest("select");

    if (nativeSelect) {
      return null;
    }

    if (element.closest("[role='option'], [id*='-option-']")) {
      return null;
    }

    let current = element;
    let depth = 0;

    while (current && current instanceof Element && current !== document.body && depth < 8) {
      if (isCustomSelectShell(current)) {
        return preferredCustomSelectShell(current);
      }

      current = current.parentElement;
      depth++;
    }

    return null;
  }

  function preferredCustomSelectShell(element) {
    let current = element;
    let best = element;
    let depth = 0;

    while (current && current instanceof Element && current !== document.body && depth < 4) {
      if (isCustomSelectShell(current) && visibleText(current)) {
        best = current;
      }

      current = current.parentElement;
      depth++;
    }

    return best;
  }

  function isCustomSelectShell(element) {
    if (!element || !(element instanceof Element) || !isVisible(element)) {
      return false;
    }

    const role = roleFor(element);
    const marker = elementMarkerText(element);

    if (["combobox", "listbox"].includes(role)) {
      return true;
    }

    if (element.getAttribute("aria-haspopup") === "listbox" || element.getAttribute("aria-expanded") !== null) {
      return true;
    }

    if (element.matches("input") && /^react-select-\d+-input$/i.test(clean(element.id))) {
      return true;
    }

    const hasCustomSelectChild = Boolean(
      element.querySelector("input[id^='react-select-'], [role='combobox'], [aria-haspopup='listbox']")
    );
    const hasSelectMarker = /(^|[-_\s])(select|dropdown|combobox|combo|control|single-value|singlevalue|placeholder)([-_\s]|$)/i.test(marker);
    const hasContainerMarker = /(^|[-_\s])container([-_\s]|$)/i.test(marker);

    if (hasSelectMarker) {
      return Boolean(visibleText(element) || hasCustomSelectChild);
    }

    if (hasContainerMarker) {
      return hasCustomSelectChild;
    }

    return false;
  }

  function customSelectLabel(element) {
    const labelledValue = Array.from(element.querySelectorAll("*")).find(candidate => {
      const marker = elementMarkerText(candidate);

      return /(^|[-_\s])(placeholder|single-value|singlevalue)([-_\s]|$)/i.test(marker) &&
        isVisible(candidate) &&
        clean(candidate.innerText || candidate.textContent);
    });
    const labelledText = clean(labelledValue?.innerText || labelledValue?.textContent);

    if (isUsefulDropdownLabel(labelledText)) {
      return labelledText;
    }

    const ownLabel = uniqueText([
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]).find(isUsefulDropdownLabel);

    if (ownLabel) {
      return ownLabel;
    }

    return String(element.innerText || element.textContent || "")
      .split(/\r?\n/)
      .map(clean)
      .find(isUsefulDropdownLabel) || "";
  }

  function isUsefulDropdownLabel(value) {
    const text = clean(value);

    if (!text || text.length > 100 || !/[a-z0-9]/i.test(text)) {
      return false;
    }

    return !/(^|\s)(results? available|use up and down|press enter|press escape|press tab|option .* focused|accepted usernames are|accepted passwords are)(\s|$)/i.test(text);
  }

  function locatorFor(element) {
    if (!element || !(element instanceof Element)) {
      return null;
    }

    if (isTextEntryElement(element)) {
      const label = labelFor(element);

      if (label) {
        return textEntryLocatorFor(label, element);
      }

      const placeholder = clean(element.getAttribute("placeholder"));

      if (placeholder) {
        return textEntryLocatorFor(placeholder, element);
      }

      if (element.name) {
        return textEntryLocatorFor(humanizeToken(element.name), element);
      }
    }

    if (isCustomSelectShell(element)) {
      const label = customSelectLabel(element);

      if (label) {
        return textLocatorFor(label, element);
      }
    }

    const role = roleFor(element);
    const intentText = bestIntentText(element);

    if (intentText) {
      return textLocatorFor(intentText, element);
    }

    const name = accessibleName(element);

    if (role && name && isUsefulRole(role) && isUsefulIntentText(name)) {
      return {
        kind: "role",
        role,
        name
      };
    }

    const text = visibleText(element) || name;

    if (text && isUsefulIntentText(text)) {
      return textLocatorFor(text, element);
    }

    const testAttribute = ["data-testid", "data-test", "data-cy"].find(name => clean(element.getAttribute(name)));

    if (testAttribute) {
      return {
        kind: "attribute",
        name: testAttribute,
        value: clean(element.getAttribute(testAttribute))
      };
    }

    if (role && name && isUsefulRole(role)) {
      return {
        kind: "role",
        role,
        name
      };
    }

    if (element.id && !isGeneratedId(element.id)) {
      return {
        kind: "attribute",
        name: "id",
        value: element.id
      };
    }

    if (clean(element.getAttribute("name"))) {
      return {
        kind: "attribute",
        name: "name",
        value: clean(element.getAttribute("name"))
      };
    }

    const roleCtx = contextualRoleLocator(element);

    if (roleCtx) {
      return roleCtx;
    }

    return shouldUseCssFallback(element)
      ? {
        kind: "css",
        selector: cssPath(element)
      }
      : null;
  }

  function bestIntentText(element) {
    if (!element || !(element instanceof Element)) {
      return "";
    }

    const candidates = [];

    addIntentText(candidates, element.getAttribute("aria-label"), "attribute", -220);
    addIntentText(candidates, element.getAttribute("alt"), "attribute", -200);
    addIntentText(candidates, element.getAttribute("title"), "attribute", -180);

    if (isFormElement(element) || element.isContentEditable) {
      addIntentText(candidates, labelFor(element), "label", -210);
    }

    if (!isTextEntryElement(element)) {
      addIntentText(candidates, element.value, "value", -80);
    }

    addIntentText(candidates, ownText(element), "own", -90);
    addIntentText(candidates, element.innerText || element.textContent, "line", 0);
    addIntentText(candidates, accessibleName(element), "name", 35);
    addIntentText(candidates, visibleText(element), "visible", 60);

    return chooseBestIntentText(candidates);
  }

  function addIntentText(candidates, value, source, priority) {
    const action = leadingActionPhrase(value);

    if (action) {
      candidates.push({
        text: action,
        source: "action",
        priority: priority - 260
      });
    }

    const fragments = textFragments(value);

    fragments.forEach((fragment, index) => {
      candidates.push({
        text: fragment,
        source,
        priority: priority + index * 30
      });
    });

    const text = clean(value);

    if (text && !fragments.some(fragment => lower(fragment) === lower(text))) {
      candidates.push({
        text,
        source,
        priority: priority + 45
      });
    }
  }

  function chooseBestIntentText(candidates) {
    const seen = new Set();
    const usable = candidates
      .map(candidate => ({
        ...candidate,
        text: clean(candidate.text)
      }))
      .filter(candidate => {
        const key = lower(candidate.text);

        if (!key || seen.has(key) || !isUsefulIntentText(candidate.text)) {
          return false;
        }

        seen.add(key);
        return true;
      });
    const preferred = usable.some(candidate => !isWeakIntentFragment(candidate.text))
      ? usable.filter(candidate => !isWeakIntentFragment(candidate.text))
      : usable;

    return preferred.sort((a, b) => intentCandidateScore(a) - intentCandidateScore(b))[0]?.text || "";
  }

  function textFragments(value) {
    return uniqueText(
      String(value || "")
        .split(/\r?\n|[\u2022|]/)
        .map(part => part.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    );
  }

  function bestTextFragment(value) {
    const candidates = [];

    addIntentText(candidates, value, "label", -120);

    return chooseBestIntentText(candidates);
  }

  function leadingActionPhrase(value) {
    const text = clean(value);
    const match = text.match(/^(add to compare|add to cart|buy now|place order|checkout|continue|submit|sign in|log in|login|save|cancel|delete|remove|edit|view details|read more|learn more|apply|clear|close|next|previous|back)\b/i);

    return match ? match[1] : "";
  }

  function intentCandidateScore(candidate) {
    const text = clean(candidate.text);
    const words = text.split(/\s+/).filter(Boolean).length;
    let score = candidate.priority + text.length / 3 + words * 4;

    if (candidate.source === "action") {
      score -= 220;
    }

    if (candidate.source === "attribute" || candidate.source === "label") {
      score -= 80;
    }

    if (candidate.source === "own") {
      score -= 35;
    }

    if (isWeakIntentFragment(text)) {
      score += 500;
    }

    if (words === 1 && text.length <= 2 && !isUsefulSymbolText(text)) {
      score += 180;
    }

    return score;
  }

  function isWeakIntentFragment(value) {
    const text = clean(value).toLowerCase();

    return /^[\s$\u20b9\u20ac\u00a3\u00a5.,0-9]+$/.test(text) ||
      /^\d+(\.\d+)?\s*(mp|gb|cm|inch|mah|hz)\b/i.test(text) ||
      /^\d+(\.\d+)?\s*(ratings?|reviews?)\b/i.test(text) ||
      /\b(ratings?|reviews?|off|discount|warranty|processor|display|camera|rom|ram)\b/i.test(text) ||
      /^(free|new|sale|only|from|or)$/i.test(text);
  }

  function shouldUseCssFallback(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    return isIntentRecordTarget(element) ||
      Boolean(element.id && !isGeneratedId(element.id)) ||
      Boolean(clean(element.getAttribute("name"))) ||
      ["data-testid", "data-test", "data-cy"].some(name => clean(element.getAttribute(name)));
  }

  function contextualRoleLocator(element) {
    const role = roleFor(element);

    if (!isUsefulRole(role)) {
      return null;
    }

    const candidates = contextAnchorCandidates(element, "").sort((a, b) => a.score - b.score);
    const anchor = candidates[0];

    if (!anchor) {
      return null;
    }

    return {
      kind: "near",
      target: { kind: "role", role },
      anchor: { kind: "text", text: anchor.text }
    };
  }

  function textEntryLocatorFor(value, element) {
    const text = clean(value);

    if (!text) {
      return null;
    }

    const matchingInputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
      .filter(candidate => {
        if (!isTextEntryElement(candidate) || !isVisible(candidate)) {
          return false;
        }

        return lower(textEntryLabel(candidate)) === lower(text);
      });

    if (matchingInputs.length <= 1) {
      return {
        kind: "text",
        text
      };
    }

    return textLocatorFor(text, element);
  }

  function textEntryLabel(element) {
    return clean(
      labelFor(element) ||
      element.getAttribute("placeholder") ||
      (element.name ? humanizeToken(element.name) : "")
    );
  }

  function textLocatorFor(value, element) {
    const text = clean(value);

    if (!text) {
      return null;
    }

    if (isCustomSelectShell(element)) {
      return {
        kind: "text",
        text
      };
    }

    const index = duplicateIntentIndex(text, element);

    if (index >= 0) {
      const contextLocator = contextualTextLocatorFor(text, element);

      if (contextLocator) {
        return contextLocator;
      }

      const stableLocator = stableLocatorFor(element);

      if (stableLocator) {
        return stableLocator;
      }

      return {
        kind: "nth",
        locator: {
          kind: "text",
          text
        },
        index
      };
    }

    return {
      kind: "text",
      text
    };
  }

  function stableLocatorFor(element) {
    const attributes = [
      "data-testid",
      "data-test",
      "data-cy",
      "id",
      "name"
    ];

    for (const name of attributes) {
      const value = clean(element.getAttribute(name));

      if (!value || (name === "id" && isGeneratedId(value))) {
        continue;
      }

      if (isUniqueAttribute(name, value)) {
        return {
          kind: "attribute",
          name,
          value
        };
      }
    }

    return null;
  }

  function isUniqueAttribute(name, value) {
    try {
      return document.querySelectorAll(`[${cssEscape(name)}="${cssEscape(value)}"]`).length === 1;
    } catch (error) {
      return false;
    }
  }

  function contextualTextLocatorFor(text, element) {
    const target = bestRecordTarget(element);
    const anchor = bestContextAnchor(target, text);

    if (!anchor) {
      return null;
    }

    return {
      kind: "near",
      target: {
        kind: "text",
        text
      },
      anchor: {
        kind: "text",
        text: anchor.text
      }
    };
  }

  function bestContextAnchor(target, targetText) {
    if (!target || !(target instanceof Element)) {
      return null;
    }

    const targetKey = lower(targetText);
    const candidates = contextAnchorCandidates(target, targetKey).sort((a, b) => a.score - b.score);

    return candidates.find(candidate => contextSelectsTarget(targetKey, candidate.text, target)) || candidates[0] || null;
  }

  function contextAnchorCandidates(target, targetKey) {
    const seen = new Set();
    let container = target.parentElement;
    let level = 0;

    while (container && container !== document.documentElement && level < 8) {
      const candidates = [];

      if (isVisible(container)) {
        const staticElements = Array.from(container.querySelectorAll("*"));

        for (const element of staticElements) {
          if (!isStaticAnchorElement(element, target)) {
            continue;
          }

          for (const text of staticTextCandidates(element)) {
            const key = lower(text);

            if (!isUsefulAnchorText(key, targetKey) || seen.has(key)) {
              continue;
            }

            seen.add(key);
            candidates.push({
              text,
              score: anchorScore(element, text, target, level)
            });
          }
        }
      }

      if (candidates.length) {
        return candidates;
      }

      if (container === document.body) {
        break;
      }

      container = container.parentElement;
      level++;
    }

    return [];
  }

  function isStaticAnchorElement(element, target) {
    if (!element || !(element instanceof Element) || !isVisible(element)) {
      return false;
    }

    if (element === target || element.contains(target)) {
      return false;
    }

    if (target.contains(element) && !canUseDescendantAnchor(target)) {
      return false;
    }

    const tag = element.tagName.toLowerCase();
    const role = roleFor(element);

    return ![
      "button",
      "input",
      "textarea",
      "select",
      "option"
    ].includes(tag) && ![
      "button",
      "menuitem",
      "option",
      "checkbox",
      "radio",
      "switch",
      "tab"
    ].includes(role) && !element.isContentEditable;
  }

  function canUseDescendantAnchor(target) {
    if (!target || !(target instanceof Element)) {
      return false;
    }

    return target.tagName.toLowerCase() === "label" || isCustomActionElement(target);
  }

  function staticTextCandidates(element) {
    return uniqueText([
      ownText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("alt"),
      element.getAttribute("title"),
      hasElementChildren(element) ? "" : visibleText(element)
    ]);
  }

  function isUsefulAnchorText(key, targetKey) {
    if (!key || key.length < 2 || key.length > 50 || !/[a-z0-9]/i.test(key)) {
      return false;
    }

    if (isWeakAnchorText(key)) {
      return false;
    }

    if (/\$\s*\d+|(?:usd|eur|gbp|inr)\b|[€£₹¥]/i.test(key)) {
      return false;
    }

    if (/\d+\s+items?\b/i.test(key)) {
      return false;
    }

    if (targetKey && (key === targetKey || key.includes(targetKey) || targetKey.includes(key))) {
      return false;
    }

    return !/^(add to cart|checkout|submit|log in|login|sign in|save|cancel|delete|edit|view|next|previous|continue|download|upload)$/i.test(key);
  }

  function isWeakAnchorText(value) {
    const text = clean(value).toLowerCase();

    return /^[\s$₹€£¥.,0-9]+$/.test(text) ||
      /^\$?\s*\d+([.,]\d+)?$/.test(text) ||
      /\b\d+\s*x\s*\$?\s*\d+/i.test(text) ||
      /^(or\s+)?\d+\s*x\b/i.test(text) ||
      /^(free|select|yes|no|ok|na|n\/a)$/i.test(text);
  }

  function anchorScore(element, text, target, level) {
    const tag = element.tagName.toLowerCase();
    const role = roleFor(element);
    const marker = [
      tag,
      role,
      element.id,
      element.className,
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("data-cy")
    ].filter(Boolean).join(" ").toLowerCase();
    let score = level * 110 + rectDistance(element, target) / 28;

    if (/^h[1-6]$/.test(tag) || role === "heading") {
      score -= 180;
    }

    if (tag === "label" || tag === "legend") {
      score -= 250;
    }

    if (tag === "th") {
      score -= 200;
    }

    if (/(^|[-_\s])(title|name|product|item|label|heading)([-_\s]|$)/i.test(marker)) {
      score -= 150;
    }

    if (isWeakAnchorText(text) || /(\$|₹|€|£|¥)/.test(clean(text))) {
      score += 900;
    }

    const wordCount = clean(text).split(/\s+/).length;
    if (wordCount >= 2 && wordCount <= 6) {
      score -= 35;
    }

    if (wordCount <= 3) {
      score -= 60;
    }

    return score;
  }

  function contextSelectsTarget(targetText, anchorText, target) {
    const targets = exactIntentTargets(targetText);
    const anchors = rankedTextMatches(lower(anchorText)).filter(isVisible);

    if (!targets.length || !anchors.length) {
      return false;
    }

    const ranked = targets
      .map(element => ({
        element,
        score: bestContextScore(element, anchors)
      }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;

        const position = a.element.compareDocumentPosition(b.element);
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        return 0;
      });

    return Boolean(ranked[0] && sameRecordedTarget(ranked[0].element, target));
  }

  function bestContextScore(target, anchors) {
    let best = Infinity;

    for (const anchor of anchors) {
      const score = contextualScore(target, anchor);

      if (score < best) {
        best = score;
      }
    }

    return best;
  }

  function contextualScore(target, anchor) {
    if (!target || !anchor || !(target instanceof Element) || !(anchor instanceof Element)) {
      return Infinity;
    }

    if (target === anchor || !isVisible(target) || !isVisible(anchor)) {
      return Infinity;
    }

    const container = commonContainer(target, anchor);

    if (!container) {
      return Infinity;
    }

    const anchorInsideTargetPenalty = target.contains(anchor) ? 2500 : 0;
    const targetInsideAnchorPenalty = anchor.contains(target) ? 250 : 0;

    return containerScore(container) +
      rectDistance(target, anchor) / 24 +
      anchorInsideTargetPenalty +
      targetInsideAnchorPenalty;
  }

  function commonContainer(a, b) {
    const ancestors = new Set();
    let current = a;

    while (current && current instanceof Element) {
      ancestors.add(current);
      current = current.parentElement;
    }

    current = b;

    while (current && current instanceof Element) {
      if (ancestors.has(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function containerScore(container) {
    if (!container || container === document.documentElement) {
      return 12000;
    }

    if (container === document.body) {
      return 8000;
    }

    const rect = container.getBoundingClientRect();
    const area = Math.max(1, rect.width * rect.height);
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const areaPenalty = Math.min((area / viewportArea) * 1800, 2200);
    const tag = container.tagName.toLowerCase();
    const role = roleFor(container);
    const structureBonus = ["tr", "li", "article", "section", "form"].includes(tag) ||
      ["row", "listitem", "article", "group"].includes(role)
      ? -500
      : 0;

    return areaPenalty - elementDepth(container) * 18 + structureBonus;
  }

  function rectDistance(a, b) {
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    const ax = rectA.left + rectA.width / 2;
    const ay = rectA.top + rectA.height / 2;
    const bx = rectB.left + rectB.width / 2;
    const by = rectB.top + rectB.height / 2;

    return Math.hypot(ax - bx, ay - by);
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element;

    while (current && current.parentElement) {
      depth++;
      current = current.parentElement;
    }

    return depth;
  }

  function duplicateIntentIndex(text, element) {
    const targetText = lower(text);
    const target = bestRecordTarget(element);

    if (!targetText || !target) {
      return -1;
    }

    const duplicateTargets = exactIntentTargets(targetText);

    if (duplicateTargets.length <= 1 || !duplicateTargets.includes(target)) {
      return -1;
    }

    const ranked = rankedTextMatches(targetText);

    return ranked.findIndex(candidate => sameRecordedTarget(candidate, target));
  }

  function exactIntentTargets(targetText) {
    const seen = new Set();
    const matches = [];

    for (const candidate of Array.from(document.querySelectorAll("*"))) {
      if (!candidate || !(candidate instanceof Element) || !isVisible(candidate)) {
        continue;
      }

      const target = bestRecordTarget(candidate);

      if (!target || seen.has(target) || !isVisible(target) || !isIntentRecordTarget(target)) {
        continue;
      }

      if (intentTextCandidates(target).some(value => lower(value) === targetText)) {
        seen.add(target);
        matches.push(target);
      }
    }

    return matches;
  }

  function rankedTextMatches(targetText) {
    const matches = Array.from(document.querySelectorAll("*")).filter(candidate => {
      return runtimeTextCandidates(candidate).some(value => lower(value).includes(targetText));
    });

    return uniqueElements(matches).sort((a, b) => {
      const scoreA = textScore(a, targetText);
      const scoreB = textScore(b, targetText);

      if (scoreA !== scoreB) return scoreA - scoreB;

      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      return 0;
    });
  }

  function sameRecordedTarget(candidate, target) {
    const recordTarget = bestRecordTarget(candidate);

    return recordTarget === target || candidate === target || target.contains(candidate);
  }

  function intentTextCandidates(element) {
    return uniqueText([
      bestIntentText(element),
      accessibleName(element),
      visibleText(element),
      isFormElement(element) || element.isContentEditable ? labelFor(element) : ""
    ]);
  }

  function runtimeTextCandidates(element) {
    return uniqueText([
      accessibleName(element),
      ownText(element),
      textFor(element),
      isFormElement(element) ? labelFor(element) : ""
    ]);
  }

  function textScore(element, targetText) {
    const candidates = runtimeTextCandidates(element).map(lower).filter(Boolean);
    const exact = candidates.some(value => value === targetText);
    const startsWith = candidates.some(value => value.startsWith(targetText));
    const ownExact = lower(ownText(element)) === targetText;
    const visiblePenalty = isVisible(element) ? 0 : 10000;
    const interactiveBonus = isClickable(element) ? -350 : 0;
    const exactBonus = exact ? -700 : startsWith ? -450 : 0;
    const ownBonus = ownExact ? -200 : 0;
    const childPenalty = hasElementChildren(element) ? 35 : 0;
    const areaPenalty = Math.min(elementArea(element) / 1000, 250);
    const textLengthPenalty = Math.min(lower(textFor(element)).length / 10, 250);

    return visiblePenalty + interactiveBonus + exactBonus + ownBonus + childPenalty + areaPenalty + textLengthPenalty;
  }

  function isIntentRecordTarget(element) {
    const tag = element.tagName.toLowerCase();

    return [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "label",
      "summary"
    ].includes(tag) ||
      isCustomActionElement(element) ||
      isTextEntryElement(element) ||
      isUsefulRole(roleFor(element)) ||
      ["data-testid", "data-test", "data-cy"].some(name => clean(element.getAttribute(name)));
  }

  function isCustomActionElement(element) {
    if (!element || !(element instanceof Element) || isDisabled(element)) {
      return false;
    }

    const marker = elementMarkerText(element);
    const style = window.getComputedStyle(element);

    return Boolean(element.onclick) ||
      element.getAttribute("tabindex") !== null ||
      style.cursor === "pointer" ||
      /(^|[-_\s])(btn|button|buy|cart|checkout|cta|action|submit|login|signin|sign-in|select|option)([-_\s]|$)/i.test(marker);
  }

  function elementMarkerText(element) {
    return [
      element.id,
      element.className,
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("data-cy"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("role")
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function isClickable(element) {
    if (!element || !(element instanceof Element) || isDisabled(element)) {
      return false;
    }

    const tag = element.tagName.toLowerCase();
    const style = window.getComputedStyle(element);
    const role = roleFor(element);

    return [
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "label",
      "summary"
    ].includes(tag) ||
      Boolean(element.onclick) ||
      ["button", "link", "menuitem", "option", "tab", "checkbox", "radio", "switch"].includes(role) ||
      isCustomActionElement(element) ||
      style.cursor === "pointer";
  }

  function isDisabled(element) {
    if (!element || !(element instanceof Element)) {
      return true;
    }

    if (element.disabled || element.getAttribute("disabled") !== null) {
      return true;
    }

    if (element.getAttribute("aria-disabled") === "true") {
      return true;
    }

    const disabledFieldset = element.closest("fieldset[disabled]");

    return Boolean(disabledFieldset && !disabledFieldset.querySelector("legend")?.contains(element));
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      Number(style.opacity || "1") > 0 &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function ownText(element) {
    const own = Array.from(element.childNodes || [])
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(" ");

    return uniqueText([
      own,
      element.value,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("alt")
    ]).join(" ");
  }

  function textFor(element) {
    return uniqueText([
      element.innerText,
      element.textContent,
      element.value,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("alt")
    ]).join(" ");
  }

  function hasElementChildren(element) {
    return Array.from(element.children || []).some(child => isVisible(child));
  }

  function elementArea(element) {
    const rect = element.getBoundingClientRect();

    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function uniqueElements(elements) {
    const seen = new Set();
    const result = [];

    for (const element of elements) {
      if (!element || seen.has(element)) {
        continue;
      }

      seen.add(element);
      result.push(element);
    }

    return result;
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function isUsefulRole(role) {
    return [
      "button",
      "link",
      "textbox",
      "combobox",
      "checkbox",
      "radio",
      "switch",
      "tab",
      "menuitem",
      "option",
      "heading"
    ].includes(role);
  }

  function roleFor(element) {
    const explicit = clean(element.getAttribute("role"));

    if (explicit) {
      return explicit.toLowerCase();
    }

    const tag = element.tagName.toLowerCase();
    const type = clean(element.getAttribute("type")).toLowerCase();

    if (tag === "button") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input" && ["button", "submit", "reset"].includes(type)) return "button";
    if (tag === "input" && type === "checkbox") return "checkbox";
    if (tag === "input" && type === "radio") return "radio";
    if (tag === "input" && ["email", "password", "search", "tel", "text", "url", "number", ""].includes(type)) return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "img";

    return "";
  }

  function accessibleName(element) {
    const labelledBy = clean(element.getAttribute("aria-labelledby"));
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map(id => clean(document.getElementById(id)?.innerText)).filter(Boolean).join(" ")
      : "";
    const tag = element.tagName.toLowerCase();
    const includeValue = !isTextEntryElement(element) && ["input", "button"].includes(tag);

    return uniqueText([
      element.getAttribute("aria-label"),
      labelledText,
      element.getAttribute("alt"),
      element.getAttribute("title"),
      isFormElement(element) ? labelFor(element) : "",
      includeValue ? element.value : "",
      visibleText(element)
    ]).join(" ");
  }

  function labelFor(element) {
    if (!isFormElement(element) && !element.isContentEditable) {
      return "";
    }

    const labels = element.id
      ? Array.from(document.querySelectorAll(`label[for="${cssEscape(element.id)}"]`)).map(label => label.innerText)
      : [];
    const parentLabel = element.closest("label")?.innerText || "";
    const candidates = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      ...labels,
      parentLabel,
      element.name ? humanizeToken(element.name) : ""
    ];

    for (const candidate of candidates) {
      const fragment = bestTextFragment(candidate);

      if (fragment) {
        return fragment;
      }
    }

    return "";
  }

  function isFormElement(element) {
    return ["input", "textarea", "select"].includes(element.tagName.toLowerCase());
  }

  function isTextEntryElement(element) {
    if (element.isContentEditable) {
      return true;
    }

    const tag = element.tagName.toLowerCase();
    const type = clean(element.getAttribute("type")).toLowerCase();

    if (tag === "textarea") {
      return true;
    }

    return tag === "input" && [
      "",
      "email",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "url"
    ].includes(type);
  }

  function isSecretInput(element) {
    const type = clean(element.getAttribute("type")).toLowerCase();
    const markers = [
      type,
      element.name,
      element.id,
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder")
    ].join(" ");

    return type === "password" || /(password|secret|token|otp|passcode|pin)/i.test(markers);
  }

  function secretNameFor(element) {
    return clean(labelFor(element) || element.name || element.id || "password")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase() || "PASSWORD";
  }

  function valueFor(element) {
    return element.isContentEditable ? element.textContent : element.value;
  }

  function visibleText(element) {
    return clean(element.innerText || element.textContent || "");
  }

  function isUsefulIntentText(value) {
    const text = clean(value);

    if (!text || text.length > 100) {
      return false;
    }

    return /[a-zA-Z0-9]/.test(text) || isUsefulSymbolText(text);
  }

  function isUsefulSymbolText(value) {
    return /^(\u00d7|\u2715|\u2716|x)$/i.test(clean(value));
  }

  function isGeneratedId(value) {
    const text = clean(value);

    return /^react-select-\d+-option-\d+-\d+$/i.test(text) ||
      /^react-select-\d+-(listbox|input|placeholder)$/i.test(text) ||
      /^(ember|radix|headlessui|mui|chakra|downshift|floating-ui|ariakit|reach|mantine|rsuite)-/i.test(text) ||
      /^[a-f0-9]{8,}$/i.test(text) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ||
      /^[\w-]+-\d{5,}$/.test(text);
  }

  function humanizeToken(value) {
    const text = clean(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text || clean(value);
  }

  function uniqueText(parts) {
    const seen = new Set();
    const result = [];

    for (const part of parts) {
      const text = clean(part);
      const key = text.toLowerCase();

      if (!text || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(text);
    }

    return result;
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function cssPath(element) {
    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      let selector = tag;

      const testAttribute = ["data-testid", "data-test", "data-cy", "name"].find(name => clean(current.getAttribute(name)));

      if (testAttribute) {
        selector += `[${testAttribute}="${cssEscape(current.getAttribute(testAttribute))}"]`;
        parts.unshift(selector);
        break;
      }

      const siblings = Array.from(current.parentElement?.children || []).filter(child => child.tagName === current.tagName);

      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(" > ") || element.tagName.toLowerCase();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }

    return String(value).replace(/["\\]/g, "\\$&");
  }

  document.addEventListener("click", handleClick, true);
  document.addEventListener("dblclick", handleDoubleClick, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleChange, true);
  document.addEventListener("keydown", handleKeyDown, true);

  send({
    type: "page",
    action: "page"
  });
}

module.exports = {
  runForge,
  buildOrbitTestScript,
  calculateForgeWindowLayout,
  formatLocator,
  normalizeForgeEvents
};
