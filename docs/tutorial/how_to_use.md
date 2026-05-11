# How to Use OrbitTest

This tutorial shows how to install OrbitTest, create a test, use browser actions, use locators, wait for page changes, and read reports.

## Requirements

OrbitTest needs:

- Node.js 18 or newer
- npm
- A project where you want to run browser tests

OrbitTest uses Puppeteer's managed Chrome by default. During install, Puppeteer can download a compatible browser for you.

## Install OrbitTest

Install OrbitTest globally:

```bash
npm install -g orbittest
```

Check that the CLI is available:

```bash
orbittest --version
```

## Create a Test Project

Run the init command:

```bash
orbittest init
```

This creates a starter test folder and adds a test script when possible:

```txt
orbittest.config.js
tests/
  example.test.js
reports/
```

The npm script usually looks like this:

```json
{
  "scripts": {
    "test:e2e": "orbittest run"
  }
}
```

## Run Tests

Run all discovered tests:

```bash
orbittest run
```

Normal local runs keep the console clean. OrbitTest prints your own `console.log()` output, then only the result counts and report path:

```txt
Passed: 5
Failed: 0
Report: reports/runs/<run-id>/report.html
```

Or use the npm script:

```bash
npm run test:e2e
```

Run one file:

```bash
orbittest run tests/login.test.js
```

Run all tests inside a folder:

```bash
orbittest run tests
```

OrbitTest discovers files like:

```txt
tests/**/*.test.js
tests/**/*.spec.js
```

You can change this in `orbittest.config.js`:

```js
module.exports = {
  testDir: "tests",
  testMatch: ["**/*.test.js", "**/*.spec.js"],
  reportsDir: "reports",
  workers: 1,
  maxWorkers: 4,
  retries: 0,
  testTimeout: 30000,
  actionTimeout: 0,
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

Run tests in parallel from the CLI:

```bash
orbittest run --workers 4
```

You can also set `workers` in `orbittest.config.js`.

CLI flags override config values:

```bash
orbittest run --workers 2 --retries 1 --timeout 30000 --env staging
```

Use `--verbose` only when you want OrbitTest internal browser/action logs:

```bash
orbittest run tests/login.test.js --verbose
```

## CI/CD Mode

Use `--ci` when OrbitTest runs inside GitHub Actions, Jenkins, GitLab CI, Azure DevOps, or any other pipeline:

```bash
orbittest run --ci
```

CI mode is built for automation:

- It does not open the local failure report server.
- It prints a CI summary with pass, fail, flaky, skipped, duration, and report paths.
- It writes `summary.json` for dashboards and custom scripts.
- It writes `junit.xml` for CI test report publishers.
- It captures trace files only when a test fails by default.
- It marks a retried test as `flaky` when it fails first and later passes.

Example CI output:

```txt
OrbitTest CI Summary
--------------------
Status: PASSED
Total: 5
Passed: 5
Flaky: 0
Failed: 0
Skipped: 0
Duration: 28.42s
Report: reports/runs/<run-id>/report.html
Summary: reports/runs/<run-id>/summary.json
JUnit: reports/runs/<run-id>/junit.xml
```

### Run CI with retries

Config-based retry:

```js
module.exports = {
  retries: 0,
  ci: {
    enabled: Boolean(process.env.CI),
    retries: 1
  }
};
```

CLI-based retry:

```bash
orbittest run --ci --retries 2
```

If a test passes only after retry, the run can still pass, but the result is marked as `flaky` in the HTML report, `report.json`, and `summary.json`.

### Stop early on failures

Stop scheduling new tests after the first failure:

```bash
orbittest run --ci --fail-fast
```

Stop scheduling new tests after three failed tests:

```bash
orbittest run --ci --max-failures 3
```

Tests that were not scheduled because of the stop condition are reported as `skipped`, so the CI summary still explains what happened.

### Split tests across CI jobs

Use sharding when one pipeline should run multiple OrbitTest jobs in parallel:

```bash
orbittest run --ci --shard 1/4
orbittest run --ci --shard 2/4
orbittest run --ci --shard 3/4
orbittest run --ci --shard 4/4
```

`--shard current/total` splits registered tests by index. Every shard writes its own HTML, JSON, summary, and JUnit files.

You can also set the shard from an environment variable:

```powershell
$env:ORBITTEST_SHARD = "1/2"
orbittest run --ci
```

### GitHub Actions annotations

Use annotations when you want failures to appear directly in the GitHub Actions log and pull request UI:

```bash
orbittest run --ci --github-annotations
```

Failed tests are printed as GitHub `error` annotations. Flaky tests are printed as `warning` annotations.

### Working GitHub Actions example

Create `.github/workflows/e2e.yml`:

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

This workflow runs two shards, keeps both reports as downloadable artifacts, and still uploads reports when tests fail.

## Write Your First Test

Create `tests/home.test.js`:

```js
const { test, expect } = require("orbittest");

