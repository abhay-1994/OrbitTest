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

  await runner.runRegisteredTests({
    testFiles,
    reportsDir: path.resolve(process.cwd(), runArgs.reportsDir || config.reportsDir),
    workers: runArgs.workers ?? config.workers,
    maxWorkers: config.maxWorkers,
    retries: runArgs.retries ?? config.retries,
    testTimeout: runArgs.testTimeout ?? config.testTimeout,
    actionTimeout: config.actionTimeout
  });
}

function parseRunArgs(args) {
  const parsed = {
    testInputs: [],
    workers: null,
    reportsDir: null,
    retries: null,
    testTimeout: null,
    env: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--parallel") {
      parsed.workers = true;
      continue;
    }

    if (arg === "--workers") {
      parsed.workers = args[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith("--workers=")) {
      parsed.workers = arg.slice("--workers=".length);
      continue;
    }

    if (arg === "--reports-dir") {
      parsed.reportsDir = args[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith("--reports-dir=")) {
      parsed.reportsDir = arg.slice("--reports-dir=".length);
      continue;
    }

    if (arg === "--retries") {
      parsed.retries = args[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith("--retries=")) {
      parsed.retries = arg.slice("--retries=".length);
      continue;
    }

    if (arg === "--timeout") {
      parsed.testTimeout = args[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith("--timeout=")) {
      parsed.testTimeout = arg.slice("--timeout=".length);
      continue;
    }

    if (arg === "--env") {
      parsed.env = args[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith("--env=")) {
      parsed.env = arg.slice("--env=".length);
      continue;
    }

    if (!arg.startsWith("-")) {
      parsed.testInputs.push(arg);
    }
  }

  return parsed;
}

function validateRunArgs(args) {
  if (args.workers !== null && args.workers !== true) {
    validatePositiveIntegerArg(args.workers, "--workers");
  }

  if (args.retries !== null) {
    validateNonNegativeIntegerArg(args.retries, "--retries");
  }

  if (args.testTimeout !== null) {
    validatePositiveIntegerArg(args.testTimeout, "--timeout");
  }

  if (args.reportsDir !== null && !String(args.reportsDir).trim()) {
    throw new Error("--reports-dir requires a non-empty value.");
  }

  if (args.env !== null && !String(args.env).trim()) {
    throw new Error("--env requires a non-empty value.");
  }
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
    actionTimeout: normalizeNonNegativeInteger(config.actionTimeout, defaults.actionTimeout, "actionTimeout")
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
    actionTimeout: 0
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
    "environments"
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
  actionTimeout: 0
};
`;
}

function printHelp() {
  console.log(`OrbitTest ${packageJson.version}

Usage:
  orbittest init
  orbittest run [test-file-or-directory] [--workers N|--parallel] [--retries N] [--timeout MS]
  orbittest --version
  orbittest --help

Examples:
  orbittest init
  orbittest run
  orbittest run tests/login.test.js
`);
}

function printRunHelp() {
  console.log(`Usage:
  orbittest run [test-file-or-directory] [--workers N|--parallel]

When no path is provided, OrbitTest discovers:
  Files from orbittest.config.js, defaulting to:
  tests/**/*.test.js
  tests/**/*.spec.js

Parallel execution:
  orbittest run --workers 4
  orbittest run --parallel

Overrides:
  orbittest run --retries 2 --timeout 30000 --reports-dir reports --env staging
`);
}
