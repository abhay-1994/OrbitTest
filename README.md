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

Hooks and per-test options are supported:

```js
const { beforeEach, afterEach, test } = require("orbittest");

beforeEach(async (orbit, testInfo) => {
  console.log(`Starting ${testInfo.name}`);
});

afterEach(async (orbit, testInfo) => {
  console.log(`Finished ${testInfo.name}`);
});

test("retry a slow flow", { retries: 1, timeout: 30000 }, async (orbit) => {
  await orbit.open("https://example.com");
});
```

---

# 🌐 Browser Actions

# Configuration

OrbitTest reads `orbittest.config.js` from your project root:

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

CLI flags override config values, for example `orbittest run --workers 2 --retries 1 --timeout 30000 --env staging`.

Test files are run by the CLI, so you do not need `run()` in each test file.

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

# 📊 Reports

After each run:

```
reports/latest.html
reports/latest.json
```

---

## Includes

* Total tests
* Passed / Failed
* Duration
* Error details
* Stack trace
* Screenshot path

---

## Failure screenshots

```
reports/artifacts/
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

Override config from the CLI:

```bash
orbittest run --retries 2 --timeout 30000 --reports-dir reports/debug
```

---

# 🌍 Browser Behavior

* Fresh browser per test
* No cookies or cache
* No extensions
* Fully isolated environment

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
* Headless mode
* CI integrations

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
