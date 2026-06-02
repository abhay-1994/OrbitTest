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
  use: {
    web: {
      browser: "chrome",
      headless: null
    },
    mobile: process.env.ORBITTEST_MOBILE === "1"
      ? {
        provider: "@orbittest/mobile",
        platform: "android",
        adbPath: process.env.ADB_PATH || "adb",
        deviceSerial: process.env.DEVICE_SERIAL || null,
        apk: process.env.ORBITTEST_APK || "./app.apk",
        appPackage: process.env.ORBITTEST_APP_PACKAGE || null,
        appActivity: process.env.ORBITTEST_APP_ACTIVITY || null,
        artifactsDir: "orbittest-results",
        screenshotOnFailure: true,
        logcatOnFailure: true,
        uiDumpOnFailure: true
      }
      : null
  },
  experimental: {
    ui: true,
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
