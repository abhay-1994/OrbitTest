// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require("fs");
const path = require("path");
const { AdbClient } = require("./adb");
const { Key } = require("./keys");
const { dumpUiXml, parseUiXml } = require("./uiautomator");
const { findNodeWithRetry, matchesText } = require("./selectors");
const { comparePngBuffers } = require("./visual");
const { ensureDir, normalizeTimeout } = require("./utils");

class OrbitDevice {
  constructor(config = {}) {
    this.config = normalizeMobileConfig(config);
    this.adbClient = new AdbClient(this.config);
    this.lastUiSnapshot = null;
    this.__orbittestMobile = true;
  }

  async installApp(apkPath = this.config.apk) {
    const resolved = requirePath(apkPath, "APK path", this.config.projectRoot);
    await this.adb(["install", "-r", resolved], { timeoutMs: 120000 });
  }

  async uninstallApp(packageName = this.config.appPackage) {
    await this.adb(["uninstall", requireValue(packageName, "packageName")], { timeoutMs: 60000 });
  }

  async launchApp(packageName = this.config.appPackage, activity = this.config.appActivity) {
    const pkg = requireValue(packageName, "packageName");

    if (activity) {
      const component = activity.includes("/") ? activity : `${pkg}/${activity}`;
      await this.shell(["am", "start", "-n", component], { timeoutMs: 15000 });
      return;
    }

    const component = await this.resolveLaunchActivity(pkg);
    if (component) {
      await this.shell(["am", "start", "-n", component], { timeoutMs: 15000 });
      return;
    }

    await this.shell(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], { timeoutMs: 10000 });
  }

  async resolveLaunchActivity(packageName = this.config.appPackage) {
    const pkg = requireValue(packageName, "packageName");
    const output = await this.shell(["cmd", "package", "resolve-activity", "--brief", pkg], { timeoutMs: 10000 });
    const component = String(output || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .reverse()
      .find(line => line.includes("/") && !line.startsWith("No activity"));

    return component || null;
  }

  async stopApp(packageName = this.config.appPackage) {
    await this.shell(["am", "force-stop", requireValue(packageName, "packageName")]);
  }

  async clearAppData(packageName = this.config.appPackage) {
    await this.shell(["pm", "clear", requireValue(packageName, "packageName")], { timeoutMs: 30000 });
  }

  async isAppInstalled(packageName = this.config.appPackage) {
    const pkg = requireValue(packageName, "packageName");
    const output = await this.shell(["pm", "list", "packages", pkg]);
    return output.split(/\r?\n/).some(line => line.trim() === `package:${pkg}`);
  }

  async tap(x, y) {
    await this.shell(["input", "tap", String(Math.round(x)), String(Math.round(y))]);
  }

  async longPress(x, y, durationMs = 800) {
    await this.swipe(x, y, x, y, durationMs);
  }

  async swipe(x1, y1, x2, y2, durationMs = 400) {
    await this.shell([
      "input",
      "swipe",
      String(Math.round(x1)),
      String(Math.round(y1)),
      String(Math.round(x2)),
      String(Math.round(y2)),
      String(Math.round(durationMs))
    ]);
  }

  async scrollDown(amount = 0.7) {
    const size = await this.getScreenSize();
    const x = Math.round(size.width / 2);
    const distance = Math.round(size.height * Number(amount || 0.7));
    await this.swipe(x, Math.round(size.height * 0.75), x, Math.max(1, Math.round(size.height * 0.75) - distance), 450);
  }

  async scrollUp(amount = 0.7) {
    const size = await this.getScreenSize();
    const x = Math.round(size.width / 2);
    const distance = Math.round(size.height * Number(amount || 0.7));
    await this.swipe(x, Math.round(size.height * 0.25), x, Math.min(size.height - 1, Math.round(size.height * 0.25) + distance), 450);
  }

  async typeText(text) {
    const encoded = String(text)
      .replace(/%/g, "%25")
      .replace(/\s/g, "%s")
      .replace(/'/g, "\\'");
    await this.shell(["input", "text", encoded]);
  }

  async clearText() {
    for (let i = 0; i < 80; i++) {
      await this.pressKey(Key.DEL);
    }
  }

  async sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, Number(ms) || 0));
  }

  async pressKey(code) {
    await this.shell(["input", "keyevent", String(code)]);
  }

  async tapText(text, options = {}) {
    const node = await findNodeWithRetry({
      dumpUi: () => this.dumpUi({ allowCachedOnError: true }),
      matcher: item => matchesText(item.text, text, options),
      description: `text "${text}"`,
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs
    });
    await this.tap(node.center.x, node.center.y);
  }

  async tapById(resourceId, options = {}) {
    const node = await findNodeWithRetry({
      dumpUi: () => this.dumpUi({ allowCachedOnError: true }),
      matcher: item => item.resourceId === resourceId,
      description: `resource id "${resourceId}"`,
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs
    });
    await this.tap(node.center.x, node.center.y);
  }

  async tapByDescription(description, options = {}) {
    const node = await findNodeWithRetry({
      dumpUi: () => this.dumpUi({ allowCachedOnError: true }),
      matcher: item => matchesText(item.contentDescription, description, options),
      description: `content description "${description}"`,
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs
    });
    await this.tap(node.center.x, node.center.y);
  }

  async getScreenSize() {
    const output = await this.shell(["wm", "size"]);
    const match = output.match(/Physical size:\s*(\d+)x(\d+)/i) || output.match(/Override size:\s*(\d+)x(\d+)/i);

    if (!match) {
      throw new Error(`Could not read Android screen size from: ${output}`);
    }

    return {
      width: Number(match[1]),
      height: Number(match[2])
    };
  }

  async dumpUi(options = {}) {
    try {
      const xml = await this.dumpUiXml();
      const nodes = this.parseUiXml(xml);
      this.lastUiSnapshot = {
        capturedAt: Date.now(),
        nodes
      };
      return nodes;
    } catch (error) {
      if (options.allowCachedOnError && this.isUiSnapshotFresh()) {
        return this.lastUiSnapshot.nodes;
      }

      throw error;
    }
  }

  async dumpUiXml() {
    return dumpUiXml(this.adbClient);
  }

  parseUiXml(xml) {
    return parseUiXml(xml);
  }

  async getScreenText() {
    const nodes = await this.dumpUi();
    return nodes
      .map(node => node.text)
      .filter(Boolean)
      .join("\n");
  }

  async hasText(text, options = {}) {
    const nodes = await this.dumpUi();
    return nodes.some(node => matchesText(node.text, text, options));
  }

  async waitForText(text, timeoutMs = this.config.defaultTimeoutMs) {
    await findNodeWithRetry({
      dumpUi: () => this.dumpUi({ allowCachedOnError: true }),
      matcher: item => matchesText(item.text, text),
      description: `text "${text}"`,
      timeoutMs
    });
  }

  async waitForId(resourceId, timeoutMs = this.config.defaultTimeoutMs) {
    await findNodeWithRetry({
      dumpUi: () => this.dumpUi({ allowCachedOnError: true }),
      matcher: item => item.resourceId === resourceId,
      description: `resource id "${resourceId}"`,
      timeoutMs
    });
  }

  async waitForGoneText(text, timeoutMs = this.config.defaultTimeoutMs) {
    const timeout = normalizeTimeout(timeoutMs, this.config.defaultTimeoutMs);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
      if (!await this.hasText(text)) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out after ${timeout}ms waiting for text "${text}" to disappear.`);
  }

  async getCurrentActivity() {
    const output = await this.shell(["dumpsys", "activity", "activities"], { timeoutMs: 10000 });
    const match = String(output || "").match(
      /(?:topResumedActivity|ResumedActivity)[^\n]*\s([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+)\s/
    ) || String(output || "").match(/ACTIVITY\s+([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+)/);
    return match ? match[1] : "";
  }

  async getCurrentPackage() {
    const activity = await this.getCurrentActivity();
    return activity.includes("/") ? activity.split("/")[0] : "";
  }

  async screenshot() {
    const output = await this.adb(["exec-out", "screencap", "-p"], {
      encoding: "buffer",
      timeoutMs: 30000
    });
    return Buffer.isBuffer(output) ? output : Buffer.from(output);
  }

  async saveScreenshot(filePath) {
    const resolved = path.resolve(this.config.projectRoot, filePath);
    ensureDir(path.dirname(resolved));
    fs.writeFileSync(resolved, await this.screenshot());
  }

  async compareScreenshot(baselinePath, options = {}) {
    const resolvedBaseline = path.resolve(this.config.projectRoot, baselinePath);
    const diffPath = options.diffPath ? path.resolve(this.config.projectRoot, options.diffPath) : undefined;
    return comparePngBuffers(await this.screenshot(), resolvedBaseline, {
      ...options,
      diffPath
    });
  }

  async clearLogcat() {
    await this.adb(["logcat", "-c"]);
  }

  async getLogcat(filter) {
    const output = await this.adb(["logcat", "-d"], { timeoutMs: 30000 });
    const lines = String(output || "").split(/\r?\n/);
    return filter ? lines.filter(line => line.includes(filter)) : lines;
  }

  async saveLogcat(filePath, filter) {
    const resolved = path.resolve(this.config.projectRoot, filePath);
    ensureDir(path.dirname(resolved));
    fs.writeFileSync(resolved, (await this.getLogcat(filter)).join("\n"), "utf8");
  }

  async wakeUp() {
    await this.shell(["input", "keyevent", "KEYCODE_WAKEUP"], { timeoutMs: 5000 });
  }

  async sleepScreen() {
    await this.shell(["input", "keyevent", "KEYCODE_SLEEP"], { timeoutMs: 5000 });
  }

  async isScreenOn() {
    const output = await this.adb(["shell", "dumpsys", "window", "policy"], { timeoutMs: 10000 });
    return /SCREEN_STATE_ON|mScreenOn=true|mAwake=true|state=ON/i.test(output);
  }

  async getAndroidVersion() {
    return (await this.shell(["getprop", "ro.build.version.release"])).trim();
  }

  async getModel() {
    return (await this.shell(["getprop", "ro.product.model"])).trim();
  }

  async adb(args, options) {
    return this.adbClient.adb(args, options);
  }

  async shell(command, options) {
    return this.adbClient.shell(command, options);
  }

  isUiSnapshotFresh(maxAgeMs = 2000) {
    return Boolean(
      this.lastUiSnapshot &&
      Array.isArray(this.lastUiSnapshot.nodes) &&
      Date.now() - this.lastUiSnapshot.capturedAt <= maxAgeMs
    );
  }
}

function normalizeMobileConfig(config = {}) {
  return {
    adbPath: config.adbPath || process.env.ADB_PATH || "adb",
    deviceSerial: config.deviceSerial || process.env.DEVICE_SERIAL || null,
    apk: config.apk || null,
    appPackage: config.appPackage || null,
    appActivity: config.appActivity || null,
    artifactsDir: config.artifactsDir || path.resolve(process.cwd(), "orbittest-results"),
    screenshotOnFailure: config.screenshotOnFailure !== false,
    logcatOnFailure: config.logcatOnFailure !== false,
    uiDumpOnFailure: config.uiDumpOnFailure !== false,
    defaultTimeoutMs: normalizeTimeout(config.defaultTimeoutMs, 5000),
    projectRoot: config.projectRoot || process.env.PROJECT_ROOT || process.cwd()
  };
}

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required. Set it in orbittest.config.js use.mobile or pass it to this method.`);
  }

  return value;
}

function requirePath(value, name, root = process.cwd()) {
  const required = requireValue(value, name);
  return path.isAbsolute(required) ? required : path.resolve(root, required);
}

module.exports = {
  OrbitDevice,
  normalizeMobileConfig
};
