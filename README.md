# OrbitTest

Simple browser automation testing for Node.js.

## Installation

```bash
npm install -D orbittest
```

OrbitTest uses Puppeteer's managed Chrome, so a browser is downloaded during install when Puppeteer downloads are enabled.

## Quick Start

Create a test project:

```bash
npx orbittest init
```

Run tests:

```bash
npx orbittest run
```

Or add and use an npm script:

```json
{
  "scripts": {
    "test:e2e": "orbittest run"
  }
}
```

```bash
npm run test:e2e
```

## Test Example

```js
const { test, expect, run } = require("orbittest");

test("home page works", async (orbit) => {
  await orbit.open("https://example.com/");
  expect(await orbit.hasText("Example Domain")).toBe(true);
});

run();
```

## Browser API

```js
await orbit.open("https://example.com/");
await orbit.click("Login");
await orbit.type("Email", "user@example.com");
await orbit.hasText("Welcome");
await orbit.waitForText("Ready");
await orbit.waitFor(orbit.css(".loaded"));
await orbit.wait(500);
await orbit.screenshot("reports/screenshot.png");
```

## Locators

Text still works:

```js
await orbit.click("Login");
await orbit.type("Email", "user@example.com");
```

You can also use CSS selectors, XPath, roles, and attributes:

```js
await orbit.click(orbit.css("#login"));
await orbit.click(orbit.xpath("//button[text()='Login']"));
await orbit.click(orbit.getByRole("button", "Login"));
await orbit.type(orbit.getByAttribute("name", "email"), "user@example.com");

expect(await orbit.exists(orbit.css(".success"))).toBe(true);
expect(await orbit.text(orbit.getByRole("heading", "Welcome"))).toContain("Welcome");
```

## Waiting

Wait for text:

```js
await orbit.waitForText("Dashboard");
await orbit.waitForText("Dashboard", { timeout: 10000, interval: 200 });
```

Wait for any locator:

```js
await orbit.waitFor(orbit.css(".toast"));
await orbit.waitFor(orbit.xpath("//button[text()='Continue']"), 5000);
await orbit.waitFor(orbit.getByRole("button", "Save"));
await orbit.waitFor(orbit.getByAttribute("data-testid", "ready"));
```

Wait for a fixed time:

```js
await orbit.wait(500);
```

Locator objects are supported too:

```js
await orbit.click({ css: "#login" });
await orbit.click({ xpath: "//button" });
await orbit.click({ role: "button", name: "Login" });
await orbit.click({ attribute: "data-testid", value: "submit" });
```

## CLI

```bash
npx orbittest init
npx orbittest run
npx orbittest run tests/login.test.js
npx orbittest --help
```

## Reports

Each run writes HTML and JSON reports:

```txt
reports/latest.html
reports/latest.json
```

Failed tests also include screenshots under `reports/artifacts/`.

## Environment Variables

| Variable | Description |
| --- | --- |
| `ORBITTEST_CHROME_PATH` | Use a specific Chrome or Chromium executable |
| `PUPPETEER_SKIP_DOWNLOAD` | Set through Puppeteer to skip browser download during install |

## Requirements

Node.js 18+

## Links

- npm: https://www.npmjs.com/package/orbittest

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

For behavior expectations, see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For vulnerability reports, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0

## Keywords

browser automation, testing, e2e, test runner, Chrome, CDP
