# 🚀 OrbitTest

[![npm version](https://img.shields.io/npm/v/orbittest.svg)](https://www.npmjs.com/package/orbittest)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

**Intent-based browser automation testing made simple**

OrbitTest is a lightweight end-to-end testing tool that lets you write tests using **what users see** instead of complex selectors.

---

# ⚡ Quick Example

```js
const { test, expect, run } = require("orbittest");

test("Login flow", async (orbit) => {
  await orbit.open("https://example.com");
  await orbit.click("Login");
  await orbit.type("Email", "user@example.com");

  expect(await orbit.hasText("Dashboard")).toBe(true);
});

run();
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
npm install -D orbittest
```

Check installation:

```bash
npx orbittest --version
```

---

# 🚀 Getting Started

## Initialize project

```bash
npx orbittest init
```

This creates:

```
tests/
  example.test.js
reports/
```

---

## Run tests

```bash
npx orbittest run
```

Or:

```bash
npm run test:e2e
```

---

# 🧪 Writing Tests

```js
const { test, expect, run } = require("orbittest");

test("Home page loads", async (orbit) => {
  await orbit.open("https://example.com");

  expect(await orbit.hasText("Example Domain")).toBe(true);
});

run();
```

---

# 🌐 Browser Actions

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
npx orbittest run
```

Run specific file:

```bash
npx orbittest run tests/login.test.js
```

Run folder:

```bash
npx orbittest run tests
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
npx orbittest run
```

---

# 🚧 Current Limitations

* No parallel execution
* Limited smart matching
* Basic wait system

---

# 🚀 Roadmap

* Smart element detection
* Improved wait system
* Headless mode
* Parallel execution
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
