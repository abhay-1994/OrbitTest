const fs = require("fs");
const path = require("path");

function discoverTestFiles(inputs, config = getDefaultConfig(), cwd = process.cwd()) {
  const roots = inputs.length > 0 ? inputs : [config.testDir];
  const found = [];

  for (const input of roots) {
    const resolved = path.resolve(cwd, input);

    if (!fs.existsSync(resolved)) {
      continue;
    }

    const stat = fs.statSync(resolved);

    if (stat.isDirectory()) {
      found.push(...findTestsInDirectory(resolved, config, cwd));
    } else if (stat.isFile() && isTestFile(resolved, config, cwd)) {
      found.push(resolved);
    }
  }

  return Array.from(new Set(found)).sort();
}

function findTestsInDirectory(dir, config, cwd) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "reports") {
        continue;
      }

      files.push(...findTestsInDirectory(fullPath, config, cwd));
      continue;
    }

    if (entry.isFile() && isTestFile(fullPath, config, cwd)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isTestFile(filePath, config, cwd) {
  return config.testMatch.some(pattern => matchesGlob(filePath, pattern, cwd));
}

function loadConfig(cwd) {
  const configPath = path.join(cwd, "orbittest.config.js");

  let config = {};

  if (fs.existsSync(configPath)) {
    const loaded = require(configPath);
    config = typeof loaded === "function" ? loaded() : loaded;

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("orbittest.config.js must export an object.");
    }
  }

  return normalizeConfig(applyEnvironmentConfig(config));
}

function normalizeConfig(config = {}) {
  const defaults = getDefaultConfig();
  validateConfigKeys(config, defaults);

  const testMatch = Array.isArray(config.testMatch)
    ? config.testMatch
    : config.testMatch
      ? [config.testMatch]
      : defaults.testMatch;

  const normalized = {
    testDir: normalizeString(config.testDir, defaults.testDir, "testDir"),
    testMatch,
    reportsDir: normalizeString(config.reportsDir, defaults.reportsDir, "reportsDir"),
    globalSetup: normalizeGlobalSetupConfig(config.globalSetup, defaults.globalSetup),
    workers: config.parallel === true
      ? true
      : normalizePositiveInteger(config.workers, defaults.workers, "workers"),
    maxWorkers: normalizePositiveInteger(config.maxWorkers, defaults.maxWorkers, "maxWorkers"),
    retries: normalizeNonNegativeInteger(config.retries, defaults.retries, "retries"),
    testTimeout: normalizePositiveInteger(config.testTimeout, defaults.testTimeout, "testTimeout"),
    actionTimeout: normalizeNonNegativeInteger(config.actionTimeout, defaults.actionTimeout, "actionTimeout"),
    smartReport: Boolean(config.smartReport ?? defaults.smartReport),
    smartReportSlowRequestMs: normalizeNonNegativeInteger(config.smartReportSlowRequestMs, defaults.smartReportSlowRequestMs, "smartReportSlowRequestMs"),
    browser: normalizeBrowserConfig(config.browser, defaults.browser),
    experimental: normalizeExperimentalConfig(config.experimental, defaults.experimental),
    openReportOnFailure: normalizeOpenReportOnFailureConfig(config.openReportOnFailure, defaults.openReportOnFailure),
    reportRetention: normalizeReportRetentionConfig(config.reportRetention, defaults.reportRetention),
    ci: normalizeCiConfig(config.ci, defaults.ci)
  };

  if (normalized.testMatch.some(pattern => typeof pattern !== "string" || !pattern.trim())) {
    throw new Error("Invalid orbittest.config.js: testMatch must contain non-empty strings.");
  }

  return normalized;
}

function getDefaultConfig() {
  return {
    testDir: "tests",
    testMatch: ["**/*.test.js", "**/*.spec.js"],
    reportsDir: "reports",
    globalSetup: [],
    workers: 1,
    maxWorkers: 4,
    retries: 0,
    testTimeout: 30000,
    actionTimeout: 0,
    smartReport: false,
    smartReportSlowRequestMs: 2000,
    browser: {
      display: "auto"
    },
    experimental: {
      studio: true,
      visualAutomation: true,
      apiTesting: false
    },
    openReportOnFailure: {
      enabled: !isCi(),
      host: "127.0.0.1",
      port: 0,
      ttlMs: 30 * 60 * 1000,
      openBrowser: true
    },
    reportRetention: {
      keepLatest: true,
      passedRuns: 10,
      failedRuns: 30,
      maxAgeDays: 30,
      autoCleanup: false
    },
    ci: {
      enabled: isCi(),
      retries: 1,
      trace: "on-failure",
      screenshot: "on-failure",
      failFast: false,
      maxFailures: 0,
      shard: process.env.ORBITTEST_SHARD || null,
      summary: true,
      junit: true,
      githubAnnotations: Boolean(process.env.GITHUB_ACTIONS)
    }
  };
}

function applyEnvironmentConfig(config) {
  const envName = process.env.ORBITTEST_ENV || config.env;

  if (!envName || !config.environments) {
    return config;
  }

  if (!config.environments[envName]) {
    throw new Error(`Invalid orbittest.config.js: environment "${envName}" was not found.`);
  }

  return {
    ...config,
    ...config.environments[envName],
    environments: config.environments
  };
}