test("home page loads", async (orbit) => {
  await orbit.open("https://example.com/");

  expect(await orbit.hasText("Example Domain")).toBe(true);
});
```

Use hooks and per-test options when a flow needs setup, cleanup, retries, or a longer timeout:

```js
const { beforeEach, afterEach, test } = require("orbittest");

beforeEach(async (orbit, testInfo) => {
  console.log(`Starting ${testInfo.name}`);
});

afterEach(async (orbit, testInfo) => {
  console.log(`Finished ${testInfo.name}`);
});

test("checkout", { retries: 1, timeout: 30000 }, async (orbit) => {
  await orbit.open("https://example.com/checkout");
});
```

Run it:

```bash
orbittest run tests/home.test.js
```

## Basic Browser Actions

Each test receives an `orbit` object.

Open a page:

```js
await orbit.open("https://example.com/");
```

Click by visible text:

```js
await orbit.click("Login");
```

Use mouse interactions:

```js
await orbit.hover("Menu");
await orbit.doubleClick("Open");
await orbit.rightClick("File");
```

Click actions show a short red dot at the exact browser coordinate before the click is sent. This applies to `click()`, `doubleClick()`, and `rightClick()`, so it is visible while using `--step` and it appears in trace screenshots when the page stays on the same screen long enough.

```js
await orbit.click("Login");
await orbit.doubleClick("Open");
await orbit.rightClick("File");
```

If a test needs no visual marker for a specific action, pass `visualize: false`:

```js
await orbit.click("Login", { visualize: false });
```

Type into an input by label, placeholder, name, or accessible text:

```js
await orbit.type("Email", "user@example.com");
```

Check page text:

```js
expect(await orbit.hasText("Welcome")).toBe(true);
```

Take a screenshot:

```js
await orbit.screenshot("reports/home.png");
```

## Handle Alerts, Notifications, And Windows

Accept an alert:

```js
await orbit.open("data:text/html,<button onclick='alert(\"hello\")'>Alert</button>");
await orbit.click("Alert");

expect(await orbit.alertText()).toBe("hello");
await orbit.acceptAlert();
```

Handle prompts and confirms:

```js
await orbit.click("Ask name");
await orbit.acceptAlert({ promptText: "Abhay" });

await orbit.click("Delete");
await orbit.dismissAlert();
```

Notification permissions can be overridden for the current origin or for an explicit origin:

```js
await orbit.open("https://example.com");
await orbit.grantNotifications();
expect(await orbit.getNotificationPermission()).toBe("granted");

await orbit.denyNotifications("https://example.com");
expect(await orbit.getNotificationPermission()).toBe("denied");

await orbit.resetNotificationPermission();
```

Work with tabs and popups:

```js
const main = (await orbit.listWindows()).find(window => window.active);

await orbit.click("Open details");
const popup = await orbit.waitForWindow({ switchTo: true });

