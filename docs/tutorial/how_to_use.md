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
```

When a test fails, OrbitTest also stores screenshots under:

```txt
reports/artifacts/
```

Open the HTML report in a browser to inspect:

- Total tests
- Passed tests
- Failed tests
- Duration
- Failure reason
- Failure stack trace
- Screenshot path

To inspect a run step by step after it finishes, add `--trace`:

```bash
orbittest run tests/login.test.js --trace
```

The main HTML report links to each trace. Trace files are stored under:

```txt
reports/artifacts/<run-id>/traces/
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