function validateConfigKeys(config, defaults) {
  const allowed = new Set([
    ...Object.keys(defaults),
    "parallel",
    "env",
    "environments",
    "globalSetup",
    "openReportOnFailure",
    "reportRetention",
    "browser",
    "ci"
  ]);

  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid orbittest.config.js: unknown option "${key}".`);
    }
  }
}

function normalizeString(value, fallback, name) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid orbittest.config.js: ${name} must be a non-empty string.`);
  }

  return value;
}

function normalizePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === true) {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid orbittest.config.js: ${name} must be a positive integer.`);
  }

  return number;
}

function normalizeNonNegativeInteger(value, fallback, name) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid orbittest.config.js: ${name} must be a non-negative integer.`);
  }

  return number;
}

function normalizeGlobalSetupConfig(value, fallback) {
  if (value === undefined || value === null || value === false) {
    return fallback;
  }

  const entries = Array.isArray(value) ? value : [value];

  if (entries.some(entry => typeof entry !== "string" || !entry.trim())) {
    throw new Error("Invalid orbittest.config.js: globalSetup must be a non-empty string or an array of non-empty strings.");
  }

  return entries.map(entry => entry.trim());
}

function normalizeReportRetentionConfig(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid orbittest.config.js: reportRetention must be an object.");
  }

  const allowed = new Set(["keepLatest", "passedRuns", "failedRuns", "maxAgeDays", "autoCleanup"]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid orbittest.config.js: unknown reportRetention option "${key}".`);
    }
  }

  return {
    keepLatest: value.keepLatest !== undefined ? Boolean(value.keepLatest) : fallback.keepLatest,
    passedRuns: normalizeNonNegativeInteger(value.passedRuns, fallback.passedRuns, "reportRetention.passedRuns"),
    failedRuns: normalizeNonNegativeInteger(value.failedRuns, fallback.failedRuns, "reportRetention.failedRuns"),
    maxAgeDays: normalizeNonNegativeInteger(value.maxAgeDays, fallback.maxAgeDays, "reportRetention.maxAgeDays"),
    autoCleanup: Boolean(value.autoCleanup ?? fallback.autoCleanup)
  };
}

function normalizeBrowserConfig(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "string") {
    return {
      ...fallback,
      display: normalizeBrowserDisplayConfig(value, "browser")
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid orbittest.config.js: browser must be a string or object.");
  }

  const allowed = new Set(["display"]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid orbittest.config.js: unknown browser option "${key}".`);
    }
  }

  return {
    display: normalizeBrowserDisplayConfig(value.display ?? fallback.display, "browser.display")
  };
}

function normalizeBrowserDisplayConfig(value, name) {
  const display = String(value || "auto").trim().toLowerCase();

  if (!["auto", "show", "hide"].includes(display)) {
    throw new Error(`Invalid orbittest.config.js: ${name} must be "auto", "show", or "hide".`);
  }

  return display;
}

function normalizeExperimentalConfig(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid orbittest.config.js: experimental must be an object.");
  }

  const allowed = new Set(["studio", "visualAutomation", "apiTesting"]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid orbittest.config.js: unknown experimental option "${key}".`);
    }
  }

  return {
    studio: value.studio !== undefined ? Boolean(value.studio) : fallback.studio,
    visualAutomation: value.visualAutomation !== undefined ? Boolean(value.visualAutomation) : fallback.visualAutomation,
    apiTesting: value.apiTesting !== undefined ? Boolean(value.apiTesting) : fallback.apiTesting
  };
}

function normalizeCiConfig(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return {
      ...fallback,
      enabled: value
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid orbittest.config.js: ci must be a boolean or object.");
  }

  const allowed = new Set([
    "enabled",
    "retries",
    "trace",
    "screenshot",
    "failFast",
    "maxFailures",
    "shard",
    "summary",
    "junit",
    "githubAnnotations"
  ]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid orbittest.config.js: unknown ci option "${key}".`);
    }
  }

  return {
    enabled: value.enabled !== undefined ? Boolean(value.enabled) : fallback.enabled,
    retries: normalizeNonNegativeInteger(value.retries, fallback.retries, "ci.retries"),
    trace: normalizeCiMode(value.trace, fallback.trace, "ci.trace", ["off", "on", "on-failure"]),
    screenshot: normalizeCiMode(value.screenshot, fallback.screenshot, "ci.screenshot", ["off", "on-failure"]),
    failFast: value.failFast !== undefined ? Boolean(value.failFast) : fallback.failFast,
    maxFailures: normalizeNonNegativeInteger(value.maxFailures, fallback.maxFailures, "ci.maxFailures"),
    shard: normalizeShardConfig(value.shard, fallback.shard, "ci.shard"),
    summary: value.summary !== undefined ? Boolean(value.summary) : fallback.summary,
    junit: value.junit !== undefined ? Boolean(value.junit) : fallback.junit,
    githubAnnotations: value.githubAnnotations !== undefined ? Boolean(value.githubAnnotations) : fallback.githubAnnotations
  };
}