expect(await orbit.hasText("Details")).toBe(true);

await orbit.switchToWindow(0);
await orbit.switchToWindow(main.id);
await orbit.closeWindow(popup.id);
```

`switchToWindow()` and `closeWindow()` accept an index, target id, URL/title text, regular expression, or predicate. `newWindow(url)` opens a new tab and switches to it unless you pass `{ switchTo: false }`.

## Use Locators

Text actions are simple, but OrbitTest also supports explicit locators.

### CSS Selector

```js
await orbit.click(orbit.css("#login"));
await orbit.type(orbit.css("input[name='email']"), "user@example.com");
```

### XPath

```js
await orbit.click(orbit.xpath("//button[text()='Login']"));
await orbit.waitFor(orbit.xpath("//h1[contains(text(), 'Dashboard')]"));
```

### Role

Use role locators for accessible elements:

```js
await orbit.click(orbit.getByRole("button", "Login"));
await orbit.click(orbit.getByRole("link", "Docs"));
expect(await orbit.text(orbit.getByRole("heading", "Welcome"))).toContain("Welcome");
```

### Attribute

Use attribute locators for `data-testid`, `name`, `aria-label`, or custom attributes:

```js
await orbit.click(orbit.getByAttribute("data-testid", "submit"));
await orbit.type(orbit.getByAttribute("name", "email"), "user@example.com");
```

### Locator Objects

You can pass locator objects directly:

```js
await orbit.click({ css: "#login" });
await orbit.click({ xpath: "//button" });
await orbit.click({ role: "button", name: "Login" });
await orbit.click({ attribute: "data-testid", value: "submit" });
```

## Check Elements

Check whether a locator exists and is visible:

```js
expect(await orbit.exists(orbit.css(".success"))).toBe(true);
```

Read visible text from a locator:

```js
const title = await orbit.text(orbit.getByRole("heading", "Dashboard"));
expect(title).toContain("Dashboard");
```

Read the current page title and URL:

```js
const title = await orbit.title();
const url = await orbit.url();

expect(title).toContain("Dashboard");
expect(url).toContain("/dashboard");
```

Use `pageState()` when you want both values together:

```js
const page = await orbit.pageState();

expect(page.title).toContain("Dashboard");
expect(page.url).toContain("/dashboard");
```

## Work With All Matching Elements

Use `orbit.all()` when one locator matches multiple elements and you want an array.

```js
const buttons = await orbit.all(orbit.css("button"));

for (const button of buttons) {
  console.log(button.text);
}
```

`orbit.elements()` is an alias:

```js
const products = await orbit.elements(orbit.css(".product-title"));
```

Each returned item is a reusable locator snapshot. You can pass it back to actions and checks:

```js
const products = await orbit.all(orbit.css(".product-title"));

for (const product of products) {
  const name = await orbit.text(product);

  if (name.includes("iPhone")) {
    await orbit.click(product);
    break;
  }
}
```

Returned items also contain snapshot details:

```js
const items = await orbit.all(orbit.css(".product-title"));
const first = items[0];

console.log(first.tag);
console.log(first.text);
console.log(first.visible);
console.log(first.attributes);
```

### Working example: read and click a list

Create `tests/list.test.js`:

```js
const { test, expect } = require("orbittest");

