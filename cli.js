#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Module = require("module");

const packageApiPath = path.join(__dirname, "orbit.js");
const packageJson = require("./package.json");
const resolveFilename = Module._resolveFilename;
const packageApi = require("./orbit");

Module._resolveFilename = function resolveOrbitTest(request, parent, isMain, options) {
  if (request === "orbittest") {
    return packageApiPath;
  }

  return resolveFilename.call(this, request, parent, isMain, options);
};

module.exports = packageApi;

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "run";

  if (command === "-h" || command === "--help" || command === "help") {
    printHelp();
    return;
  }

  if (command === "-v" || command === "--version" || command === "version") {
    console.log(packageJson.version);
    return;
  }

  if (command === "init") {
    initProject();
    return;
  }

  if (command === "run") {
    await runTests(args.slice(1));
    return;
  }

  if (command === "clean-reports") {
    cleanReportsCommand(args.slice(1));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function runTests(args) {
  if (args.includes("-h") || args.includes("--help")) {
    printRunHelp();
    return;
  }

  const runArgs = parseRunArgs(args);
  validateRunArgs(runArgs);
  if (runArgs.env) {
    process.env.ORBITTEST_ENV = runArgs.env;
  }

  const config = loadConfig(process.cwd());
  const testFiles = discoverTestFiles(runArgs.testInputs, config);

  if (testFiles.length === 0) {
    console.error("No test files found.");
    console.error("Create one with: orbittest init");
    console.error(`Expected files matching: ${config.testMatch.join(", ")}`);
    process.exit(1);
  }

  process.env.ORBITTEST_CLI = "1";
  process.env.ORBITTEST_COLLECT_ONLY = "1";

  const runner = require("./runner/runner");
  runner.resetTests();

  for (const file of testFiles) {
    process.env.ORBITTEST_LOADING_FILE = file;
    require(file);
  }

  delete process.env.ORBITTEST_LOADING_FILE;
  delete process.env.ORBITTEST_COLLECT_ONLY;

  if (runner.getTests().length === 0) {
    console.error("No tests were registered.");
    console.error("Add tests with: test(\"name\", async (orbit) => { ... })");
    process.exit(1);
  }

  const ciOptions = mergeCiOptions(config.ci, runArgs);
  const traceMode = resolveTraceMode(runArgs, config);

  if (ciOptions.enabled && runArgs.step) {
    throw new Error("--step is interactive and cannot run in CI mode. Use --no-ci for a local debug run.");
  }

  await runner.runRegisteredTests({
    testFiles,
    reportsDir: path.resolve(process.cwd(), runArgs.reportsDir || config.reportsDir),
    workers: runArgs.workers ?? config.workers,
    maxWorkers: config.maxWorkers,
    retries: resolveRetries(runArgs, config),
    testTimeout: runArgs.testTimeout ?? config.testTimeout,
    actionTimeout: config.actionTimeout,
    trace: traceMode !== "off",
    traceMode,
    screenshot: resolveScreenshotMode(runArgs, config),
    step: runArgs.step,
    smartReport: runArgs.smartReport ?? config.smartReport,
    smartReportSlowRequestMs: config.smartReportSlowRequestMs,
    verbose: runArgs.verbose,
    openReportOnFailure: mergeOpenReportOnFailureOptions(config.openReportOnFailure, runArgs, ciOptions),
    reportRetention: config.reportRetention,
    ci: ciOptions
  });
}

function cleanReportsCommand(args) {
  if (args.includes("-h") || args.includes("--help")) {
    printCleanReportsHelp();
    return;
  }

  const cleanArgs = parseCleanReportsArgs(args);
  validateCleanReportsArgs(cleanArgs);
  const config = loadConfig(process.cwd());
  const retention = {
    ...config.reportRetention,
    ...(cleanArgs.passedRuns !== null ? { passedRuns: Number(cleanArgs.passedRuns) } : {}),
    ...(cleanArgs.failedRuns !== null ? { failedRuns: Number(cleanArgs.failedRuns) } : {}),
    ...(cleanArgs.maxAgeDays !== null ? { maxAgeDays: Number(cleanArgs.maxAgeDays) } : {})
  };
  const runner = require("./runner/runner");
  const result = runner.cleanReports({
    reportsDir: path.resolve(process.cwd(), cleanArgs.reportsDir || config.reportsDir),
    retention,
    dryRun: cleanArgs.dryRun
  });

  console.log(`\nOrbitTest Report Cleanup${result.dryRun ? " (dry run)" : ""}`);
  console.log("------------------------");
  console.log(`Reports dir: ${result.reportsDir}`);
  console.log(`Deleted: ${result.deleted.length}`);
  console.log(`Kept: ${result.kept.length}`);

  if (result.deleted.length > 0) {
    console.log("\nDeleted reports:");
    result.deleted.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.runId} (${entry.status}) - ${entry.reason}`);
    });
  }
}

function parseCleanReportsArgs(args) {
  const parsed = {
    reportsDir: null,
    passedRuns: null,
    failedRuns: null,
    maxAgeDays: null,
    dryRun: false,
    unknownArgs: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--reports-dir") {
      parsed.reportsDir = readOptionValue(args, i, "--reports-dir");
      i++;
      continue;
    }

    if (arg.startsWith("--reports-dir=")) {
      parsed.reportsDir = arg.slice("--reports-dir=".length);
      continue;
    }

    if (arg === "--passed") {
      parsed.passedRuns = readOptionValue(args, i, "--passed");
      i++;
      continue;
    }

    if (arg.startsWith("--passed=")) {
      parsed.passedRuns = arg.slice("--passed=".length);
      continue;
    }

    if (arg === "--failed") {
      parsed.failedRuns = readOptionValue(args, i, "--failed");
      i++;
      continue;
    }

    if (arg.startsWith("--failed=")) {
      parsed.failedRuns = arg.slice("--failed=".length);
      continue;
    }

    if (arg === "--max-age-days") {
      parsed.maxAgeDays = readOptionValue(args, i, "--max-age-days");
      i++;
      continue;
    }

    if (arg.startsWith("--max-age-days=")) {
      parsed.maxAgeDays = arg.slice("--max-age-days=".length);
      continue;
    }

    parsed.unknownArgs.push(arg);
  }

  return parsed;
}

function validateCleanReportsArgs(args) {
  if (args.unknownArgs.length > 0) {
    throw new Error(`Unknown clean-reports option: ${args.unknownArgs[0]}`);
  }

  if (args.reportsDir !== null && !String(args.reportsDir).trim()) {
    throw new Error("--reports-dir requires a non-empty value.");
  }

  if (args.passedRuns !== null) {
    validateNonNegativeIntegerArg(args.passedRuns, "--passed");
  }

  if (args.failedRuns !== null) {
    validateNonNegativeIntegerArg(args.failedRuns, "--failed");
  }

  if (args.maxAgeDays !== null) {
    validateNonNegativeIntegerArg(args.maxAgeDays, "--max-age-days");
  }
}

function parseRunArgs(args) {
  const parsed = {
    testInputs: [],
    workers: null,
    reportsDir: null,
    retries: null,
    testTimeout: null,
    env: null,
    trace: false,
    step: false,
    smartReport: null,
    verbose: false,
    ci: null,
    failFast: null,
    maxFailures: null,
    shard: null,
    githubAnnotations: null,
    openReportOnFailure: null,
    reportPort: null,
    unknownArgs: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--parallel") {
      parsed.workers = true;
      continue;
    }

    if (arg === "--trace") {
      parsed.trace = true;
      continue;
    }

    if (arg === "--step") {
      parsed.step = true;
      parsed.trace = true;
      continue;
    }

    if (arg === "--smart-report") {
      parsed.smartReport = true;
      continue;
    }

    if (arg === "--verbose") {
      parsed.verbose = true;
      continue;
    }

    if (arg === "--ci") {
      parsed.ci = true;
      continue;
    }

    if (arg === "--no-ci") {
      parsed.ci = false;
      continue;
    }

    if (arg === "--fail-fast") {
      parsed.failFast = true;
      continue;
    }

    if (arg === "--no-fail-fast") {
      parsed.failFast = false;
      continue;
    }

    if (arg === "--max-failures") {
      parsed.maxFailures = readOptionValue(args, i, "--max-failures");
      i++;
      continue;
    }

    if (arg.startsWith("--max-failures=")) {
      parsed.maxFailures = arg.slice("--max-failures=".length);
      continue;
    }

    if (arg === "--shard") {
      parsed.shard = readOptionValue(args, i, "--shard");
      i++;
      continue;
    }

    if (arg.startsWith("--shard=")) {
      parsed.shard = arg.slice("--shard=".length);
      continue;
    }

    if (arg === "--github-annotations") {
      parsed.githubAnnotations = true;
      continue;
    }

    if (arg === "--no-github-annotations") {
      parsed.githubAnnotations = false;
      continue;
    }

    if (arg === "--open-report-on-failure" || arg === "--open-report-on-fail") {
      parsed.openReportOnFailure = true;
      continue;
    }

    if (arg === "--no-open-report-on-failure" || arg === "--no-open-report-on-fail") {
      parsed.openReportOnFailure = false;
      continue;
    }

    if (arg === "--report-port") {
      parsed.reportPort = readOptionValue(args, i, "--report-port");
      i++;
      continue;
    }

    if (arg.startsWith("--report-port=")) {
      parsed.reportPort = arg.slice("--report-port=".length);
      continue;
    }

    if (arg === "--workers") {
      parsed.workers = readOptionValue(args, i, "--workers");
      i++;
      continue;
    }

    if (arg.startsWith("--workers=")) {
      parsed.workers = arg.slice("--workers=".length);
      continue;
    }

    if (arg === "--reports-dir") {
      parsed.reportsDir = readOptionValue(args, i, "--reports-dir");
      i++;
      continue;
    }

    if (arg.startsWith("--reports-dir=")) {
      parsed.reportsDir = arg.slice("--reports-dir=".length);
      continue;
    }

    if (arg === "--retries") {
      parsed.retries = readOptionValue(args, i, "--retries");
      i++;
      continue;
    }

    if (arg.startsWith("--retries=")) {
      parsed.retries = arg.slice("--retries=".length);
      continue;
    }

    if (arg === "--timeout") {
      parsed.testTimeout = readOptionValue(args, i, "--timeout");
      i++;
      continue;
    }

    if (arg.startsWith("--timeout=")) {
      parsed.testTimeout = arg.slice("--timeout=".length);
      continue;
    }

    if (arg === "--env") {
      parsed.env = readOptionValue(args, i, "--env");
      i++;
      continue;
    }

    if (arg.startsWith("--env=")) {
      parsed.env = arg.slice("--env=".length);
      continue;
    }

    if (!arg.startsWith("-")) {
      parsed.testInputs.push(arg);
      continue;
    }

    parsed.unknownArgs.push(arg);
  }

  return parsed;
}

function validateRunArgs(args) {
  if (args.unknownArgs.length > 0) {
    throw new Error(`Unknown run option: ${args.unknownArgs[0]}`);
  }

  if (args.workers !== null && args.workers !== true) {
    validatePositiveIntegerArg(args.workers, "--workers");
  }

  if (args.retries !== null) {
    validateNonNegativeIntegerArg(args.retries, "--retries");
  }

  if (args.testTimeout !== null) {
    validatePositiveIntegerArg(args.testTimeout, "--timeout");
  }

  if (args.reportPort !== null) {
    validatePortArg(args.reportPort, "--report-port");
  }

  if (args.maxFailures !== null) {
    validateNonNegativeIntegerArg(args.maxFailures, "--max-failures");
  }

  if (args.shard !== null) {
    validateShardArg(args.shard, "--shard");
  }

  if (args.ci === true && args.step) {
    throw new Error("--ci cannot be used with --step. Step mode is interactive and should stay local.");
  }

  if (args.reportsDir !== null && !String(args.reportsDir).trim()) {
    throw new Error("--reports-dir requires a non-empty value.");
  }

  if (args.env !== null && !String(args.env).trim()) {
    throw new Error("--env requires a non-empty value.");
  }
}

function readOptionValue(args, index, name) {
  const value = args[index + 1];

  if (value === undefined || String(value).startsWith("-")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function validatePositiveIntegerArg(value, name) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function validateNonNegativeIntegerArg(value, name) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

function validatePortArg(value, name) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0 || number > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535.`);
  }
}