function normalizeCiMode(value, fallback, name, allowedModes) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value ? (allowedModes.includes("on") ? "on" : "on-failure") : "off";
  }

  const mode = String(value).trim().toLowerCase();

  if (!allowedModes.includes(mode)) {
    throw new Error(`Invalid orbittest.config.js: ${name} must be one of ${allowedModes.join(", ")}.`);
  }

  return mode;
}

function normalizeShardConfig(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return fallback || null;
  }

  if (!parseShardValue(value)) {
    throw new Error(`Invalid orbittest.config.js: ${name} must use the format current/total, for example 1/4.`);
  }

  return String(value).trim();
}

function normalizeOpenReportOnFailureConfig(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return {
      ...fallback,
      enabled: value
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid orbittest.config.js: openReportOnFailure must be a boolean or object.");
  }

  const allowed = new Set(["enabled", "host", "port", "ttlMs", "timeoutMs", "openBrowser"]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid orbittest.config.js: unknown openReportOnFailure option "${key}".`);
    }
  }

  return {
    enabled: value.enabled !== undefined ? Boolean(value.enabled) : fallback.enabled,
    host: normalizeString(value.host, fallback.host, "openReportOnFailure.host"),
    port: normalizePortConfig(value.port, fallback.port, "openReportOnFailure.port"),
    ttlMs: normalizeNonNegativeInteger(value.ttlMs ?? value.timeoutMs, fallback.ttlMs, "openReportOnFailure.ttlMs"),
    openBrowser: value.openBrowser !== undefined ? Boolean(value.openBrowser) : fallback.openBrowser
  };
}

function mergeCiOptions(configValue, runArgs) {
  return {
    ...configValue,
    ...(runArgs.ci !== null ? { enabled: runArgs.ci } : {}),
    ...(runArgs.failFast !== null ? { failFast: runArgs.failFast } : {}),
    ...(runArgs.maxFailures !== null ? { maxFailures: Number(runArgs.maxFailures) } : {}),
    ...(runArgs.shard !== null ? { shard: String(runArgs.shard).trim() } : {}),
    ...(runArgs.githubAnnotations !== null ? { githubAnnotations: runArgs.githubAnnotations } : {})
  };
}

function mergeOpenReportOnFailureOptions(configValue, runArgs, ciOptions) {
  return {
    ...configValue,
    ...(
      ciOptions?.enabled && runArgs.openReportOnFailure === null
        ? { enabled: false }
        : {}
    ),
    ...(runArgs.openReportOnFailure !== null ? { enabled: runArgs.openReportOnFailure } : {}),
    ...(runArgs.reportPort !== null ? { port: Number(runArgs.reportPort) } : {})
  };
}

function resolveRetries(runArgs, config) {
  const ciOptions = mergeCiOptions(config.ci, runArgs);

  if (runArgs.retries !== null) {
    return runArgs.retries;
  }

  if (ciOptions.enabled) {
    return ciOptions.retries;
  }

  return config.retries;
}

function resolveTraceMode(runArgs, config) {
  const ciOptions = mergeCiOptions(config.ci, runArgs);

  if (runArgs.trace) {
    return "on";
  }

  if (ciOptions.enabled) {
    return ciOptions.trace;
  }

  return "off";
}

function resolveScreenshotMode(runArgs, config) {
  const ciOptions = mergeCiOptions(config.ci, runArgs);

  return ciOptions.enabled ? ciOptions.screenshot : "on-failure";
}

function resolveBrowserDisplay(runArgs, config, ciOptions) {
  if (runArgs.step) {
    return "show";
  }

  const display = runArgs.browserDisplay || config.browser.display;

  if (display === "auto") {
    return ciOptions.enabled ? "hide" : "show";
  }

  return display;
}

function parseShardValue(value) {
  const match = String(value || "").trim().match(/^(\d+)\/(\d+)$/);

  if (!match) {
    return null;
  }

  const current = Number(match[1]);
  const total = Number(match[2]);

  if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < 1 || current > total) {
    return null;
  }

  return { current, total };
}

function normalizePortConfig(value, fallback, name) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < 0 || number > 65535) {
    throw new Error(`Invalid orbittest.config.js: ${name} must be an integer between 0 and 65535.`);
  }

  return number;
}

function isCi() {
  return Boolean(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.BITBUCKET_BUILD_NUMBER ||
    process.env.TF_BUILD
  );
}

function matchesGlob(filePath, pattern, cwd) {
  const relativePath = path.relative(cwd, filePath).replace(/\\/g, "/");
  const normalizedPattern = String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");

  return globToRegExp(normalizedPattern).test(relativePath);
}

function globToRegExp(pattern) {
  let source = "^";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    const afterNext = pattern[i + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*\\/)?";
      i += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source, "i");
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

module.exports = {
  discoverTestFiles,
  getDefaultConfig,
  loadConfig,
  mergeCiOptions,
  mergeOpenReportOnFailureOptions,
  normalizeConfig,
  parseShardValue,
  resolveBrowserDisplay,
  resolveRetries,
  resolveScreenshotMode,
  resolveTraceMode
};