test("read and click all products", async (orbit) => {
  const html = `
    <main>
      <h1>Products</h1>
      <button class="product" data-id="alpha">Alpha Phone</button>
      <button class="product" data-id="beta">Beta Watch</button>
      <button class="product" data-id="gamma">Gamma Laptop</button>
      <script>
        const clicked = [];

        document.querySelectorAll(".product").forEach(button => {
          button.addEventListener("click", () => {
            clicked.push(button.getAttribute("data-id"));
            document.body.setAttribute("data-clicked", clicked.join(","));
          });
        });
      </script>
    </main>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const products = await orbit.all(orbit.css(".product"));
  const names = [];

  for (const product of products) {
    names.push(await orbit.text(product));
    await orbit.click(product);
  }

  expect(products.length).toBe(3);
  expect(names.join(",")).toBe("Alpha Phone,Beta Watch,Gamma Laptop");
  expect(await orbit.exists(orbit.getByAttribute("data-clicked", "alpha,beta,gamma"))).toBe(true);
});
```

Run it:

```bash
orbittest run tests/list.test.js
```

If clicking an item removes or reorders elements, fetch the list again before the next click:

```js
while (await orbit.exists(orbit.css(".delete"), { timeout: 0 })) {
  const deleteButtons = await orbit.all(orbit.css(".delete"));

  await orbit.click(deleteButtons[0]);
}
```

## Wait for Page Changes

Modern pages often update after navigation. Use waits before interacting with elements that appear later.

Wait for text:

```js
await orbit.waitForText("Dashboard");
```

Set a custom timeout:

```js
await orbit.waitForText("Dashboard", { timeout: 10000, interval: 200 });
```

You can also pass the timeout directly:

```js
await orbit.waitForText("Dashboard", 10000);
```

Wait for any locator:

```js
await orbit.waitFor(orbit.css(".toast"));
await orbit.waitFor(orbit.getByRole("button", "Save"));
await orbit.waitFor(orbit.getByAttribute("data-testid", "ready"));
```

Wait for a fixed time when you truly need a pause:

```js
await orbit.wait(500);
```

Prefer `waitFor()` or `waitForText()` over fixed waits because they finish as soon as the page is ready.

## Full Example

```js
const { test, expect } = require("orbittest");

test("login flow", async (orbit) => {
  await orbit.open("https://example.com/login");

  await orbit.type(orbit.getByAttribute("name", "email"), "user@example.com");
  await orbit.type(orbit.getByAttribute("name", "password"), "secret");
  await orbit.click(orbit.getByRole("button", "Login"));

  await orbit.waitForText("Dashboard", { timeout: 10000 });

  expect(await orbit.hasText("Dashboard")).toBe(true);
  expect(await orbit.exists(orbit.css(".account-menu"))).toBe(true);
});
```

## Reports

After a run, OrbitTest writes:

```txt
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

Use each file like this:

- `report.html`: the human-readable dashboard.
- `report.json`: full run data, including results, errors, artifacts, traces, and smart evidence.
- `summary.json`: compact CI-friendly summary for scripts and dashboards.
- `junit.xml`: CI test report format for GitHub, Jenkins, GitLab, Azure DevOps, and other systems.
- `latest.*`: shortcuts to the newest run.

When a test fails, OrbitTest also stores screenshots under:

```txt
reports/runs/<run-id>/artifacts/
```

For local failures, OrbitTest can automatically start a small report server and open the failed report in your browser:

```txt
http://127.0.0.1:<port>/
```

This is enabled by default outside CI when `openReportOnFailure.enabled` is true. Disable it for one run:

```bash
orbittest run tests/login.test.js --no-open-report-on-failure
```

Use a fixed port when you want a predictable URL:

```bash
orbittest run tests/login.test.js --report-port 9323
```

Open the HTML report in a browser to inspect:

- Total tests
- Passed tests
- Failed tests
- Flaky tests
- Skipped tests
- Duration
- Failure diagnostics with likely cause and next actions
- Inline failure screenshot
- Error details and stack trace
- Source code frame for the failing line
- Embedded trace timeline when `--trace` is used
- Smart browser evidence when `--smart-report` is used

To inspect a run step by step after it finishes, add `--trace`:

```bash
orbittest run tests/login.test.js --trace
```

The main HTML report includes a Trace Timeline section when `--trace` is used. It shows captured `orbit.*` steps, assertion failures, status, duration, URL/title, failed step details, and links to step screenshots. Full trace files are stored under:

```txt
reports/runs/<run-id>/artifacts/traces/
```

For smarter failure diagnosis, add `--smart-report`:

```bash
orbittest run tests/login.test.js --smart-report
```

Smart reports capture console errors, page JavaScript errors, failed requests, slow requests, recent navigation, and the current page URL. This helps you understand whether a failed assertion was caused by an API problem, a client-side crash, or a page that was still waiting on network activity.

When Smart Report finds a clear application failure such as invalid credentials, unauthorized access, failed API calls, or serious browser errors, OrbitTest marks the test failed even if the script itself did not assert after the action.

### Read the CI summary from a script

Because `summary.json` is compact, it is easy to use in a custom pipeline step:

```js
const fs = require("fs");

const summary = JSON.parse(fs.readFileSync("reports/latest-summary.json", "utf8"));

console.log(`OrbitTest status: ${summary.status}`);
console.log(`Passed: ${summary.summary.passed}`);
console.log(`Failed: ${summary.summary.failed}`);
console.log(`Flaky: ${summary.summary.flaky}`);
console.log(`Report: ${summary.reportPaths.html}`);

if (summary.status !== "passed") {
  process.exit(1);
}
```

To clean older reports, first preview the cleanup:

```bash
orbittest clean-reports --dry-run
```

Then remove the old reports:

```bash
orbittest clean-reports
```

The default cleanup keeps the latest report, the last 10 passed runs, the last 30 failed runs, and removes reports older than 30 days. You can change those limits:

```bash
orbittest clean-reports --passed 20 --failed 50 --max-age-days 60
```

For live debugging, use `--step`:

```bash
orbittest run tests/login.test.js --step
```

Step mode opens a small Orbit Inspector window in OrbitTest's managed testing browser, not your default browser. It runs with one worker, disables timeouts, pauses before each `orbit.*` action, and leaves the browser open at the end until you continue.

During `--step`, every click action is marked in the test browser with a red dot. This helps you confirm that OrbitTest clicked the point you expected before moving to the next action.

Use the inspector controls this way:

- `Step`: run the next highlighted action, then pause again.
- `Resume`: continue running without pausing on each action.
- `Stop`: stop the current debug run.

Use `--trace` when you want evidence after a run finishes. Use `--step` when you want to watch and control the run live.

Useful debugging commands:

```bash
# Live debugging
orbittest run tests/login.test.js --step

# Save step screenshots and metadata
orbittest run tests/login.test.js --trace

# Capture browser-side evidence in the report
orbittest run tests/login.test.js --smart-report

# Debug all tests in a folder
orbittest run tests --step
```

## Browser Selection

OrbitTest looks for Chrome in this order:

1. Puppeteer's managed Chrome
2. `ORBITTEST_CHROME_PATH`
3. A local system Chrome or Chromium

Use a custom browser path in PowerShell:

```powershell
$env:ORBITTEST_CHROME_PATH = "C:\Path\To\chrome.exe"
orbittest run
```

## Skip Browser Download

If you want Puppeteer to skip downloading Chrome during install:

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm install -g orbittest
```

On PowerShell:

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD = "1"
npm install -g orbittest
```

If you skip the download, make sure Chrome is installed locally or set `ORBITTEST_CHROME_PATH`.

## Troubleshooting

If no tests are found:

```bash
orbittest init
orbittest run
```

If Chrome does not launch:

```bash
npm install
```

If an element is not found, try a more specific locator:

```js
await orbit.click(orbit.css("[data-testid='submit']"));
```

If a page updates slowly, wait for the element before clicking:

```js
await orbit.waitFor(orbit.getByRole("button", "Continue"));
await orbit.click(orbit.getByRole("button", "Continue"));
```

If a test works locally but fails in automation, check:

- Node.js version
- Chrome availability
- Environment variables
- Network access to the tested site
- Report screenshots

## Local Development

If you are developing OrbitTest itself:

```bash
npm install
npm test
npm pack --dry-run
```
