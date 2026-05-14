# 🚀 OrbitTest

[![npm version](https://img.shields.io/npm/v/orbittest.svg)](https://www.npmjs.com/package/orbittest)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

**Intent-based browser automation testing made simple**

OrbitTest is a lightweight end-to-end testing tool that lets you write tests using **what users see** instead of complex selectors.

---

# ⚡ Quick Example

```js
const { test, expect } = require("orbittest");

test("Login flow", async (orbit) => {
  await orbit.open("https://example.com");
  await orbit.click("Login");
  await orbit.type("Email", "user@example.com");

  expect(await orbit.hasText("Dashboard")).toBe(true);
});
```

👉 No CSS
👉 No XPath
👉 Just intent

---

# 🎯 Why OrbitTest?

OrbitTest focuses on simplicity and readability.

Instead of writing:

```js
await orbit.click("#login-btn");
```

You can write:

```js
await orbit.click("Login");
```

### Benefits

* ✔ Faster test creation
* ✔ Less maintenance
* ✔ Human-readable tests
* ✔ Works with modern UI

---

# 🧭 Feature Status

* Stable: UI automation, lifecycle hooks, locator engine, reports, CI/CD, Smart Report, Studio/UI, browser display controls, browser storage/session state
* Experimental: visual automation
* Future: API automation

OrbitTest is currently in an architecture cleanup freeze. New large features are paused while internals are being organized into clearer modules.

---

# 📦 Installation


```bash
npm install 
npm install -g orbittest
```

Check installation:

```bash
orbittest --version
```

---

# 🚀 Getting Started

## Initialize project

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

---

## Run tests

```bash
orbittest run
```

Normal runs keep the console clean. OrbitTest prints your own `console.log()` output, then only the pass count, fail count, and report path:

```txt
Passed: 1
Failed: 0
Report: reports/runs/<run-id>/report.html
```

Use `--verbose` when you want OrbitTest's internal browser/action logs:

```bash
orbittest run tests/login.test.js --verbose
```

Or:

```bash
npm run test:e2e
```

---

# 🧪 Writing Tests

```js
const { test, expect } = require("orbittest");

test("Home page loads", async (orbit) => {
  await orbit.open("https://example.com");

  expect(await orbit.hasText("Example Domain")).toBe(true);
});
```

Run-level hooks, test-level hooks, global setup, and per-test options are supported:

```js
const { beforeAll, afterAll, beforeEach, afterEach, test } = require("orbittest");

beforeAll(async (runInfo) => {
  console.log(`Run started: ${runInfo.runId}`);
});

beforeEach(async (orbit, testInfo) => {
  console.log(`Starting ${testInfo.name}, attempt ${testInfo.attempt}`);
});

afterEach(async (orbit, testInfo) => {
  console.log(`Finished ${testInfo.name}: ${testInfo.status}`);
});

afterAll(async (runInfo) => {
  console.log(`Run finished: ${runInfo.status}`);
});

test("retry a slow flow", { retries: 1, timeout: 30000 }, async (orbit, testInfo) => {
  await orbit.open("https://example.com");
});
```

Use `globalSetup` when you want shared framework hooks in one file:

```js
module.exports = {
  globalSetup: "tests/setup.js"
};
```

`tests/setup.js`:

```js
const { beforeAll, afterAll, beforeEach, afterEach } = require("orbittest");

beforeAll(async (runInfo) => {
  console.log(`Starting run ${runInfo.runId}`);
});

beforeEach(async (orbit, testInfo) => {
  console.log(`Starting ${testInfo.name}`);
});

afterEach(async (orbit, testInfo) => {
  if (testInfo.status === "failed") {
    await orbit.screenshot(`reports/${testInfo.name}.png`);
  }
});

afterAll(async (runInfo) => {
  console.log(`Completed ${runInfo.results.length} results`);
});
```

`testInfo` includes `name`, `file`, `index`, `attempt`, `retry`, `retries`, `timeout`, `status`, `startedAt`, `endedAt`, `durationMs`, `error`, and `artifacts`.

---

# 🌐 Browser Actions

# Configuration

OrbitTest reads `orbittest.config.js` from your project root:

```js
module.exports = {
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
  },
  smartReport: false,
  smartReportSlowRequestMs: 2000,
  environments: {
    staging: {
      reportsDir: "reports/staging"
    }
  }
};
```

CLI flags override config values, for example `orbittest run --workers 2 --retries 1 --timeout 30000 --env staging`.

Browser display defaults to `"auto"`: local runs show the browser, CI runs hide it, and `--step` always uses a visible browser. Override it for one run with:

```bash
orbittest run --show-browser
orbittest run --hide-browser
```

When a run fails locally, OrbitTest starts a small report server on `127.0.0.1`, opens the failed run report in your browser, and auto-stops the server later. Use `--no-open-report-on-failure` to turn it off for one run, or `--report-port 9323` when you want a fixed port.

Test files are run by the CLI, so you do not need `run()` in each test file.

## OrbitTest Studio

Start the local dashboard:

```bash
orbittest studio
```

Or use the alias:

```bash
orbittest ui
```

Studio opens a local web app for day-to-day test work:

* Run all tests or a single test file
* Use Local, Evidence, and CI run presets
* Preview the exact command before launching
* Toggle trace, Smart Report, CI mode, and hidden browser runs
* Watch live command output
* Filter test files and reports
* Browse previous reports
* Open HTML, JSON, and JUnit artifacts
* See failed test messages without digging through folders

Useful options:

```bash
orbittest studio --port 9323
orbittest studio --no-open
orbittest studio --reports-dir reports/staging
```

## CI/CD mode

Use `--ci` in pipelines:

```bash
orbittest run --ci --workers 4
```

CI mode keeps local-only behavior out of the pipeline. It does not open the failure report server, it captures traces only when a test fails by default, and it writes machine-readable files for dashboards and build systems:

```txt
reports/runs/<run-id>/report.html
reports/runs/<run-id>/report.json
reports/runs/<run-id>/summary.json
reports/runs/<run-id>/junit.xml
reports/latest.html
reports/latest.json
reports/latest-summary.json
reports/latest-junit.xml
```

Useful CI flags:

```bash
orbittest run --ci --fail-fast
orbittest run --ci --max-failures 3
orbittest run --ci --shard 1/4
orbittest run --ci --github-annotations
```

`--shard current/total` splits registered tests by index, so four CI jobs can run `1/4`, `2/4`, `3/4`, and `4/4`. `--fail-fast` stops scheduling new tests after the first failure. `--max-failures 3` stops scheduling after three failed tests. Skipped tests are still shown in `summary.json`, `junit.xml`, and the HTML report.

Retries are CI-aware. If a test fails once and later passes, OrbitTest marks it as `flaky`, keeps the failed attempt evidence, and still exits successfully unless another test fails. This makes unstable tests visible without hiding real build failures.

Example GitHub Actions job:

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

## Open a page

```js
await orbit.open("https://example.com");
```

---

## Click by visible text

```js
await orbit.click("Login");
```

---

## Mouse actions

```js
await orbit.hover("Menu");
await orbit.doubleClick("Open");
await orbit.rightClick("File");
```

Click actions show a short red dot at the actual browser coordinate. This makes live debugging and trace screenshots easier to follow.

```js
await orbit.click("Login");
await orbit.doubleClick("Open");
await orbit.rightClick("File");
```

Disable the marker for a single action when needed:

```js
await orbit.click("Login", { visualize: false });
```

---

## Type into input

```js
await orbit.type("Email", "user@example.com");
```

Matches using:

* label
* placeholder
* name
* accessible text

---

## Check visible text

```js
const exists = await orbit.hasText("Welcome");
```

---

## Take screenshot

```js
await orbit.screenshot("reports/home.png");
```

---

# Visual Automation For Canvas, WebGL, And Custom UI

Use visual automation when an app renders pixels instead of normal HTML elements, such as canvas games, WebGL scenes, maps, charts, remote desktops, or custom UI frameworks.

```js
await orbit.open("https://www.pinthing.com/");

expect(await orbit.exists(orbit.css("canvas"))).toBe(true);

await orbit.evaluate(() => window.pinthing.down());

const changed = await orbit.visual.changed(async () => {
  await orbit.evaluate(() => window.pinthing.up());
});

expect(changed).toBe(true);
```

Coordinate actions:

```js
await orbit.mouse.click(680, 450);
await orbit.mouse.drag({ x: 680, y: 450 }, { x: 760, y: 360 });
await orbit.mouse.wheel(0, -500);
```

Visual checks:

```js
await orbit.visual.snapshot("reports/state.png");
await orbit.visual.expectPixel({ x: 30, y: 30 }, "#ff0000", { tolerance: 5 });

const redObject = await orbit.visual.findColor("#df1f1f", { tolerance: 70 });
await orbit.visual.clickColor("#df1f1f", { tolerance: 70 });
```

Useful methods:

```js
await orbit.evaluate(() => window.app.doSomething());
await orbit.visual.waitForStable();
await orbit.visual.changed(async () => {});
await orbit.visual.expectChanged(async () => {});
await orbit.visual.findColor("#155eef");
await orbit.visual.clickColor("#155eef");
await orbit.visual.pixel({ x: 100, y: 100 });
```

---

# Browser Storage And Sessions

OrbitTest starts each test with a clean browser profile by default. Use `orbit.storage` when a test needs explicit cookies, `localStorage`, `sessionStorage`, or a saved login state.

## Cookies

```js
await orbit.open("https://example.com");

await orbit.storage.setCookie({
  name: "session",
  value: "abc123",
  httpOnly: true,
  secure: true
});

const cookies = await orbit.storage.cookies();
console.log(cookies);

await orbit.storage.deleteCookie("session");
await orbit.storage.clearCookies();
```

You can also pass a name/value pair:

```js
await orbit.storage.setCookie("theme", "dark");
```

## Local and session storage

```js
await orbit.storage.setLocal("token", "local-token");
expect(await orbit.storage.getLocal("token")).toBe("local-token");

await orbit.storage.setSession("view", "compact");
expect(await orbit.storage.getSession("view")).toBe("compact");

const local = await orbit.storage.local();
const session = await orbit.storage.session();

await orbit.storage.removeLocal("token");
await orbit.storage.clearSession();
```

Storage values follow browser behavior, so values are stored as strings.

## Save and load login state

Use `saveSession()` after login, then `loadSession()` in later tests.

```js
await orbit.open("https://example.com/login");
await orbit.type("Email", "user@example.com");
await orbit.type("Password", "secret");
await orbit.click("Login");
await orbit.waitForText("Dashboard");

await orbit.storage.saveSession("auth/session.json");
```

Reuse it:

```js
await orbit.open("https://example.com");
await orbit.storage.loadSession("auth/session.json");
await orbit.open("https://example.com/dashboard");

expect(await orbit.hasText("Dashboard")).toBe(true);
```

`saveSession()` stores cookies, current-origin `localStorage`, and current-origin `sessionStorage`. Cookies are applied through Chrome DevTools Protocol, so `HttpOnly` cookies are supported.

## Storage Intelligence

Use `inspect()` when you want a safe summary of the current browser state without printing secrets:

```js
const state = await orbit.storage.inspect();

console.log(state.auth.present);
console.log(state.auth.signalCount);
console.log(state.cookies.authLikeCount);
console.log(state.recommendations);
```

`inspect()` redacts cookie and storage values by default, detects auth-like keys such as `session`, `token`, `accessToken`, and `refreshToken`, and understands JWT expiry when a token is present.

Use `expectHealthySession()` to fail early when a saved login is missing, expired, or about to expire:

```js
await orbit.storage.loadSession("auth/admin-session.json");

await orbit.storage.expectHealthySession({
  minMinutes: 15,
  requireCookie: true
});

await orbit.open("https://example.com/admin");
```

This is useful in CI because the test fails with a direct session-health message instead of failing later on a random protected page.

Useful methods:

```js
await orbit.storage.cookies();
await orbit.storage.setCookie({ name: "session", value: "abc123" });
await orbit.storage.setCookies([{ name: "a", value: "1" }]);
await orbit.storage.deleteCookie("session");
await orbit.storage.clearCookies();

await orbit.storage.local();
await orbit.storage.getLocal("token");
await orbit.storage.setLocal("token", "abc123");
await orbit.storage.removeLocal("token");
await orbit.storage.clearLocal();

await orbit.storage.session();
await orbit.storage.getSession("view");
await orbit.storage.setSession("view", "compact");
await orbit.storage.removeSession("view");
await orbit.storage.clearSession();

await orbit.storage.saveSession("auth/session.json");
await orbit.storage.loadSession("auth/session.json");
await orbit.storage.clear();

await orbit.storage.inspect();
await orbit.storage.health();
await orbit.storage.expectHealthySession();
await orbit.storage.expectSession();
```

---

# Alerts, Notifications, And Windows

## JavaScript alerts, confirms, and prompts

```js
await orbit.open("data:text/html,<button onclick='alert(\"hello\")'>Alert</button>");
await orbit.click("Alert");

expect(await orbit.alertText()).toBe("hello");
await orbit.acceptAlert();
```

Use `dismissAlert()` for confirm dialogs and pass `promptText` for prompts:

```js
await orbit.acceptAlert({ promptText: "Abhay" });
await orbit.dismissAlert();
```

`waitForAlert()` returns dialog details such as `type`, `message`, `url`, and `handled`.

## Notifications

```js
await orbit.open("https://example.com");
await orbit.grantNotifications();
expect(await orbit.getNotificationPermission()).toBe("granted");

await orbit.denyNotifications("https://example.com");
expect(await orbit.getNotificationPermission()).toBe("denied");

await orbit.resetNotificationPermission();
```

Notification helpers use Chrome DevTools permission overrides for the active browser context. Pass an origin string or `{ origin }` when you need to target a specific site.

## Windows and tabs

```js
const main = (await orbit.listWindows()).find(window => window.active);

await orbit.click("Open report");
const popup = await orbit.waitForWindow({ switchTo: true });

expect(await orbit.hasText("Report")).toBe(true);

await orbit.switchToWindow(0);
await orbit.switchToWindow(main.id);
await orbit.closeWindow(popup.id);
```

You can select windows by index, target id, URL/title text, regular expression, or predicate function. `newWindow(url)` opens a new tab and switches to it by default.

---

# ⏳ Waiting for Page Changes

Modern apps update dynamically. Use waits before interacting.

## Wait for text

```js
await orbit.waitForText("Dashboard");
```

---

## Wait for element

```js
await orbit.waitFor(orbit.css(".toast"));
```

---

## Custom timeout

```js
await orbit.waitForText("Dashboard", { timeout: 10000 });
```

---

## Avoid fixed waits

```js
await orbit.wait(1000); // avoid when possible
```

Prefer:

```js
await orbit.waitFor("Dashboard");
```

---

# 🎯 Locators (When Needed)

OrbitTest is **intent-first**, but supports locators for precision.

---

## CSS

```js
await orbit.click(orbit.css("#login"));
```

---

## XPath

```js
await orbit.click(orbit.xpath("//button[text()='Login']"));
```

---

## Role

```js
await orbit.click(orbit.getByRole("button", "Login"));
```

---

## Attribute

```js
await orbit.click(orbit.getByAttribute("data-testid", "submit"));
```

---

## Direct object

```js
await orbit.click({ css: "#login" });
```

---

👉 Use text-based actions by default
👉 Use locators when needed

---

# 🔍 Working with Elements

## Read page title and URL

```js
const title = await orbit.title();
const url = await orbit.url();

console.log(title);
console.log(url);
```

Use `pageState()` when you want both values together:

```js
const page = await orbit.pageState();

expect(page.title).toContain("BrowserStack");
expect(page.url).toContain("bstackdemo.com");
```

These helpers read the active browser page, so call them after `orbit.open()` or after the action that changes the page.

---

## Check if element exists

```js
expect(await orbit.exists(orbit.css(".success"))).toBe(true);
```

---

## Read element text

```js
const title = await orbit.text(orbit.getByRole("heading", "Dashboard"));
```

---

## Work with all matching elements

Use `orbit.all()` when one locator matches multiple elements and you want to store them in an array.

```js
const buttons = await orbit.all(orbit.css("button"));

for (const button of buttons) {
  await orbit.click(button);
}
```

`orbit.elements()` is an alias for the same feature:

```js
const items = await orbit.elements(orbit.css(".todo-item"));
```

Call `orbit.all()` with no locator to collect every element on the page:

```js
const elements = await orbit.all();
```

Each array item is a reusable locator snapshot. You can pass it to the existing OrbitTest methods:

```js
const links = await orbit.all(orbit.css("a"));

for (const link of links) {
  const label = await orbit.text(link);

  if (label.includes("Docs")) {
    await orbit.click(link);
    break;
  }
}
```

Supported actions/checks with returned items:

```js
await orbit.click(item);
await orbit.hover(item);
await orbit.doubleClick(item);
await orbit.rightClick(item);
await orbit.type(item, "hello");
await orbit.exists(item);
await orbit.waitFor(item);
await orbit.text(item);
```

The returned item also includes useful snapshot information:

```js
const buttons = await orbit.all(orbit.css("button"));
const firstButton = buttons[0];

console.log(firstButton.tag);
console.log(firstButton.text);
console.log(firstButton.visible);
console.log(firstButton.attributes);
```

Example returned item:

```js
{
  type: "nth",
  locator: { type: "css", selector: "button" },
  index: 0,
  tag: "button",
  text: "Add to cart",
  visible: true,
  attributes: {
    id: "add",
    "data-testid": "add-button"
  }
}
```

### Example: read all product names

```js
const products = await orbit.all(orbit.css(".shelf-item__title"));
const names = [];

for (const product of products) {
  names.push(product.text);
}

expect(names.includes("iPhone 12")).toBe(true);
```

### Example: click every visible button

```js
const buttons = await orbit.all(orbit.css("button"));

for (const button of buttons) {
  if (!button.visible) {
    continue;
  }

  await orbit.click(button);
}
```

### Example: filter by attribute

```js
const rows = await orbit.all(orbit.css("[data-status]"));

for (const row of rows) {
  if (row.attributes["data-status"] === "pending") {
    await orbit.click(row);
  }
}
```

### Example: remove dynamic items safely

Returned locators are index-based snapshots. If clicking an item removes or reorders elements, fetch the list again before the next click.

```js
while (await orbit.exists(orbit.css(".delete"), { timeout: 0 })) {
  const deleteButtons = await orbit.all(orbit.css(".delete"));

  await orbit.click(deleteButtons[0]);
}
```

### Locator examples

```js
await orbit.all(orbit.css("button"));
await orbit.all(orbit.xpath("//button"));
await orbit.all(orbit.getByRole("button"));
await orbit.all(orbit.getByAttribute("data-testid", "menu-item"));
await orbit.all("Add to cart");
```

Prefer CSS, role, or attribute locators for lists. Text locators can match parent elements as well as child elements when the same text appears in multiple places.

---

# 📊 Reports

After each run:

```
reports/latest.html
reports/latest.json
reports/latest-summary.json
reports/latest-junit.xml
reports/runs/<run-id>/report.html
reports/runs/<run-id>/report.json
reports/runs/<run-id>/summary.json
reports/runs/<run-id>/junit.xml
reports/runs/<run-id>/artifacts/
```

On failed local runs, OrbitTest also opens the current run report on a local URL like:

```txt
http://127.0.0.1:<port>/
```

Disable it for one run:

```bash
orbittest run tests/login.test.js --no-open-report-on-failure
```

---

## Includes

* Total tests
* Passed / Failed / Flaky / Skipped
* Duration
* CI-ready `summary.json` and `junit.xml`
* Failure diagnostics with likely cause and next actions
* Inline failure screenshot
* Error details and stack trace
* Source code frame for the failing line
* Embedded trace timeline when `--trace` is used
* Smart browser evidence when `--smart-report` is used

---

## Step trace

Use `--trace` when you want a step-by-step report after the run:

```bash
orbittest run tests/login.test.js --trace
```

The HTML report includes a Trace Timeline section when `--trace` is used. It shows every captured `orbit.*` step, assertion failures, status, duration, URL/title, failed step details, and links to step screenshots. Full trace files are still stored under:

```txt
reports/runs/<run-id>/artifacts/traces/
```

Use `--smart-report` when you want OrbitTest to capture browser evidence for failure diagnosis:

```bash
orbittest run tests/login.test.js --smart-report
```

Smart reports capture console errors, page JavaScript errors, failed requests, slow requests, recent navigation, and the current page URL. This helps the report explain failures like API errors, client-side crashes, or pages still waiting on slow network calls.

If Smart Report detects a clear application failure such as a failed API request, invalid credentials, unauthorized access, or a serious browser error, OrbitTest marks the test failed even if the script did not include an assertion after the action.

Use `--step` when you want live, step-by-step debugging:

```bash
orbittest run tests/login.test.js --step
```

Step mode opens a small Orbit Inspector window in OrbitTest's managed testing browser, not your default browser. It runs with one worker, disables test/action timeouts, pauses before each `orbit.*` action, and keeps the browser open until you continue at the end. It also writes a trace automatically.

Click actions are marked with a red dot in the test browser, so you can see exactly where OrbitTest clicked while stepping through the test.

---

## Failure screenshots

```
reports/runs/<run-id>/artifacts/
```

---

## Clean old reports

Use a dry run first to see what OrbitTest will remove:

```bash
orbittest clean-reports --dry-run
```

Then clean old reports:

```bash
orbittest clean-reports
```

By default, OrbitTest keeps the latest report, the last 10 passed runs, the last 30 failed runs, and removes reports older than 30 days. You can override that:

```bash
orbittest clean-reports --passed 20 --failed 50 --max-age-days 60
```

---

# 🧠 Best Practices

* Prefer intent-based actions:

  ```js
  await orbit.click("Login");
  ```

* Wait before interacting:

  ```js
  await orbit.waitFor("Dashboard");
  ```

* Use locators only when needed

* Avoid fixed delays

---

# ⚠️ Common Issues

### Element not found

→ Ensure text is visible
→ Use `waitFor()` before clicking

---

### Multiple matches

→ Use locator for precision

---

### Slow page

→ Increase timeout

```js
await orbit.waitForText("Dashboard", 10000);
```

---

# 🔍 Test Discovery

OrbitTest automatically finds:

```
tests/**/*.test.js
tests/**/*.spec.js
```

---

# 🖥️ CLI Usage

Run all tests:

```bash
orbittest run
```

Run specific file:

```bash
orbittest run tests/login.test.js
```

Run folder:

```bash
orbittest run tests
```

Run in parallel:

```bash
orbittest run --workers 4
```

Or set workers in `orbittest.config.js`.

Create a step-by-step trace:

```bash
orbittest run tests/login.test.js --trace
```

Create an intelligent failure report:

```bash
orbittest run tests/login.test.js --smart-report
```

Live step debugging:

```bash
orbittest run tests/login.test.js --step
```

Override config from the CLI:

```bash
orbittest run --retries 2 --timeout 30000 --reports-dir reports/debug
```

Run in CI:

```bash
orbittest run --ci --workers 4
orbittest run --ci --shard 1/4
orbittest run --ci --fail-fast
orbittest run --ci --max-failures 3
```

Control browser display:

```bash
orbittest run --show-browser
orbittest run --hide-browser
```

Open Studio:

```bash
orbittest studio
orbittest ui --no-open
```

---

# 🌍 Browser Behavior

* Fresh browser per test
* No cookies or cache by default
* No extensions
* Fully isolated environment
* Local runs show the browser by default
* CI runs hide the browser by default
* Cookies and browser storage can be restored explicitly with `orbit.storage`

---

# ⚙️ Custom Browser

```bash
set ORBITTEST_CHROME_PATH=C:\Path\To\chrome.exe
orbittest run
```

---

# 🚧 Current Limitations

* Limited smart matching
* Basic wait system

---

# 🚀 Roadmap

* Smart element detection
* Improved wait system
* Smart browser display profiles
* Richer CI integrations

---

# 🧠 Philosophy

> Test what users see, not what developers write.

---

# 🤝 Contributing

Contributions are welcome.

1. Fork
2. Create branch
3. Submit PR

---

# 📄 License

Apache-2.0

## Keywords

browser automation, testing, e2e, test runner, Chrome, CDP
