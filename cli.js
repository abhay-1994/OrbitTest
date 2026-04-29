#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Module = require("module");

const packageApiPath = path.join(__dirname, "orbit.js");
const packageJson = require("./package.json");
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveOrbitTest(request, parent, isMain, options) {
  if (request === "orbittest") {
    return packageApiPath;
  }

  return resolveFilename.call(this, request, parent, isMain, options);
};

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});

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

  const testInputs = args.filter(arg => !arg.startsWith("-"));
  const testFiles = discoverTestFiles(testInputs);

  if (testFiles.length === 0) {
    console.error("No test files found.");
    console.error("Create one with: npx orbittest init");
    console.error("Expected files like: tests/example.test.js or tests/example.spec.js");
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

  await runner.runRegisteredTests({ testFiles });
}

function initProject() {
  const cwd = process.cwd();
  const testsDir = path.join(cwd, "tests");
  const samplePath = path.join(testsDir, "example.test.js");
  const packagePath = path.join(cwd, "package.json");
  const gitignorePath = path.join(cwd, ".gitignore");

  fs.mkdirSync(testsDir, { recursive: true });

  if (!fs.existsSync(samplePath)) {
    fs.writeFileSync(samplePath, getSampleTest());
    console.log(`Created ${path.relative(cwd, samplePath)}`);
  } else {
    console.log(`Kept existing ${path.relative(cwd, samplePath)}`);
  }

  ensurePackageScript(packagePath);
  ensureGitignoreEntry(gitignorePath, "reports/");

  console.log("\nOrbitTest is ready.");
  console.log("Run your tests with:");
  console.log("  npx orbittest run");
}

function discoverTestFiles(inputs) {
  const cwd = process.cwd();
  const roots = inputs.length > 0 ? inputs : ["tests"];
  const found = [];

  for (const input of roots) {
    const resolved = path.resolve(cwd, input);

    if (!fs.existsSync(resolved)) {
      continue;
    }

    const stat = fs.statSync(resolved);

    if (stat.isDirectory()) {
      found.push(...findTestsInDirectory(resolved));
    } else if (stat.isFile() && isTestFile(resolved)) {
      found.push(resolved);
    }
  }

  return Array.from(new Set(found)).sort();
}

function findTestsInDirectory(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "reports") {
        continue;
      }

      files.push(...findTestsInDirectory(fullPath));
      continue;
    }

    if (entry.isFile() && isTestFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isTestFile(filePath) {
  return /\.(test|spec)\.js$/i.test(filePath);
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
  return `const { test, run } = require("orbittest");

test("Click Login", async (orbit) => {
  await orbit.open("https://bug-orbit.vercel.app/");
  await orbit.click("Login");
});

run();
`;
}

function printHelp() {
  console.log(`OrbitTest ${packageJson.version}

Usage:
  orbittest init
  orbittest run [test-file-or-directory]
  orbittest --version
  orbittest --help

Examples:
  npx orbittest init
  npx orbittest run
  npx orbittest run tests/login.test.js
`);
}

function printRunHelp() {
  console.log(`Usage:
  orbittest run [test-file-or-directory]

When no path is provided, OrbitTest discovers:
  tests/**/*.test.js
  tests/**/*.spec.js
`);
}
