// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { XMLParser } = require("fast-xml-parser");

const UI_DUMP_PATH = "/data/local/tmp/orbittest-window.xml";
const UI_DUMP_ATTEMPTS = 3;
const UI_DUMP_RETRY_DELAY_MS = 350;

async function dumpUiXml(adb) {
  let lastError = null;

  for (let attempt = 1; attempt <= UI_DUMP_ATTEMPTS; attempt++) {
    try {
      await adb.shell(["rm", "-f", UI_DUMP_PATH], { timeoutMs: 5000 });
      await adb.shell(["uiautomator", "dump", UI_DUMP_PATH], { timeoutMs: 10000 });
      const xml = await adb.adb(["exec-out", "cat", UI_DUMP_PATH], { timeoutMs: 10000 });

      if (isValidUiXml(xml)) {
        return xml;
      }

      throw new Error(`UIAutomator returned an empty or invalid hierarchy on attempt ${attempt}.`);
    } catch (error) {
      lastError = error;

      if (attempt < UI_DUMP_ATTEMPTS && isRecoverableDumpError(error)) {
        await delay(UI_DUMP_RETRY_DELAY_MS * attempt);
        continue;
      }

      break;
    }
  }

  throw enrichDumpError(lastError);
}

function isValidUiXml(xml) {
  const value = String(xml || "");
  return value.includes("<hierarchy") && value.includes("</hierarchy>");
}

function isRecoverableDumpError(error) {
  const value = [
    error && error.message,
    error && error.stdout,
    error && error.stderr,
    error && error.cause && error.cause.exitCode,
    error && error.cause && error.cause.signal
  ].filter(Boolean).join("\n");

  return /exit code 137|signal SIGKILL|killed|UIAutomator returned|Killed/i.test(value);
}

function enrichDumpError(error) {
  const message = error && error.message ? error.message : String(error || "unknown error");
  const wrapped = new Error(
    [
      "Unable to dump Android UI hierarchy after retries.",
      "This is usually transient when Android kills the uiautomator process while the app/WebView is busy.",
      message
    ].join("\n")
  );
  wrapped.cause = error;
  return wrapped;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseUiXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    trimValues: false
  });
  const parsed = parser.parse(String(xml || ""));
  const root = parsed && parsed.hierarchy ? parsed.hierarchy : parsed;
  const nodes = [];

  walkUiNode(root, nodes);
  return nodes;
}

function walkUiNode(value, nodes) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => walkUiNode(item, nodes));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (hasNodeShape(value)) {
    nodes.push(toUiNode(value));
  }

  if (value.node) {
    walkUiNode(value.node, nodes);
  }
}

function hasNodeShape(value) {
  return value.bounds || value.text !== undefined || value["resource-id"] !== undefined || value["content-desc"] !== undefined;
}

function toUiNode(raw) {
  const bounds = parseBounds(raw.bounds || "[0,0][0,0]");

  return {
    text: String(raw.text || ""),
    resourceId: String(raw["resource-id"] || ""),
    className: String(raw.class || ""),
    packageName: String(raw.package || ""),
    contentDescription: String(raw["content-desc"] || ""),
    clickable: raw.clickable === true || raw.clickable === "true",
    enabled: raw.enabled === undefined ? true : raw.enabled === true || raw.enabled === "true",
    bounds,
    center: {
      x: Math.round((bounds.left + bounds.right) / 2),
      y: Math.round((bounds.top + bounds.bottom) / 2)
    }
  };
}

function parseBounds(value) {
  const match = String(value || "").match(/\[(\-?\d+),(\-?\d+)\]\[(\-?\d+),(\-?\d+)\]/);

  if (!match) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    };
  }

  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4])
  };
}

module.exports = {
  UI_DUMP_PATH,
  dumpUiXml,
  parseBounds,
  parseUiXml
};
