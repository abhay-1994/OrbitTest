// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const path = require("path");

const DEFAULT_TEST_NAME = "Browser flow";

function buildOrbitTestScript(options = {}) {
  const steps = normalizeForgeEvents(options.events || []);
  const startUrl = normalizeUrl(options.startUrl);
  const testName = sanitizeTestName(options.testName || inferTestName(startUrl) || DEFAULT_TEST_NAME);
  const usesExpect = steps.some(step => step.action === "assertVisible" || step.action === "assertText");
  const lines = [
    usesExpect
      ? 'const { test, expect } = require("orbittest");'
      : 'const { test } = require("orbittest");',
    "",
    `test(${quote(testName)}, async (orbit) => {`
  ];

  if (startUrl) {
    lines.push(`  await orbit.open(${quote(startUrl)});`);
  }

  for (const step of steps) {
    const line = formatStep(step);

    if (line) {
      lines.push(line);
    }
  }

  lines.push("});", "");

  if (steps.some(step => step.action === "select")) {
    lines.push(...buildSelectHelperLines(), "");
  }

  return lines.join("\n");
}

function normalizeForgeEvents(events = []) {
  const steps = [];

  for (const event of events) {
    const normalized = normalizeEvent(event);

    if (!normalized) {
      continue;
    }

    if (normalized.action === "navigation") {
      markRecentNavigationWait(steps, normalized);
      continue;
    }

    if (normalized.action === "type") {
      removeRecentMatchingClick(steps, normalized);
      replaceRecentMatchingType(steps, normalized);
      continue;
    }

    if (normalized.action === "select") {
      removeRecentMatchingClick(steps, normalized);
      replaceRecentMatchingSelect(steps, normalized);
      continue;
    }

    if (normalized.action === "doubleClick") {
      removeRecentMatchingClick(steps, normalized, 1200);

      if (!isDuplicateDoubleClick(steps[steps.length - 1], normalized)) {
        steps.push(normalized);
      }

      continue;
    }

    if (normalized.action === "click" && isClickPartOfRecentDoubleClick(steps[steps.length - 1], normalized)) {
      continue;
    }

    if (normalized.action === "click" && isDuplicateClick(steps[steps.length - 1], normalized)) {
      continue;
    }

    steps.push(normalized);
  }

  return steps;
}

function createDefaultOutputPath(options = {}) {
  const cwd = options.cwd || process.cwd();
  const startUrl = normalizeUrl(options.startUrl);
  const slug = slugify(options.testName || hostnameFromUrl(startUrl) || "browser-flow");
  const stamp = createTimestamp(options.now || new Date());

  return path.join(cwd, "tests", "forge", `${stamp}-${slug}.test.js`);
}

function formatStep(step) {
  const locator = formatLocator(step.locator);

  if (!locator) {
    return "";
  }

  if (step.action === "click") {
    return step.waitForNavigation
      ? `  await orbit.click(${locator}, { waitForNavigation: true });`
      : `  await orbit.click(${locator});`;
  }

  if (step.action === "doubleClick") {
    return step.waitForNavigation
      ? `  await orbit.doubleClick(${locator}, { waitForNavigation: true });`
      : `  await orbit.doubleClick(${locator});`;
  }

  if (step.action === "rightClick") {
    return `  await orbit.rightClick(${locator});`;
  }

  if (step.action === "type") {
    const value = step.secret
      ? `process.env.${secretEnvName(step)} || ""`
      : quote(step.value || "");

    return `  await orbit.type(${locator}, ${value});`;
  }

  if (step.action === "select") {
    return `  await forgeSelect(orbit, ${JSON.stringify(step.locator)}, ${quote(step.value || "")});`;
  }

  if (step.action === "assertVisible") {
    return `  expect(await orbit.exists(${locator})).toBe(true);`;
  }

  if (step.action === "assertText") {
    return `  expect(await orbit.hasText(${quote(step.text || "")})).toBe(true);`;
  }

  return "";
}

