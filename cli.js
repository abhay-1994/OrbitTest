#!/usr/bin/env node

const path = require("path");
const Module = require("module");
const { spawn } = require("child_process");

const packageApiPath = path.join(__dirname, "orbit.js");
const packageJson = require("./package.json");
const resolveFilename = Module._resolveFilename;
const packageApi = require("./orbit");
const {
  discoverTestFiles,
  loadConfig,
  mergeCiOptions,
  mergeOpenReportOnFailureOptions,
  parseShardValue,
  resolveBrowserDisplay,
  resolveRetries,
  resolveScreenshotMode,
  resolveTraceMode
} = require("./core/config");
const { initProject } = require("./core/scaffold");

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

  if (command === "studio" || command === "ui") {
    await studioCommand(args.slice(1));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function studioCommand(args) {
  if (args.includes("-h") || args.includes("--help")) {
    printStudioHelp();
    return;
  }

  const studioArgs = parseStudioArgs(args);
  validateStudioArgs(studioArgs);

  const { startStudioServer } = require("./runner/studio-server");
  const studio = await startStudioServer({
    root: process.cwd(),
    host: studioArgs.host || "127.0.0.1",
    port: studioArgs.port !== null ? Number(studioArgs.port) : 9323,
    reportsDir: studioArgs.reportsDir || null
  });

  console.log("\nOrbitTest Studio");
  console.log("----------------");
  console.log(`URL: ${studio.url}`);
  console.log(`Project: ${studio.root}`);
  console.log(`Reports: ${path.relative(process.cwd(), studio.reportsDir) || "."}`);
  console.log("Press Ctrl+C to stop.");

  let stoppingStudio = false;
  const stopStudio = async signal => {
    if (stoppingStudio) {
      return;
    }

    stoppingStudio = true;
    console.log("\nStopping OrbitTest Studio...");

    try {
      await studio.close();
      console.log("OrbitTest Studio stopped.");
    } catch (error) {
      console.error(`Failed to stop OrbitTest Studio cleanly: ${error.message || error}`);
    }

    if (signal) {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => {
    stopStudio("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopStudio("SIGTERM");
  });

  if (studioArgs.openBrowser) {
    openUrlInDefaultBrowser(studio.url);
  }
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

  await loadGlobalSetupFiles(config.globalSetup, config);

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
  const browserDisplay = resolveBrowserDisplay(runArgs, config, ciOptions);

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
    globalSetup: config.globalSetup,
    browserDisplay,
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

async function loadGlobalSetupFiles(globalSetup, config) {
  const setupFiles = Array.isArray(globalSetup)
    ? globalSetup
    : globalSetup
      ? [globalSetup]
      : [];

  for (const setupFile of setupFiles) {
    const resolved = path.resolve(process.cwd(), setupFile);

    try {
      const setupModule = require(resolved);
      const setupFn = typeof setupModule === "function"
        ? setupModule
        : setupModule && typeof setupModule.default === "function"
          ? setupModule.default
          : null;

      if (setupFn) {
        await setupFn({
          root: process.cwd(),
          config,
          file: resolved
        });
      }
    } catch (error) {
      throw new Error(`Failed to load globalSetup "${setupFile}": ${error.message || error}`);
    }
  }
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

function parseStudioArgs(args) {
  const parsed = {
    host: null,
    port: null,
    reportsDir: null,
    openBrowser: true,
    unknownArgs: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--no-open") {
      parsed.openBrowser = false;
      continue;
    }

    if (arg === "--open") {
      parsed.openBrowser = true;
      continue;
    }

    if (arg === "--host") {
      parsed.host = readOptionValue(args, i, "--host");
      i++;
      continue;
    }

    if (arg.startsWith("--host=")) {
      parsed.host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      parsed.port = readOptionValue(args, i, "--port");
      i++;
      continue;
    }

    if (arg.startsWith("--port=")) {
      parsed.port = arg.slice("--port=".length);
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

    parsed.unknownArgs.push(arg);
  }

  return parsed;
}

function validateStudioArgs(args) {
  if (args.unknownArgs.length > 0) {
    throw new Error(`Unknown studio option: ${args.unknownArgs[0]}`);
  }

  if (args.port !== null) {
    validatePortArg(args.port, "--port");
  }

  if (args.host !== null && !String(args.host).trim()) {
    throw new Error("--host requires a non-empty value.");
  }

  if (args.reportsDir !== null && !String(args.reportsDir).trim()) {
    throw new Error("--reports-dir requires a non-empty value.");
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
    browserDisplay: null,
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

    if (arg === "--show-browser") {
      parsed.browserDisplay = "show";
      continue;
    }

    if (arg === "--hide-browser") {
      parsed.browserDisplay = "hide";
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

  if (args.step && args.browserDisplay === "hide") {
    throw new Error("--hide-browser cannot be used with --step because step mode needs a visible browser.");
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

function openUrlInDefaultBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32"
    ? "cmd"
    : platform === "darwin"
      ? "open"
      : "xdg-open";
  const args = platform === "win32"
    ? ["/c", "start", "", url]
    : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();
}

function printHelp() {
  console.log(`OrbitTest ${packageJson.version}

Usage:
  orbittest init
  orbittest run [test-file-or-directory] [--workers N|--parallel] [--retries N] [--timeout MS] [--trace] [--ci] [--show-browser|--hide-browser]
  orbittest studio [--port N] [--host HOST] [--no-open]
  orbittest clean-reports [--dry-run] [--passed N] [--failed N] [--max-age-days N]
  orbittest --version
  orbittest --help

Examples:
  orbittest init
  orbittest run
  orbittest run tests/login.test.js --trace
  orbittest run tests/login.test.js --step
  orbittest run tests/login.test.js --smart-report
  orbittest run tests/login.test.js --hide-browser
  orbittest run --ci --workers 4 --shard 1/4
  orbittest run --ci --github-annotations
  orbittest studio
  orbittest clean-reports --dry-run
`);
}

function printRunHelp() {
  console.log(`Usage:
  orbittest run [test-file-or-directory] [--workers N|--parallel] [--trace] [--step] [--smart-report] [--verbose] [--show-browser|--hide-browser]
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
  orbittest run tests/login.test.js --show-browser
  orbittest run tests/login.test.js --hide-browser
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

function printStudioHelp() {
  console.log(`Usage:
  orbittest studio [--port N] [--host HOST] [--reports-dir DIR] [--no-open]
  orbittest ui [--port N] [--host HOST] [--reports-dir DIR] [--no-open]

OrbitTest Studio starts a local dashboard for running tests, reading reports,
and inspecting recent failures.

Examples:
  orbittest studio
  orbittest studio --port 9323
  orbittest studio --no-open
  orbittest ui --reports-dir reports/staging
`);
}
