const fs = require("fs");
const path = require("path");

function initProject({ cwd = process.cwd(), logger = console } = {}) {
  const testsDir = path.join(cwd, "tests");
  const samplePath = path.join(testsDir, "example.test.js");
  const configPath = path.join(cwd, "orbittest.config.js");
  const packagePath = path.join(cwd, "package.json");
  const gitignorePath = path.join(cwd, ".gitignore");

  fs.mkdirSync(testsDir, { recursive: true });

  if (!fs.existsSync(samplePath)) {
    fs.writeFileSync(samplePath, getSampleTest());
    logger.log(`Created ${path.relative(cwd, samplePath)}`);
  } else {
    logger.log(`Kept existing ${path.relative(cwd, samplePath)}`);
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, getSampleConfig());
    logger.log(`Created ${path.relative(cwd, configPath)}`);
  } else {
    logger.log(`Kept existing ${path.relative(cwd, configPath)}`);
  }

  ensurePackageScript(packagePath, cwd, logger);
  ensureGitignoreEntry(gitignorePath, "reports/", logger);

  logger.log("\nOrbitTest is ready.");
  logger.log("Run your tests with:");
  logger.log("  orbittest run");
}

function ensurePackageScript(packagePath, cwd, logger) {
  let packageJson = {
    scripts: {}
  };

  if (fs.existsSync(packagePath)) {
    packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } else {
    packageJson.name = path.basename(cwd).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "orbittest-project";
    packageJson.version = "1.0.0";
  }

  packageJson.scripts = packageJson.scripts || {};

  if (!packageJson.scripts["test:e2e"]) {
    packageJson.scripts["test:e2e"] = "orbittest run";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    logger.log("Added npm script: test:e2e");
  }
}

function ensureGitignoreEntry(gitignorePath, entry, logger) {
  const current = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";

  const lines = current.split(/\r?\n/).filter(Boolean);

  if (!lines.includes(entry)) {
    lines.push(entry);
    fs.writeFileSync(gitignorePath, `${lines.join("\n")}\n`);
    logger.log(`Added ${entry} to .gitignore`);
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
  globalSetup: [],
  workers: 1,
  maxWorkers: 4,
  retries: 0,
  testTimeout: 30000,
  actionTimeout: 0,
  browser: {
    display: "auto"
  },
  experimental: {
    studio: true,
    visualAutomation: true,
    apiTesting: false
  },
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

module.exports = {
  initProject
};