function formatLocator(locator) {
  const normalized = normalizeLocator(locator);

  if (!normalized) {
    return "";
  }

  if (normalized.kind === "nth") {
    const inner = formatLocator(normalized.locator);

    return inner ? `orbit.nth(${inner}, ${normalized.index})` : "";
  }

  if (normalized.kind === "near") {
    const target = formatLocator(normalized.target);
    const anchor = formatLocator(normalized.anchor);

    return target && anchor ? `orbit.near(${target}, ${anchor})` : "";
  }

  if (normalized.kind === "text") {
    return quote(normalized.text);
  }

  if (normalized.kind === "role") {
    if (shouldUseIntentStringForRole(normalized)) {
      return quote(normalized.name);
    }

    return normalized.name
      ? `orbit.getByRole(${quote(normalized.role)}, ${quote(normalized.name)})`
      : `orbit.getByRole(${quote(normalized.role)})`;
  }

  if (normalized.kind === "attribute") {
    return normalized.value === undefined || normalized.value === null
      ? `orbit.getByAttribute(${quote(normalized.name)})`
      : `orbit.getByAttribute(${quote(normalized.name)}, ${quote(normalized.value)})`;
  }

  if (normalized.kind === "css") {
    return `orbit.css(${quote(normalized.selector)})`;
  }

  if (normalized.kind === "xpath") {
    return `orbit.xpath(${quote(normalized.selector)})`;
  }

  return "";
}

function shouldUseIntentStringForRole(locator) {
  const name = compactText(locator.name);

  if (!name) {
    return false;
  }

  return [
    "button",
    "link",
    "textbox",
    "combobox",
    "option",
    "menuitem",
    "tab",
    "checkbox",
    "radio",
    "switch",
    "heading"
  ].includes(String(locator.role || "").toLowerCase());
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const locator = normalizeLocator(event.locator);
  const action = String(event.action || event.type || "").trim();

  if (!locator && !["assertText", "navigation"].includes(action)) {
    return null;
  }

  if (action === "navigation") {
    const url = normalizeUrl(event.url);
    return url ? { action: "navigation", url, at: normalizeTime(event) } : null;
  }

  if (action === "click") {
    return { action: "click", locator, at: normalizeTime(event) };
  }

  if (action === "doubleClick" || action === "dblclick") {
    return { action: "doubleClick", locator, at: normalizeTime(event) };
  }

  if (action === "rightClick" || action === "contextmenu") {
    return { action: "rightClick", locator, at: normalizeTime(event) };
  }

  if (action === "input" || action === "type") {
    const value = event.secret ? "" : String(event.value ?? "");

    return {
      action: "type",
      locator: stabilizeInputLocator(locator, value),
      value,
      secret: Boolean(event.secret),
      secretName: event.secretName || null,
      at: normalizeTime(event)
    };
  }

  if (action === "select") {
    return {
      action: "select",
      locator,
      value: String(event.value ?? ""),
      at: normalizeTime(event)
    };
  }

  if (action === "assertVisible" || action === "verifyVisible") {
    return { action: "assertVisible", locator, at: normalizeTime(event) };
  }

  if (action === "assertText" || action === "verifyText") {
    const text = compactText(event.text);
    return text ? { action: "assertText", text, at: normalizeTime(event) } : null;
  }

  return null;
}

function normalizeLocator(locator) {
  if (typeof locator === "string" && compactText(locator)) {
    return {
      kind: "text",
      text: compactText(locator)
    };
  }

  if (!locator || typeof locator !== "object") {
    return null;
  }

  const kind = String(locator.kind || locator.type || "").trim();

  if (kind === "near") {
    const target = normalizeLocator(locator.target || locator.locator || locator.of);
    const anchor = normalizeLocator(locator.anchor || locator.near || locator.context || locator.within);

    if (target && anchor) {
      return {
        kind: "near",
        target,
        anchor
      };
    }

    return null;
  }

  if (kind === "nth") {
    const inner = normalizeLocator(locator.locator || locator.target || locator.of);
    const index = Number(locator.index);

    if (inner && Number.isInteger(index)) {
      return {
        kind: "nth",
        locator: inner,
        index
      };
    }

    return null;
  }

  if (kind === "text" && compactText(locator.text)) {
    return {
      kind: "text",
      text: compactText(locator.text)
    };
  }

  if (kind === "role" && compactText(locator.role)) {
    return {
      kind: "role",
      role: compactText(locator.role).toLowerCase(),
      name: compactText(locator.name)
    };
  }

  if (kind === "attribute" && compactText(locator.name)) {
    return {
      kind: "attribute",
      name: compactText(locator.name),
      value: locator.value === undefined || locator.value === null ? undefined : String(locator.value)
    };
  }

  if (kind === "css" && compactText(locator.selector)) {
    return {
      kind: "css",
      selector: compactText(locator.selector)
    };
  }

  if (kind === "xpath" && compactText(locator.selector)) {
    return {
      kind: "xpath",
      selector: compactText(locator.selector)
    };
  }

  return null;
}