function validateShardArg(value, name) {
  const shard = parseShardValue(value);

  if (!shard) {
    throw new Error(`${name} must use the format current/total, for example 1/4.`);
  }
}

function initProject() {
  const cwd = process.cwd();
  const testsDir = path.join(cwd, "tests");
  const samplePath = path.join(testsDir, "example.test.js");
  const configPath = path.join(cwd, "orbittest.config.js");
  const packagePath = path.join(cwd, "package.json");
  const gitignorePath = path.join(cwd, ".gitignore");

  fs.mkdirSync(testsDir, { recursive: true });

  if (!fs.existsSync(samplePath)) {
    fs.writeFileSync(samplePath, getSampleTest());
    console.log(`Created ${path.relative(cwd, samplePath)}`);
  } else {
    console.log(`Kept existing ${path.relative(cwd, samplePath)}`);
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, getSampleConfig());
    console.log(`Created ${path.relative(cwd, configPath)}`);
  } else {
    console.log(`Kept existing ${path.relative(cwd, configPath)}`);
  }

  ensurePackageScript(packagePath);
  ensureGitignoreEntry(gitignorePath, "reports/");

  console.log("\nOrbitTest is ready.");
  console.log("Run your tests with:");
  console.log("  orbittest run");
}

function discoverTestFiles(inputs, config = getDefaultConfig()) {
  const cwd = process.cwd();
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
    workers: config.parallel === true
      ? true
      : normalizePositiveInteger(config.workers, defaults.workers, "workers"),
    maxWorkers: normalizePositiveInteger(config.maxWorkers, defaults.maxWorkers, "maxWorkers"),
    retries: normalizeNonNegativeInteger(config.retries, defaults.retries, "retries"),
    testTimeout: normalizePositiveInteger(config.testTimeout, defaults.testTimeout, "testTimeout"),
    actionTimeout: normalizeNonNegativeInteger(config.actionTimeout, defaults.actionTimeout, "actionTimeout"),
    smartReport: Boolean(config.smartReport ?? defaults.smartReport),
    smartReportSlowRequestMs: normalizeNonNegativeInteger(config.smartReportSlowRequestMs, defaults.smartReportSlowRequestMs, "smartReportSlowRequestMs"),
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
    workers: 1,
    maxWorkers: 4,
    retries: 0,
    testTimeout: 30000,
    actionTimeout: 0,
    smartReport: false,
    smartReportSlowRequestMs: 2000,
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
    "openReportOnFailure",
    "reportRetention",
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

function ensurePackageScript(packagePath) {
  let packageJson = {
    scripts: {}
  };

  if (fs.existsSync(packagePath)) {
    packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } else {
    packageJson.name = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "orbittest-project";
    packageJson.version = "1.0.0";
  }

  packageJson.scripts = packageJson.scripts || {};

  if (!packageJson.scripts["test:e2e"]) {
    packageJson.scripts["test:e2e"] = "orbittest run";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    console.log("Added npm script: test:e2e");
  }
}

function ensureGitignoreEntry(gitignorePath, entry) {
  const current = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";

  const lines = current.split(/\r?\n/).filter(Boolean);

  if (!lines.includes(entry)) {
    lines.push(entry);
    fs.writeFileSync(gitignorePath, `${lines.join("\n")}\n`);
    console.log(`Added ${entry} to .gitignore`);
  }
}

function getSampleTest() {
  return `const { test } = require("orbittest");

test("Click Login", async (orbit) => {
  await orbit.open("https://bug-orbit.vercel.app/");
  await orbit.click("Login");
});
`;
}

function getSampleConfig() {
  return `module.exports = {
  testDir: "tests",
  testMatch: ["**/*.test.js", "**/*.spec.js"],
  reportsDir: "reports",
  workers: 1,
  maxWorkers: 4,
  retries: 0,
  testTimeout: 30000,
  actionTimeout: 0,
  openReportOnFailure: {
    enabled: true,
    port: 0
  },
  ci: {
    enabled: Boolean(process.env.CI),
    retries: 1,
    trace: "on-failure",
    screenshot: "on-failure",
    failFast: false,
    maxFailures: 0,
    shard: process.env.ORBITTEST_SHARD || null,
    summary: true,
    junit: true,
    githubAnnotations: Boolean(process.env.GITHUB_ACTIONS)
  },
  smartReport: false,
  smartReportSlowRequestMs: 2000,
  reportRetention: {
    keepLatest: true,
    passedRuns: 10,
    failedRuns: 30,
    maxAgeDays: 30,
    autoCleanup: false
  }
};
`;
}

function printHelp() {
  console.log(`OrbitTest ${packageJson.version}

Usage:
  orbittest init
  orbittest run [test-file-or-directory] [--workers N|--parallel] [--retries N] [--timeout MS] [--trace] [--ci] [--shard N/M] [--fail-fast]
  orbittest clean-reports [--dry-run] [--passed N] [--failed N] [--max-age-days N]
  orbittest --version
  orbittest --help

Examples:
  orbittest init
  orbittest run
  orbittest run tests/login.test.js --trace
  orbittest run tests/login.test.js --step
  orbittest run tests/login.test.js --smart-report
  orbittest run --ci --workers 4 --shard 1/4
  orbittest run --ci --github-annotations
  orbittest clean-reports --dry-run
`);
}

function printRunHelp() {
  console.log(`Usage:
  orbittest run [test-file-or-directory] [--workers N|--parallel] [--trace] [--step] [--smart-report] [--verbose]
  orbittest run [test-file-or-directory] --ci [--shard N/M] [--fail-fast] [--max-failures N] [--github-annotations]

When no path is provided, OrbitTest discovers:
  Files from orbittest.config.js, defaulting to:
  tests/**/*.test.js
  tests/**/*.spec.js

Parallel execution:
  orbittest run --workers 4
  orbittest run --parallel

Overrides:
  orbittest run --retries 2 --timeout 30000 --reports-dir reports --env staging
  orbittest run --ci --workers 4 --shard 1/4
  orbittest run --ci --fail-fast
  orbittest run --ci --max-failures 3
  orbittest run --ci --github-annotations
  orbittest run tests/login.test.js --trace
  orbittest run tests/login.test.js --step
  orbittest run tests/login.test.js --smart-report
  orbittest run tests/login.test.js --verbose
  orbittest run tests/login.test.js --no-open-report-on-failure
  orbittest run tests/login.test.js --report-port 9323
`);
}

function printCleanReportsHelp() {
  console.log(`Usage:
  orbittest clean-reports [--dry-run] [--reports-dir DIR] [--passed N] [--failed N] [--max-age-days N]

Examples:
  orbittest clean-reports --dry-run
  orbittest clean-reports
  orbittest clean-reports --passed 10 --failed 30 --max-age-days 30
  orbittest clean-reports --reports-dir reports/debug --dry-run
`);
}
