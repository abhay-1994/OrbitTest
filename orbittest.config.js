module.exports = {
  testDir: "tests",
  testMatch: ["**/*.test.js", "**/*.spec.js"],
  reportsDir: "reports",
  globalSetup: ["tests/global-setup.js"],
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
    enabled: !process.env.CI,
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
  }
};