function removeRecentMatchingClick(steps, step, maxAge = 2000) {
  const previous = steps[steps.length - 1];

  if (!previous || previous.action !== "click") {
    return;
  }

  if (sameLocator(previous.locator, step.locator) && Math.abs(step.at - previous.at) < maxAge) {
    steps.pop();
  }
}

function markRecentNavigationWait(steps, navigation) {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];

    if (!["click", "doubleClick"].includes(step.action)) {
      continue;
    }

    if (navigation.at - step.at <= 5000) {
      step.waitForNavigation = true;
    }

    return;
  }
}

function replaceRecentMatchingType(steps, step) {
  const previous = steps[steps.length - 1];

  if (previous && previous.action === "type" && sameLocator(previous.locator, step.locator)) {
    steps[steps.length - 1] = step;
    return;
  }

  steps.push(step);
}

function replaceRecentMatchingSelect(steps, step) {
  const previous = steps[steps.length - 1];

  if (previous && previous.action === "select" && sameLocator(previous.locator, step.locator)) {
    steps[steps.length - 1] = step;
    return;
  }

  steps.push(step);
}

function isDuplicateClick(previous, step) {
  return Boolean(
    previous &&
    previous.action === "click" &&
    sameLocator(previous.locator, step.locator) &&
    step.at - previous.at < 500
  );
}

function isDuplicateDoubleClick(previous, step) {
  return Boolean(
    previous &&
    previous.action === "doubleClick" &&
    sameLocator(previous.locator, step.locator) &&
    Math.abs(step.at - previous.at) < 1200
  );
}

function isClickPartOfRecentDoubleClick(previous, step) {
  return Boolean(
    previous &&
    previous.action === "doubleClick" &&
    sameLocator(previous.locator, step.locator) &&
    Math.abs(step.at - previous.at) < 1200
  );
}

function sameLocator(a, b) {
  return JSON.stringify(normalizeLocator(a)) === JSON.stringify(normalizeLocator(b));
}

function stabilizeInputLocator(locator, value) {
  const normalized = normalizeLocator(locator);
  const typed = compactText(value);

  if (!normalized || !typed) {
    return normalized;
  }

  if (normalized.kind === "role" && normalized.role === "textbox") {
    return {
      ...normalized,
      name: removeTypedSuffix(normalized.name, typed)
    };
  }

  if (normalized.kind === "text") {
    return {
      ...normalized,
      text: removeTypedSuffix(normalized.text, typed)
    };
  }

  if (normalized.kind === "nth") {
    return {
      ...normalized,
      locator: stabilizeInputLocator(normalized.locator, value)
    };
  }

  if (normalized.kind === "near") {
    return {
      ...normalized,
      target: stabilizeInputLocator(normalized.target, value)
    };
  }

  return normalized;
}

function removeTypedSuffix(label, typed) {
  const text = compactText(label);
  const value = compactText(typed);

  if (!text || !value) {
    return text;
  }

  const lowerText = text.toLowerCase();
  const lowerValue = value.toLowerCase();

  if (lowerText === lowerValue) {
    return text;
  }

  if (lowerText.endsWith(` ${lowerValue}`)) {
    return text.slice(0, text.length - value.length).trim();
  }

  return text;
}

function secretEnvName(step) {
  const source = step.secretName || step.locator?.name || step.locator?.text || step.locator?.role || "secret";
  const normalized = String(source)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return `ORBITTEST_${normalized || "SECRET"}`;
}

function normalizeTime(event) {
  const number = Number(event.at ?? event.time ?? event.timestamp ?? Date.now());

  return Number.isFinite(number) ? number : Date.now();
}

function quote(value) {
  return JSON.stringify(String(value));
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function sanitizeTestName(value) {
  return compactText(value).replace(/["'`]/g, "") || DEFAULT_TEST_NAME;
}

function inferTestName(url) {
  const host = hostnameFromUrl(url);

  return host ? `${host} flow` : "";
}

function normalizeUrl(value) {
  const text = String(value || "").trim();

  if (!text || text === "about:blank") {
    return "";
  }

  return text;
}

function hostnameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "browser-flow";
}

function createTimestamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = number => String(number).padStart(2, "0");

  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    "-",
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds())
  ].join("");
}

