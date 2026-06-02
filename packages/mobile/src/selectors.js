// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { delay, normalizeTimeout } = require("./utils");

async function findNodeWithRetry({ dumpUi, matcher, description, timeoutMs = 5000, intervalMs = 250 }) {
  const timeout = normalizeTimeout(timeoutMs, 5000);
  const startedAt = Date.now();
  let lastNodes = [];
  let lastDumpError = null;

  while (Date.now() - startedAt <= timeout) {
    try {
      lastNodes = await dumpUi();
      lastDumpError = null;
    } catch (error) {
      lastDumpError = error;

      if (timeout === 0 || isFatalDumpError(error)) {
        break;
      }

      await delay(Math.min(intervalMs, Math.max(1, timeout - (Date.now() - startedAt))));
      continue;
    }

    const node = chooseBestNode(lastNodes.filter(matcher));

    if (node) {
      return node;
    }

    if (timeout === 0) {
      break;
    }

    await delay(Math.min(intervalMs, Math.max(1, timeout - (Date.now() - startedAt))));
  }

  const dumpHint = lastDumpError
    ? ` Last UI dump error: ${lastDumpError.message || String(lastDumpError)}.`
    : "";

  throw new Error(`Timed out after ${timeout}ms waiting for ${description}. Last UI node count: ${lastNodes.length}.${dumpHint}`);
}

function isFatalDumpError(error) {
  const message = error && error.message ? error.message : String(error || "");
  return /No online Android device|unauthorized|device offline|not selected|more than one device/i.test(message);
}

function chooseBestNode(nodes) {
  const visibleEnabled = nodes.filter(isVisibleEnabledNode);
  const clickable = visibleEnabled.find(node => node.clickable);

  return clickable || visibleEnabled[0] || null;
}

function isVisibleEnabledNode(node) {
  return Boolean(
    node &&
    node.enabled &&
    node.bounds &&
    node.bounds.right > node.bounds.left &&
    node.bounds.bottom > node.bounds.top
  );
}

function matchesText(text, expected, options = {}) {
  const actual = normalizeText(text);
  const target = normalizeText(expected);

  return options.exact ? actual === target : actual.includes(target);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  chooseBestNode,
  findNodeWithRetry,
  isVisibleEnabledNode,
  isFatalDumpError,
  matchesText,
  normalizeText
};
