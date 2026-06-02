// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const path = require("path");
const { slugify, timestamp, writeJson, writeText } = require("./utils");

async function captureFailureArtifacts({ orbit, result, error, testInfo } = {}) {
  return captureMobileArtifacts({
    orbit,
    result,
    error,
    testInfo,
    mode: "failure"
  });
}

async function captureReportArtifacts({ orbit, result, testInfo } = {}) {
  return captureMobileArtifacts({
    orbit,
    result,
    testInfo,
    mode: "report"
  });
}

async function captureMobileArtifacts({ orbit, result, error, testInfo, mode = "report" } = {}) {
  if (!orbit) {
    return null;
  }

  const capturedAt = new Date();
  const dir = path.join(
    orbit.config.artifactsDir || path.resolve(process.cwd(), "orbittest-results"),
    timestamp(capturedAt),
    slugify(testInfo?.name || result?.name || "mobile-test")
  );
  const artifacts = {
    dir,
    metadata: path.join(dir, "mobile.json"),
    screenshot: path.join(dir, "screenshot.png"),
    uiXml: path.join(dir, "ui.xml"),
    uiJson: path.join(dir, "ui.json"),
    logcat: path.join(dir, "logcat.txt"),
    error: path.join(dir, "error.txt"),
    result: path.join(dir, "result.json")
  };

  const saved = {
    kind: "mobile",
    mode,
    capturedAt: capturedAt.toISOString(),
    provider: "@orbittest/mobile",
    dir
  };

  saved.device = await captureDeviceInfo(orbit);
  saved.app = await captureAppInfo(orbit);

  if (mode !== "failure" || orbit.config.screenshotOnFailure !== false) {
    try {
      await orbit.saveScreenshot(artifacts.screenshot);
      saved.screenshot = artifacts.screenshot;
    } catch (screenshotError) {
      saved.screenshotError = screenshotError.message || String(screenshotError);
    }
  }

  if (mode !== "failure" || orbit.config.uiDumpOnFailure !== false) {
    try {
      const xml = await orbit.dumpUiXml();
      const nodes = orbit.parseUiXml(xml);

      writeText(artifacts.uiXml, xml);
      saved.uiXml = artifacts.uiXml;
      writeJson(artifacts.uiJson, nodes);
      saved.uiJson = artifacts.uiJson;
      saved.ui = summarizeUiNodes(nodes);
    } catch (uiError) {
      saved.uiDumpError = uiError.message || String(uiError);
    }
  }

  if (mode === "failure" && orbit.config.logcatOnFailure !== false) {
    try {
      await orbit.saveLogcat(artifacts.logcat);
      saved.logcat = artifacts.logcat;
    } catch (logcatError) {
      saved.logcatError = logcatError.message || String(logcatError);
    }
  }

  if (mode === "failure" || error) {
    writeText(artifacts.error, formatError(error));
    saved.error = artifacts.error;
  }

  const resultPayload = {
    test: {
      name: testInfo?.name || result?.name || null,
      file: testInfo?.file || result?.file || null,
      attempt: testInfo?.attempt || null
    },
    status: result?.status || (mode === "failure" ? "failed" : "unknown"),
    mode,
    artifacts: saved
  };

  if (mode === "failure" || error) {
    resultPayload.error = {
      name: error?.name || "Error",
      message: error?.message || String(error || "Unknown error"),
      stack: error?.stack || ""
    };
  }

  writeJson(artifacts.result, resultPayload);
  saved.result = artifacts.result;
  writeJson(artifacts.metadata, saved);
  saved.metadata = artifacts.metadata;

  return saved;
}

async function captureDeviceInfo(orbit) {
  const [serial, model, androidVersion, screenSize, screenOn] = await Promise.all([
    captureValue(() => orbit.adbClient.resolveSerial()),
    captureValue(() => orbit.getModel()),
    captureValue(() => orbit.getAndroidVersion()),
    captureValue(() => orbit.getScreenSize()),
    captureValue(() => orbit.isScreenOn())
  ]);

  return {
    serial,
    model,
    androidVersion,
    screenSize,
    screenOn
  };
}

async function captureAppInfo(orbit) {
  const [currentPackage, currentActivity] = await Promise.all([
    captureValue(() => orbit.getCurrentPackage()),
    captureValue(() => orbit.getCurrentActivity())
  ]);

  return {
    configuredPackage: orbit.config.appPackage || null,
    configuredActivity: orbit.config.appActivity || null,
    apk: orbit.config.apk || null,
    currentPackage,
    currentActivity
  };
}

async function captureValue(fn) {
  try {
    return await fn();
  } catch (error) {
    return {
      error: error.message || String(error)
    };
  }
}

function summarizeUiNodes(nodes = []) {
  const visibleNodes = nodes.filter(node => node.enabled !== false);
  const texts = unique(
    visibleNodes
      .map(node => node.text)
      .filter(Boolean)
      .map(normalizeText)
      .filter(Boolean)
  ).slice(0, 12);
  const resourceIds = unique(
    visibleNodes
      .map(node => node.resourceId)
      .filter(Boolean)
  ).slice(0, 12);
  const descriptions = unique(
    visibleNodes
      .map(node => node.contentDescription)
      .filter(Boolean)
      .map(normalizeText)
      .filter(Boolean)
  ).slice(0, 12);

  return {
    nodeCount: nodes.length,
    visibleNodeCount: visibleNodes.length,
    clickableNodeCount: nodes.filter(node => node.clickable).length,
    texts,
    resourceIds,
    descriptions
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return Array.from(new Set(values));
}

function formatError(error) {
  if (!error) {
    return "Unknown error";
  }

  return error.stack || error.message || String(error);
}

module.exports = {
  captureFailureArtifacts,
  captureReportArtifacts
};