function buildSelectHelperLines() {
  return [
    "async function forgeSelect(orbit, locator, value) {",
    "  await orbit.evaluate((target, nextValue) => {",
    "    function text(value) {",
    "      return String(value || \"\").replace(/\\s+/g, \" \").trim().toLowerCase();",
    "    }",
    "",
    "    function roleFor(element) {",
    "      const explicit = element.getAttribute(\"role\");",
    "      if (explicit) return explicit.toLowerCase();",
    "      const tag = element.tagName.toLowerCase();",
    "      if (tag === \"select\") return \"combobox\";",
    "      return \"\";",
    "    }",
    "",
    "    function accessibleName(element) {",
    "      const labelledBy = element.getAttribute(\"aria-labelledby\");",
    "      const labelledText = labelledBy ? labelledBy.split(/\\s+/).map(id => document.getElementById(id)?.innerText || \"\").join(\" \") : \"\";",
    "      const labels = element.id ? Array.from(document.querySelectorAll(`label[for=\"${CSS.escape(element.id)}\"]`)).map(label => label.innerText).join(\" \") : \"\";",
    "      const parentLabel = element.closest(\"label\")?.innerText || \"\";",
    "      return [element.getAttribute(\"aria-label\"), labelledText, labels, parentLabel, element.name, element.title].filter(Boolean).join(\" \");",
    "    }",
    "",
    "    function findAll(target) {",
    "      if (target.kind === \"near\") {",
    "        const targets = findAll(target.target);",
    "        const anchors = findAll(target.anchor);",
    "",
    "        return targets.filter(item => anchors.some(anchor => item !== anchor && commonContainer(item, anchor))).sort((a, b) => {",
    "          const scoreA = Math.min(...anchors.map(anchor => contextualScore(a, anchor)));",
    "          const scoreB = Math.min(...anchors.map(anchor => contextualScore(b, anchor)));",
    "          return scoreA - scoreB;",
    "        });",
    "      }",
    "      if (target.kind === \"css\") return Array.from(document.querySelectorAll(target.selector));",
    "      if (target.kind === \"attribute\") return Array.from(document.querySelectorAll(`[${CSS.escape(target.name)}=\"${CSS.escape(String(target.value || \"\"))}\"]`));",
    "      if (target.kind === \"role\") return Array.from(document.querySelectorAll(\"select\")).filter(element => roleFor(element) === target.role && text(accessibleName(element)).includes(text(target.name)));",
    "      if (target.kind === \"text\") return Array.from(document.querySelectorAll(\"select\")).filter(element => text(accessibleName(element)).includes(text(target.text)));",
    "      return [];",
    "    }",
    "",
    "    function contextualScore(target, anchor) {",
    "      const container = commonContainer(target, anchor);",
    "      if (!container) return Number.POSITIVE_INFINITY;",
    "      const rectA = target.getBoundingClientRect();",
    "      const rectB = anchor.getBoundingClientRect();",
    "      const dx = rectA.left + rectA.width / 2 - (rectB.left + rectB.width / 2);",
    "      const dy = rectA.top + rectA.height / 2 - (rectB.top + rectB.height / 2);",
    "      return Math.hypot(dx, dy) + container.getBoundingClientRect().width;",
    "    }",
    "",
    "    function commonContainer(a, b) {",
    "      const ancestors = new Set();",
    "      let current = a;",
    "      while (current && current instanceof Element) {",
    "        ancestors.add(current);",
    "        current = current.parentElement;",
    "      }",
    "      current = b;",
    "      while (current && current instanceof Element) {",
    "        if (ancestors.has(current)) return current;",
    "        current = current.parentElement;",
    "      }",
    "      return null;",
    "    }",
    "",
    "    function find(target) {",
    "      if (target.kind === \"nth\") {",
    "        const elements = findAll(target.locator);",
    "        const rawIndex = Number(target.index);",
    "        const index = rawIndex < 0 ? elements.length + rawIndex : rawIndex;",
    "",
    "        return Number.isInteger(index) ? elements[index] || null : null;",
    "      }",
    "",
    "      return findAll(target)[0] || null;",
    "    }",
    "",
    "    const element = find(target);",
    "    if (!element) throw new Error(\"Forge select target was not found.\");",
    "    element.value = nextValue;",
    "    element.dispatchEvent(new Event(\"input\", { bubbles: true }));",
    "    element.dispatchEvent(new Event(\"change\", { bubbles: true }));",
    "  }, locator, value);",
    "}"
  ];
}

module.exports = {
  buildOrbitTestScript,
  createDefaultOutputPath,
  formatLocator,
  normalizeForgeEvents
};
