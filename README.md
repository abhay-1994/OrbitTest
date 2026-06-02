# OrbitTest

[![npm version](https://img.shields.io/npm/v/orbittest.svg)](https://www.npmjs.com/package/orbittest)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Intent-first end-to-end browser testing built on Chrome DevTools Protocol.

OrbitTest lets you write tests using what users see — visible labels, roles, and text — rather than CSS selectors or XPath expressions. It handles browser lifecycle, test parallelism, retries, trace capture, structured failure reporting, and CI pipeline integration out of the box.

> Test what users see, not what developers write.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Writing Tests](#writing-tests)
- [CLI Reference](#cli-reference)
- [Environment Variables](#environment-variables)
- [Browser Actions](#browser-actions)
- [Locators](#locators)
- [Working with Elements](#working-with-elements)
- [Frames and Shadow DOM](#frames-and-shadow-dom)
- [Browser Storage and Sessions](#browser-storage-and-sessions)
- [Alerts, Notifications, and Windows](#alerts-notifications-and-windows)
- [Mobile Testing](#mobile-testing)
- [Visual Automation](#visual-automation)
- [Reports and Diagnostics](#reports-and-diagnostics)
- [CI/CD Integration](#cicd-integration)
- [UI](#ui)
- [Forge — Test Recorder](#forge--test-recorder)
- [TypeScript](#typescript)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

### Feature Status

| Feature | Status |
|---|---|
| UI automation | Stable |
| Test lifecycle hooks | Stable |
| Intent-based locator engine | Stable |
| Text readers (`text`, `visibleText`, `domText`) | Stable |
| Browser storage and session management | Stable |
| Alerts, notifications, and window/tab management | Stable |
| Frames and Shadow DOM traversal | Stable |
| HTML/JSON/JUnit reports | Stable |
| CI/CD mode (sharding, fail-fast, annotations) | Stable |
| Step trace and trace timeline | Stable |
| Smart Report (browser evidence collection) | Stable |
| UI local dashboard | Stable |
| Forge test recorder | Stable |
| Android mobile provider (`@orbittest/mobile`) | Phase 1 |
| Visual automation (canvas, WebGL, pixel checks) | Experimental |
| API testing | Planned |

### Official Project

OrbitTest is created and maintained by Abhay. Forks and modified versions are permitted under the Apache License 2.0, but must preserve copyright, license, and notice attribution and must not imply affiliation with the official project. The OrbitTest name, logo, and branding are governed by [TRADEMARKS.md](TRADEMARKS.md).

---

## Installation

Install as a project dependency:

```bash
npm install orbittest
```

Or install globally:

```bash
npm install -g orbittest
```

Verify the installation:

```bash
orbittest --version
```

**Requirements:** Node.js 18 or later. A Chromium-based browser is required at runtime. OrbitTest will use the system Chrome installation by default, or you can specify a path via `ORBITTEST_CHROME_PATH`.

---

## Quick Start

Initialize a new project:

```bash
orbittest init
```

This creates:

```
orbittest.config.js
tests/
  example.test.js
reports/
```

Write a test:

```js
const { test, expect } = require("orbittest");

test("Login flow", async (orbit) => {
  await orbit.open("https://example.com");
  await orbit.click("Login");
  await orbit.type("Email", "user@example.com");
  await orbit.type("Password", "secret");

  expect(await orbit.hasText("Dashboard")).toBe(true);
});
```

Run it:

```bash
orbittest run
```

Output:

```
Passed: 1
Failed: 0
Report: reports/runs/<run-id>/report.html
```

No CSS selectors. No XPath. No framework configuration needed for basic use.

---

## Configuration

OrbitTest reads `orbittest.config.js` from the project root. All fields are optional — the defaults work for most projects.

```js
module.exports = {
  // Test discovery
  testDir: "tests",
  testMatch: ["**/*.test.js", "**/*.spec.js"],

  // Output
  reportsDir: "reports",

  // Hooks
  globalSetup: [],

  // Parallelism
  workers: 1,
  maxWorkers: 4,

  // Retry policy
  retries: 0,

  // Timeouts (milliseconds)
  testTimeout: 30000,
  actionTimeout: 0,

  // Browser display
  browser: {
    display: "auto"  // "auto" | "show" | "hide"
  },

  // Optional web/mobile provider config
  use: {
    web: {
      browser: "chrome",
      headless: null
    },
    mobile: null
  },

  // Experimental features
  experimental: {
    ui: true,
    visualAutomation: true,
    apiTesting: false
  },

  // Local failure report server
  openReportOnFailure: {
    enabled: !process.env.CI,
    port: 0
  },

  // CI/CD mode
  ci: {
    enabled: Boolean(process.env.CI),
    retries: 1,
    trace: "on-failure",       // "always" | "on-failure" | "never"
    screenshot: "on-failure",  // "always" | "on-failure" | "never"
    failFast: false,
    maxFailures: 0,
    shard: process.env.ORBITTEST_SHARD || null,
    summary: true,
    junit: true,
    githubAnnotations: Boolean(process.env.GITHUB_ACTIONS)
  },

  // Smart Report
  smartReport: false,
  smartReportSlowRequestMs: 2000,

  // Named environments
  environments: {
    staging: {
      reportsDir: "reports/staging"
    }
  }
};
```

**Browser display** defaults to `"auto"`: the browser is visible on local runs, hidden in CI, and always visible in `--step` mode. Override for a single run with `--show-browser` or `--hide-browser`.

**Named environments** can be activated with `--env <name>`, which merges environment-specific config values over the base config.

CLI flags always override config file values.

---

## Writing Tests

### Basic test

```js
const { test, expect } = require("orbittest");

test("Home page loads", async (orbit) => {
  await orbit.open("https://example.com");

  expect(await orbit.hasText("Example Domain")).toBe(true);
});
```

### Test options

```js
test("Slow flow", { retries: 2, timeout: 60000 }, async (orbit) => {
  await orbit.open("https://example.com");
});
```

### Lifecycle hooks

Hooks run at the run level or around each test. They receive run info or test info from OrbitTest.

```js
const { beforeAll, afterAll, beforeEach, afterEach, test } = require("orbittest");

beforeAll(async (runInfo) => {
  console.log(`Run started: ${runInfo.runId}`);
});

beforeEach(async (orbit, testInfo) => {
  console.log(`Starting: ${testInfo.name}, attempt ${testInfo.attempt}`);
});

afterEach(async (orbit, testInfo) => {
  if (testInfo.status === "failed") {
    await orbit.screenshot(`reports/${testInfo.name}.png`);
  }
});

afterAll(async (runInfo) => {
  console.log(`Run finished: ${runInfo.status}`);
});
```

`testInfo` fields: `name`, `file`, `index`, `attempt`, `retry`, `retries`, `timeout`, `status`, `startedAt`, `endedAt`, `durationMs`, `error`, `artifacts`.

### Global setup file

Use `globalSetup` to place shared hooks in a single file:

```js
// orbittest.config.js
module.exports = {
  globalSetup: "tests/setup.js"
};
```

```js
// tests/setup.js
const { beforeAll, afterAll, beforeEach, afterEach } = require("orbittest");

beforeAll(async (runInfo) => {
  // runs once before all tests in the suite
});

beforeEach(async (orbit, testInfo) => {
  // runs before each test
});

afterEach(async (orbit, testInfo) => {
  // runs after each test
});

afterAll(async (runInfo) => {
  // runs once after all tests complete
});
```

Test files do not need an explicit `run()` call when invoked through the CLI.

---

## CLI Reference

### Commands

| Command | Description |
|---|---|
| `orbittest run [files]` | Run tests |
| `orbittest init` | Initialize a new project |
| `orbittest ui` | Open the local UI dashboard |
| `orbittest forge [url]` | Open the Forge test recorder |
| `orbittest clean-reports` | Remove old report runs |

### `orbittest run` flags

| Flag | Description |
|---|---|
| `--workers <n>` | Number of parallel workers |
| `--retries <n>` | Retry count per test |
| `--timeout <ms>` | Test timeout in milliseconds |
| `--env <name>` | Activate a named environment from config |
| `--reports-dir <path>` | Override the reports output directory |
| `--ci` | Enable CI mode |
| `--fail-fast` | Stop after the first test failure |
| `--max-failures <n>` | Stop after N test failures |
| `--shard <n/total>` | Run a shard of the test suite (e.g. `1/4`) |
| `--github-annotations` | Emit GitHub Actions annotation format on failure |
| `--trace` | Capture a step-by-step trace |
| `--smart-report` | Capture browser evidence for failure diagnosis |
| `--step` | Live step-by-step debugging with the Orbit Inspector |
| `--show-browser` | Force the browser to be visible |
| `--hide-browser` | Force the browser to be hidden |
| `--verbose` | Print OrbitTest's internal browser/action logs |
| `--no-open-report-on-failure` | Suppress the local failure report server |
| `--report-port <port>` | Set a fixed port for the local report server |

### `orbittest clean-reports` flags

| Flag | Description |
|---|---|
| `--dry-run` | Preview what would be removed without deleting |
| `--passed <n>` | Number of passed runs to keep (default: 10) |
| `--failed <n>` | Number of failed runs to keep (default: 30) |
| `--max-age-days <n>` | Remove runs older than N days (default: 30) |

### `orbittest ui` flags

| Flag | Description |
|---|---|
| `--port <n>` | Port for the UI server |
| `--no-open` | Start UI without opening a browser tab |
| `--reports-dir <path>` | Reports directory to browse |

### `orbittest forge` flags

| Flag | Description |
|---|---|
| `--output <path>` | Write the recorded script to a file |

---

## Environment Variables

| Variable | Description |
|---|---|
| `ORBITTEST_CHROME_PATH` | Path to a custom Chrome/Chromium executable |
| `ORBITTEST_SHARD` | Shard assignment in `<n>/<total>` format (e.g. `1/4`) |
| `ORBITTEST_UI_EVENTS` | Internal: enables SSE event stream for the UI |
| `ORBITTEST_STEP_AUTO_CONTINUE` | Internal: auto-continue in step mode |
| `CI` | Standard CI flag; enables headless browser and CI mode defaults |
| `GITHUB_ACTIONS` | Standard GitHub Actions flag; enables GitHub annotation output |

---

## Browser Actions

### Navigation

```js
await orbit.open("https://example.com");
```

### Clicks

```js
await orbit.click("Login");
await orbit.doubleClick("Open");
await orbit.rightClick("File");
await orbit.hover("Menu");
```

Click actions render a brief red dot at the actual click coordinate, making live debugging and trace screenshots easier to follow. Disable the marker for a single action:

```js
await orbit.click("Login", { visualize: false });
```

### Typing

```js
await orbit.type("Email", "user@example.com");
```

OrbitTest resolves the target input by label, placeholder, `name` attribute, or accessible text.

### Text assertions

```js
const present = await orbit.hasText("Welcome");
```

### Screenshots

```js
await orbit.screenshot("reports/home.png");
```

### Waiting

```js
await orbit.waitForText("Dashboard");
await orbit.waitForText("Dashboard", { timeout: 10000 });

await orbit.waitFor(orbit.css(".toast"));
await orbit.waitFor(orbit.css(".toast"), { timeout: 5000 });
```

Prefer `waitFor` and `waitForText` over fixed delays. Fixed delays are fragile on slow machines and in CI.

```js
await orbit.wait(1000); // use only when no event-based alternative exists
```

### Page state

```js
const title = await orbit.title();
const url = await orbit.url();

const page = await orbit.pageState();
expect(page.title).toContain("Dashboard");
expect(page.url).toContain("example.com");
```

### JavaScript evaluation

```js
const value = await orbit.evaluate(() => document.title);
await orbit.evaluate((text) => console.log(text), "hello");
```

---

## Locators

OrbitTest is intent-first: most actions accept a visible text string and resolve the target automatically. Use explicit locators when the text-based resolution is ambiguous or when you need to target a specific structural element.

| Locator | Usage |
|---|---|
| Text string | `await orbit.click("Login")` |
| CSS selector | `await orbit.click(orbit.css("#login-btn"))` |
| XPath | `await orbit.click(orbit.xpath("//button[text()='Login']"))` |
| Role | `await orbit.click(orbit.getByRole("button", "Login"))` |
| Attribute | `await orbit.click(orbit.getByAttribute("data-testid", "submit"))` |
| Object literal | `await orbit.click({ css: "#login" })` |

---

## Working with Elements

### Existence check

```js
expect(await orbit.exists(orbit.css(".success"))).toBe(true);
expect(await orbit.exists(orbit.css(".error"), { timeout: 0 })).toBe(false);
```

### Reading text

Three helpers cover different use cases:

| Helper | Returns | Hidden content |
|---|---|---|
| `orbit.text(locator)` | User-facing text: DOM text, form values, ARIA label, `title`, `alt` | May include useful ARIA sources |
| `orbit.visibleText(locator)` | Rendered visible text only | Excluded |
| `orbit.domText(locator)` | Full DOM text from the element tree | Included |

```js
const label = await orbit.visibleText(orbit.css("#save-button"));
expect(label).toBe("Save");

const domContent = await orbit.domText(orbit.css("#server-message"));
expect(domContent).toContain("Hidden diagnostic id");
```

All text readers trim and normalize whitespace.

### Collections

Use `orbit.all()` when a locator matches multiple elements:

```js
const buttons = await orbit.all(orbit.css("button"));

for (const button of buttons) {
  if (button.visible) {
    await orbit.click(button);
  }
}
```

Each item in the returned array is a reusable locator snapshot with `tag`, `text`, `visible`, and `attributes` fields:

```js
{
  type: "nth",
  locator: { type: "css", selector: "button" },
  index: 0,
  tag: "button",
  text: "Add to cart",
  visible: true,
  attributes: { id: "add", "data-testid": "add-button" }
}
```

Supported actions on collection items: `click`, `hover`, `doubleClick`, `rightClick`, `type`, `exists`, `waitFor`, `text`, `visibleText`, `domText`.

If clicking an item removes or reorders elements, re-fetch the collection before the next interaction:

```js
while (await orbit.exists(orbit.css(".delete"), { timeout: 0 })) {
  const deleteButtons = await orbit.all(orbit.css(".delete"));
  await orbit.click(deleteButtons[0]);
}
```

`orbit.elements()` is an alias for `orbit.all()`.

---

## Frames and Shadow DOM

### iFrames

`orbit.frame()` returns a scoped frame object with the same intent-first API:

```js
const billing = await orbit.frame(orbit.getByAttribute("title", "Billing"));

await billing.type("Email", "team@example.test");
await billing.click("Save billing");
expect(await billing.exists("Saved")).toBe(true);
```

Nested frames can be resolved step by step or as a path:

```js
// Step by step
const checkout = await orbit.frame(orbit.getByAttribute("title", "Checkout"));
const vault = await checkout.frame(orbit.getByAttribute("title", "Vault"));

// As a path
const vault = await orbit.frame([
  orbit.getByAttribute("title", "Checkout"),
  orbit.getByAttribute("title", "Vault")
]);
```

For short-lived frame scopes:

```js
await orbit.withFrame(orbit.css("iframe.payment"), async (frame) => {
  await frame.click("Pay");
});
```

### Shadow DOM

`orbit.shadow()` works with both open and closed shadow roots:

```js
const profile = await orbit.shadow(orbit.css("user-profile"));

await profile.type("Email", "team@example.test");
await profile.click("Save");
expect(await profile.text(orbit.css("#status"))).toBe("Saved");
```

Nested shadow roots can be chained or resolved as a path:

```js
// Step by step
const shell = await orbit.shadow(orbit.css("app-shell"));
const panel = await shell.shadow(orbit.css("settings-panel"));

// As a path
const panel = await orbit.shadow([
  orbit.css("app-shell"),
  orbit.css("settings-panel")
]);
```

For short-lived shadow scopes:

```js
await orbit.withShadow(orbit.css("confirm-card"), async (shadow) => {
  await shadow.click("Confirm");
});
```

---

## Browser Storage and Sessions

OrbitTest starts each test with a clean browser profile. Use `orbit.storage` when a test needs explicit cookies, `localStorage`, `sessionStorage`, or a persisted login state.

### Cookies

```js
await orbit.storage.setCookie({ name: "session", value: "abc123", httpOnly: true, secure: true });
await orbit.storage.setCookie("theme", "dark");

const cookies = await orbit.storage.cookies();
await orbit.storage.deleteCookie("session");
await orbit.storage.clearCookies();
```

### Local and session storage

```js
await orbit.storage.setLocal("token", "abc123");
const token = await orbit.storage.getLocal("token");
await orbit.storage.removeLocal("token");
await orbit.storage.clearLocal();

await orbit.storage.setSession("view", "compact");
const view = await orbit.storage.getSession("view");
await orbit.storage.removeSession("view");
await orbit.storage.clearSession();
```

Storage values follow browser behavior and are stored as strings.

### Save and restore login state

```js
// Save after login
await orbit.open("https://example.com/login");
await orbit.type("Email", "user@example.com");
await orbit.type("Password", "secret");
await orbit.click("Login");
await orbit.waitForText("Dashboard");
await orbit.storage.saveSession("auth/session.json");

// Restore in a later test
await orbit.open("https://example.com");
await orbit.storage.loadSession("auth/session.json");
await orbit.open("https://example.com/dashboard");
expect(await orbit.hasText("Dashboard")).toBe(true);
```

`saveSession()` captures cookies, current-origin `localStorage`, and current-origin `sessionStorage`. `HttpOnly` cookies are supported via CDP.

### Session health

`expectHealthySession()` fails a test early when a saved session is missing, expired, or about to expire:

```js
await orbit.storage.loadSession("auth/admin-session.json");
await orbit.storage.expectHealthySession({ minMinutes: 15, requireCookie: true });
await orbit.open("https://example.com/admin");
```

`inspect()` provides a safe summary of the current browser state with redacted values:

```js
const state = await orbit.storage.inspect();
console.log(state.auth.present);
console.log(state.auth.signalCount);
console.log(state.cookies.authLikeCount);
console.log(state.recommendations);
```

### Full storage API

```js
orbit.storage.cookies()
orbit.storage.setCookie(cookieOrName, value?)
orbit.storage.setCookies(cookieArray)
orbit.storage.deleteCookie(name)
orbit.storage.clearCookies()

orbit.storage.local()
orbit.storage.getLocal(key)
orbit.storage.setLocal(key, value)
orbit.storage.removeLocal(key)
orbit.storage.clearLocal()

orbit.storage.session()
orbit.storage.getSession(key)
orbit.storage.setSession(key, value)
orbit.storage.removeSession(key)
orbit.storage.clearSession()

orbit.storage.saveSession(path)
orbit.storage.loadSession(path)
orbit.storage.clear()

orbit.storage.inspect()
orbit.storage.health()
orbit.storage.expectHealthySession(options?)
orbit.storage.expectSession()
```

---

## Alerts, Notifications, and Windows

### JavaScript dialogs

```js
await orbit.open("https://example.com");
await orbit.click("Trigger Alert");

expect(await orbit.alertText()).toBe("hello");
await orbit.acceptAlert();

await orbit.acceptAlert({ promptText: "Abhay" });  // for prompt dialogs
await orbit.dismissAlert();                         // for confirm dialogs
```

`waitForAlert()` returns dialog details: `type`, `message`, `url`, `handled`.

### Browser notifications

```js
await orbit.grantNotifications();
expect(await orbit.getNotificationPermission()).toBe("granted");

await orbit.denyNotifications("https://example.com");
expect(await orbit.getNotificationPermission()).toBe("denied");

await orbit.resetNotificationPermission();
```

Pass an origin string or `{ origin }` to target a specific site.

### Windows and tabs

```js
const windows = await orbit.listWindows();
const main = windows.find((w) => w.active);

await orbit.click("Open report");
const popup = await orbit.waitForWindow({ switchTo: true });

expect(await orbit.hasText("Report")).toBe(true);

await orbit.switchToWindow(0);          // by index
await orbit.switchToWindow(main.id);    // by target ID
await orbit.closeWindow(popup.id);
```

Windows can be selected by index, target ID, URL/title text, regular expression, or predicate function. `newWindow(url)` opens a new tab and switches to it by default.

---

## Mobile Testing

OrbitTest keeps mobile support in a separate provider package so the main web runner stays small and stable.

```bash
npm install orbittest @orbittest/mobile
```

Android requirements:

- Android SDK platform tools installed
- USB debugging enabled on the device
- `adb devices` shows the device as `device`
- OrbitTest Desktop may inject `DEVICE_SERIAL`, `ADB_PATH`, and `PROJECT_ROOT`

Configure mobile in `orbittest.config.js`:

```js
module.exports = {
  use: {
    mobile: {
      provider: "@orbittest/mobile",
      platform: "android",
      adbPath: process.env.ADB_PATH || "adb",
      deviceSerial: process.env.DEVICE_SERIAL,
      apk: "./app.apk",
      appPackage: "com.myapp",
      appActivity: ".MainActivity",
      artifactsDir: "orbittest-results",
      screenshotOnFailure: true,
      logcatOnFailure: true,
      uiDumpOnFailure: true
    }
  }
};
```

Write a mobile test:

```js
const { test, expect } = require("orbittest");

test("mobile smoke test", async ({ orbit }) => {
  await orbit.wakeUp();
  await orbit.installApp();
  await orbit.launchApp();
  await orbit.waitForText("Login", 10000);
  await expect(orbit).toHaveText("Login");
});
```

Hybrid web + mobile tests use both contexts:

```js
test("same user works on web and mobile", async ({ page, orbit }) => {
  await page.goto("https://app.example.com");
  await page.clickText("Create account");

  await orbit.installApp();
  await orbit.launchApp();
  await orbit.waitForText("Welcome");
});
```

Useful commands:

```bash
orbittest devices
orbittest doctor
orbittest run tests/mobile-smoke.test.js
```

`@orbittest/mobile` uses ADB and UIAutomator directly. It does not use Appium, WebdriverIO, Detox, Maestro, or Playwright mobile. Mobile test reports include a Mobile Evidence section with device/app details, screenshot preview, UIAutomator summary, and artifact links. On failed mobile tests, OrbitTest asks the provider to save screenshot, UI dump, logcat, error, and result artifacts under `orbittest-results`.

Troubleshooting:

- If a device is `unauthorized`, unlock it and accept the USB debugging prompt.
- If UIAutomator dump fails, verify the screen is awake and no system permission dialog is blocking the app.
- If Desktop runs tests, confirm it passes `DEVICE_SERIAL`, `ADB_PATH`, and `PROJECT_ROOT` to the child Node.js process.

---

## Visual Automation

Use visual automation when an application renders pixels rather than standard HTML elements — canvas games, WebGL scenes, maps, charts, remote desktops, or custom UI frameworks.

```js
expect(await orbit.exists(orbit.css("canvas"))).toBe(true);

const changed = await orbit.visual.changed(async () => {
  await orbit.evaluate(() => window.app.update());
});

expect(changed).toBe(true);
```

### Coordinate actions

```js
await orbit.mouse.click(680, 450);
await orbit.mouse.drag({ x: 680, y: 450 }, { x: 760, y: 360 });
await orbit.mouse.wheel(0, -500);
```

### Visual checks

```js
await orbit.visual.snapshot("reports/state.png");
await orbit.visual.expectPixel({ x: 30, y: 30 }, "#ff0000", { tolerance: 5 });
await orbit.visual.waitForStable();
await orbit.visual.expectChanged(async () => { /* action */ });

const point = await orbit.visual.findColor("#df1f1f", { tolerance: 70 });
await orbit.visual.clickColor("#df1f1f", { tolerance: 70 });

const pixel = await orbit.visual.pixel({ x: 100, y: 100 });
```

Visual automation is experimental. The API is stable but coverage of edge cases may be limited.

---

## Reports and Diagnostics

### Output structure

Every run produces:

```
reports/
  latest.html
  latest.json
  latest-summary.json
  latest-junit.xml
  runs/
    <run-id>/
      report.html
      report.json
      summary.json
      junit.xml
      artifacts/
        screenshots/
        traces/
```

### Report contents

- Total tests, pass/fail/flaky/skip counts, and duration
- Failure diagnostics with likely cause and recommended next actions
- Inline failure screenshot
- Error message and stack trace
- Source code frame for the failing line
- Trace timeline (when `--trace` is used)
- Smart browser evidence (when `--smart-report` is used)
- Mobile evidence for Android tests: device details, app context, screenshots, UI dumps, and logcat links on failure

### Trace

`--trace` captures a step-by-step timeline for every test:

```bash
orbittest run tests/login.test.js --trace
```

The HTML report includes a Trace Timeline showing every `orbit.*` step with status, duration, URL, title, and screenshot links. Raw trace files are written to `reports/runs/<run-id>/artifacts/traces/`.

### Smart Report

`--smart-report` captures browser evidence for failure diagnosis:

```bash
orbittest run tests/login.test.js --smart-report
```

Smart Report collects console errors, JavaScript exceptions, failed network requests, slow requests, and recent navigation events. If it detects a clear application failure (failed API request, unauthorized response, client-side crash), it marks the test failed even without an explicit assertion.

### Step mode

`--step` opens the Orbit Inspector for live debugging:

```bash
orbittest run tests/login.test.js --step
```

Step mode runs with one worker, disables all timeouts, pauses before each `orbit.*` action, and keeps the browser open. A trace is written automatically. Click actions display a red dot at the exact coordinate.

### Failure report server

On failed local runs, OrbitTest starts a local report server and opens the report in your browser automatically. Disable for one run:

```bash
orbittest run --no-open-report-on-failure
orbittest run --report-port 9323  # fixed port
```

### Report retention

Preview what would be removed:

```bash
orbittest clean-reports --dry-run
```

Remove old reports:

```bash
orbittest clean-reports
orbittest clean-reports --passed 20 --failed 50 --max-age-days 60
```

Default retention: 1 latest run, 10 passed runs, 30 failed runs, maximum age 30 days.

---

## CI/CD Integration

Enable CI mode with `--ci`:

```bash
orbittest run --ci --workers 4
```

CI mode suppresses the local report server, captures traces and screenshots only on failure by default, and writes machine-readable output files.

### Sharding

Split a suite across parallel jobs:

```bash
orbittest run --ci --shard 1/4
orbittest run --ci --shard 2/4
orbittest run --ci --shard 3/4
orbittest run --ci --shard 4/4
```

Each job receives a disjoint slice of the registered test list. Skipped shards are reflected in `summary.json`, `junit.xml`, and the HTML report.

### Failure control

```bash
orbittest run --ci --fail-fast           # stop after the first failure
orbittest run --ci --max-failures 3      # stop after three failures
```

### Flaky detection

When a test fails on the first attempt and passes on a retry, OrbitTest marks it `flaky`, preserves the failure evidence, and exits with success unless another test fails. Flaky tests are reported in all output formats.

### GitHub Actions annotations

```bash
orbittest run --ci --github-annotations
```

Emits failure annotations in GitHub Actions format, pointing to the failing source line.

### Example GitHub Actions workflow

```yaml
name: e2e

on:
  pull_request:
  push:
    branches: [main]

jobs:
  orbittest:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - shard: 1/2
            artifact: shard-1
          - shard: 2/2
            artifact: shard-2
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx orbittest run --ci --workers 2 --shard ${{ matrix.shard }} --github-annotations
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: orbittest-report-${{ matrix.artifact }}
          path: reports/
```

---

## UI

OrbitTest UI is a local web dashboard for day-to-day test work:

```bash
orbittest ui
orbittest ui --port 9323
orbittest ui --no-open
orbittest ui --reports-dir reports/staging
```

OrbitTest UI provides:

- Run all tests or a single test file
- Run presets: Local, Evidence (with Smart Report), CI mode
- Live command preview before launching
- Toggle trace, Smart Report, CI mode, and headless/headed browser
- Live streaming command output
- Filter test files and reports
- Browse previous run reports
- Open HTML, JSON, and JUnit artifacts inline
- Inline failure messages without navigating folders

---

## Forge — Test Recorder

Forge opens a recorder panel alongside a fresh browser window. It records your interactions and generates an OrbitTest script.

```bash
orbittest forge
orbittest forge https://example.com
orbittest forge https://example.com --output tests/login.test.js
```

By default, Forge copies the script to the clipboard only. Pass `--output` to write a file. Press `Ctrl+C` in the terminal to stop and print the script.

Forge captures: clicks, double-clicks, right-clicks, typing (without passwords or token-like values), select changes, visible checks, navigation, and stable locators (role, text, attribute, fallback CSS).

Generated scripts are plain OrbitTest files:

```js
const { test, expect } = require("orbittest");

test("Login flow", async (orbit) => {
  await orbit.open("https://example.com");
  await orbit.click("Login");
  await orbit.type("Email", "user@example.com");
  await orbit.type("Password", process.env.ORBITTEST_PASSWORD || "");
  expect(await orbit.exists(orbit.getByRole("heading", "Dashboard"))).toBe(true);
});
```

---

## TypeScript

OrbitTest ships TypeScript type definitions in `index.d.ts`. Import types directly in `.ts` files or use them in JSDoc:

```ts
import { test, expect } from "orbittest";
```

```js
// @ts-check
const { test, expect } = require("orbittest");
```

Type definitions cover `test`, `expect`, lifecycle hooks, `orbit.*` actions, locator types, `testInfo`, and `runInfo`.

---

## Best Practices

**Use intent-based actions by default.** They are readable, resilient to markup changes, and match what users actually see.

```js
await orbit.click("Login");         // preferred
await orbit.click("#login-btn");    // use when text-based resolution is ambiguous
```

**Wait for state, not time.** Fixed delays fail on slow machines and are invisible in traces.

```js
await orbit.waitForText("Dashboard");     // preferred
await orbit.waitFor(orbit.css(".ready")); // preferred
await orbit.wait(2000);                   // avoid
```

**Scope frame and shadow interactions.** Use `withFrame()` and `withShadow()` for single-action scopes to avoid leaving dangling frame references.

**Restore session state explicitly.** OrbitTest starts each test with a clean browser. If your test suite needs a logged-in state, use `saveSession` / `loadSession` rather than repeating the login flow.

**Use `--smart-report` in CI.** Smart Report provides network and console evidence that makes failures understandable without manual browser reproduction.

**Keep assertions close to actions.** Assert on the result of each significant step rather than batching assertions at the end of a test.

---

## Troubleshooting

### Element not found

The element may not be visible yet or the text does not match exactly. Add a `waitFor` before interacting and verify the visible text in the running browser.

```js
await orbit.waitFor(orbit.css(".modal"));
await orbit.click("Confirm");
```

### Multiple elements match

Use a more specific locator to disambiguate.

```js
await orbit.click(orbit.getByRole("button", "Submit"));
await orbit.click(orbit.getByAttribute("data-testid", "submit-form"));
```

### Timeout exceeded

Increase the timeout on the specific action or globally in config.

```js
await orbit.waitForText("Dashboard", { timeout: 15000 });
```

```js
// orbittest.config.js
module.exports = { testTimeout: 60000 };
```

### Content inside a frame or shadow root

OrbitTest actions target the top-level page by default. Use `orbit.frame()` or `orbit.shadow()` to scope actions to embedded content.

### Custom Chrome path

```bash
# Windows
set ORBITTEST_CHROME_PATH=C:\Path\To\chrome.exe
orbittest run

# macOS / Linux
ORBITTEST_CHROME_PATH=/path/to/chrome orbittest run
```

---

## Contributing

Contributions are welcome. Please review the guidelines below before opening a pull request.

### Prerequisites

- Node.js 18 or later
- All changes must pass the existing test suite

### Workflow

1. Fork the repository and create a branch from `master`.
2. Branch naming: `feat/<short-description>`, `fix/<short-description>`, or `chore/<short-description>`.
3. Make your changes. Do not introduce new dependencies without prior discussion.
4. Run the test suite and confirm all tests pass:
   ```bash
   node --test tests/
   ```
5. Open a pull request against `master`. Include a clear description of what changed and why.

### Code standards

- Plain JavaScript (CommonJS modules), Node.js 18 compatible.
- No transpilation, no build step.
- New modules must have a single, clearly named responsibility.
- Prefer explicit, readable code over clever abstractions.
- Tests for new behavior are expected unless the change is purely cosmetic.

### Security

To report a security vulnerability, open a private security advisory on GitHub or contact the maintainer directly. Do not file public issues for security reports.

---

## License

Apache License 2.0

Copyright 2026 Abhay. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [TRADEMARKS.md](TRADEMARKS.md).
