# OrbitTest Architecture

OrbitTest is an intent-first browser automation and test runner. The public API should stay small and readable, while the internals become more modular as the tool grows.

The core architecture rule is:

```txt
Keep OrbitTest simple outside, modular inside.
```

User code should feel like this:

```js
await orbit.open("https://example.com/");
await orbit.click("Login");
await orbit.type("Email", "user@example.com");
expect(await orbit.hasText("Welcome")).toBe(true);
```

Internally, OrbitTest should be separated into clear modules for CLI, config, runner, browser control, page actions, locators, visual automation, reports, Studio, and future API automation.

## Current Status

OrbitTest is in an architecture cleanup freeze. New large features should wait until the existing pieces are easier to maintain, test, and release.

Current product directions:

- UI automation
- Locator engine
- Visual automation
- Reports
- Smart Report
- Studio/UI
- CI/CD
- Future API automation

This is a strong product direction, but each feature needs a clear internal home.

## Feature Status

| Feature | Status | Notes |
| --- | --- | --- |
| UI automation | Stable | Core OrbitTest identity |
| Locator engine | Stable | CSS, XPath, role, attribute, text, all-elements support |
| Reports | Stable | HTML, JSON, summary, JUnit, traces |
| CI/CD | Stable | CI mode, sharding, retries, fail-fast, GitHub annotations |
| Smart Report | Stable | Browser evidence and failure diagnosis |
| Browser display control | Stable | `--show-browser`, `--hide-browser`, `browser.display` |
| Studio/UI | Stable | Local dashboard and run center |
| Visual automation | Experimental | `orbit.evaluate()`, `orbit.mouse.*`, `orbit.visual.*` |
| Browser storage/session state | Stable | `orbit.storage.*`, cookies, localStorage, sessionStorage, saved session files |
| API automation | Future | Do not add during current freeze |

## High-Level Flow

```txt
User test file
  -> Orbit Shell
  -> Project config
  -> Test registration
  -> Orbit Mission Control
  -> Orbit Capsule
  -> Orbit Core
  -> Orbit Surface
  -> Orbit Signal
  -> Chrome DevTools Protocol
  -> Chrome
  -> Reports
```

More concretely:

```txt
cli.js
  -> core/config.js
  -> runner/runner.js
  -> orbit.js
  -> core/launcher.js
  -> core/browser.js
  -> core/connection.js
  -> pages/page.js
  -> pages/actions/*
  -> reports/*
```

## Orbit-Themed Parts

OrbitTest is organized as a small set of Orbit-themed parts. Each part has a clear job, and together they move a test from a user-written file to a real Chrome run with reports.

## Orbit Shell

Orbit Shell is the command surface users touch from the terminal.

Current files:

- `cli.js`
- `core/config.js`
- `core/scaffold.js`

It is responsible for:

- Starting a new project with `orbittest init`
- Running tests with `orbittest run`
- Starting Studio with `orbittest studio` and `orbittest ui`
- Cleaning reports with `orbittest clean-reports`
- Showing help and version output
- Loading `orbittest.config.js`
- Resolving CLI flags and config defaults
- Finding test files under the project
- Loading test files so they can register work
- Passing the discovered test list into the execution flow

What belongs here:

- CLI command parsing
- Help text
- Argument validation
- Calling internal modules

What should not grow here:

- Browser automation logic
- Report rendering logic
- Locator matching logic
- Studio business logic

Near-term improvements:

- Add stronger CLI argument regression tests
- Add a command to open the latest HTML report
- Keep `cli.js` as a small command router

## Orbit Core

Orbit Core is the user-facing JavaScript entry point.

Current files:

- `orbit.js`
- `runner/runner.js` exports for `test`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, and `run`

It is responsible for:

- Exposing `test`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, and `run`
- Creating the `Orbit` object used inside tests
- Keeping browser commands simple and readable
- Hiding lower-level Chrome communication details
- Providing stable public APIs like `open`, `click`, `type`, `exists`, `hasText`, `text`, `all`, `url`, and `title`

The goal of Orbit Core is to keep the test author focused on intent:

```js
await orbit.open("https://example.com/");
await orbit.click("Login");
await orbit.type("Email", "user@example.com");
expect(await orbit.hasText("Welcome")).toBe(true);
```

What belongs here:

- Public method names
- Public API orchestration
- Stable user-facing behavior

What should move out over time:

- Dialog handling internals
- Window/tab management internals
- Smart Report collection internals
- Trace HTML rendering internals
- Any large engine implementation

Near-term improvements:

- Add more natural wait helpers
- Add better error messages for failed actions
- Keep the public API small and stable
- Move more implementation details into `core/browser/*`, `core/visual/*`, and future `core/reports/*`

## Orbit Mission Control

Orbit Mission Control coordinates test execution.

Current files:

- `runner/runner.js`
- `runner/inspector.js`

It is responsible for:

- Registering tests
- Registering hooks
- Running each test
- Creating a fresh browser session for each test
- Applying retries
- Applying sharding
- Applying fail-fast and max-failure rules
- Tracking passed, failed, flaky, and skipped results
- Capturing failure details
- Capturing screenshots on failure
- Writing report artifacts
- Setting the process exit code for automation systems

What belongs here:

- Test lifecycle
- Scheduling
- Retry state
- Result state
- Test metadata

What should move out over time:

- HTML report rendering
- JUnit rendering
- Summary report creation
- Smart failure insight rendering

Near-term improvements:

- Move report rendering into `core/reports/*`
- Add report-generation regression tests
- Add CLI flag tests around sharding, fail-fast, and CI mode
- Improve parallel execution scheduling and output

## Orbit Capsule

Orbit Capsule represents one isolated browser run.

Current files:

- `orbit.js`
- `core/launcher.js`
- `core/target.js`
- `core/browser.js`

It is responsible for:

- Starting a clean browser session
- Opening pages
- Waiting for page load
- Routing actions to the active page
- Taking screenshots
- Managing active targets/windows
- Closing the browser session after the test

The important design idea is isolation. A test should not depend on cookies, extensions, history, or login state from a personal browser profile.

Near-term improvements:

- Add configurable viewport size
- Add browser launch options
- Add launch diagnostics for CI environments
- Move window/tab helpers into `core/browser/windows.js`
- Move dialog helpers into `core/browser/dialogs.js`
- Move notification permission helpers into `core/browser/permissions.js`

## Orbit Surface

Orbit Surface is where page interaction happens.

Current files:

- `pages/page.js`
- `pages/actions/*`
- `pages/helpers/*`

It is responsible for:

- Finding visible text
- Clicking visible elements
- Hovering elements
- Double-clicking and right-clicking
- Typing into inputs matched by label, placeholder, name, or accessible text
- Checking whether text exists on the page
- Reading element text
- Returning all matched elements
- Waiting for text or elements
- Keeping page actions human-readable

Current page action modules:

- `pages/actions/click.js`
- `pages/actions/double-click.js`
- `pages/actions/right-click.js`
- `pages/actions/hover.js`
- `pages/actions/type.js`
- `pages/actions/exists.js`
- `pages/actions/has-text.js`
- `pages/actions/text.js`
- `pages/actions/all.js`
- `pages/actions/wait-for.js`
- `pages/actions/wait-for-text.js`
- `pages/actions/find-point.js`
- `pages/actions/find-clickable-point.js`
- `pages/actions/focus-input.js`
- `pages/actions/get-html.js`

Near-term improvements:

- Improve element matching
- Add stronger accessible-name matching
- Add support for select boxes, checkboxes, and file uploads
- Add clearer diagnostics when multiple elements match
- Move locator-specific logic toward `core/locator/*`

## Orbit Locator

Orbit Locator is the matching and element-resolution layer.

Current files:

- `pages/helpers/locators.js`
- `pages/actions/all.js`
- `pages/actions/find-point.js`
- `pages/actions/find-clickable-point.js`

It is responsible for:

- Text matching
- CSS locator handling
- XPath locator handling
- Role locator handling
- Attribute locator handling
- `nth`, `first`, and `last` locators
- Returning reusable element snapshots from `orbit.all()`
- Choosing actionable points for clicks

Stable public APIs:

```js
orbit.css("#login")
orbit.xpath("//button[text()='Login']")
orbit.getByRole("button", "Login")
orbit.getByAttribute("data-testid", "submit")
orbit.all(orbit.css("button"))
orbit.nth(orbit.css("button"), 1)
orbit.first(orbit.css("button"))
orbit.last(orbit.css("button"))
```

Near-term improvements:

- Create `core/locator/index.js`
- Add locator ranking diagnostics
- Add "Locator Doctor" later, after architecture cleanup
- Add focused locator engine tests

## Orbit Signal

Orbit Signal carries messages between OrbitTest and Chrome.

Current files:

- `core/connection.js`
- `core/browser.js`
- `core/target.js`

It is responsible for:

- Opening the WebSocket connection
- Sending Chrome DevTools Protocol commands
- Receiving responses and events
- Matching command responses to requests
- Applying command timeouts
- Keeping browser communication predictable
- Listing, activating, and closing Chrome targets

Near-term improvements:

- Add better connection error handling
- Add structured protocol logging for debugging
- Add safer cleanup when Chrome exits early
- Add focused connection tests where practical

## Orbit Launchpad

Orbit Launchpad prepares Chrome for a test run.

Current files:

- `core/launcher.js`
- `core/target.js`

It is responsible for:

- Finding a usable Chrome or Chromium executable
- Using Puppeteer's managed Chrome when available
- Respecting a custom browser path from `ORBITTEST_CHROME_PATH`
- Creating a temporary browser profile
- Starting Chrome with remote debugging enabled
- Reading the DevTools port
- Supporting visible and hidden browser display modes
- Closing Chrome and removing temporary profile data

Near-term improvements:

- Add clearer messages when Chrome cannot be found
- Add support for more Chrome-like browsers
- Add launch diagnostics for CI environments
- Add configurable launch flags

## Orbit Vision

Orbit Vision is the visual automation layer for canvas, WebGL, games, maps, clocks, custom-rendered apps, and coordinate-based UI.

Current files:

- `core/visual/index.js`
- `core/browser/evaluation.js`
- `tests/visual-features.test.js`
- `tests/pinthing.visual.test.js`

Public APIs:

```js
await orbit.evaluate(() => document.title);
await orbit.mouse.click(300, 200);
await orbit.mouse.drag({ x: 100, y: 100 }, { x: 300, y: 300 });
await orbit.visual.findColor("#df1f1f");
await orbit.visual.clickColor("#df1f1f");
await orbit.visual.expectPixel(10, 10, "#ffffff");
await orbit.visual.waitForStable();
await orbit.visual.changed(async () => {
  await orbit.mouse.click(300, 200);
});
```

It is responsible for:

- Browser-side JavaScript evaluation
- Coordinate mouse movement
- Coordinate clicks
- Dragging
- Mouse wheel events
- Screenshot capture
- PNG decoding
- Pixel assertions
- Color search
- Color click
- Visual change detection
- Visual stability waits

Status:

- Working and tested locally
- Released in 3.2.0 as experimental

Near-term improvements:

- Keep API names stable during the next release cycle
- Add region-based visual helpers only after current APIs settle
- Add docs examples for canvas, map, and clock-style apps

## Orbit Storage

Orbit Storage is the explicit browser state layer for cookies, local storage, session storage, and reusable login sessions.

Current files:

- `core/storage/index.js`
- `orbit.js`
- `tests/storage.test.js`

Public APIs:

```js
await orbit.storage.setCookie({ name: "session", value: "abc123", httpOnly: true });
await orbit.storage.cookies();
await orbit.storage.clearCookies();

await orbit.storage.setLocal("token", "abc123");
await orbit.storage.getLocal("token");
await orbit.storage.setSession("view", "compact");
await orbit.storage.getSession("view");

await orbit.storage.saveSession("auth/session.json");
await orbit.storage.loadSession("auth/session.json");
await orbit.storage.clear();
await orbit.storage.inspect();
await orbit.storage.expectHealthySession();
```

It is responsible for:

- Reading cookies through Chrome DevTools Protocol
- Setting real browser cookies, including `HttpOnly` cookies
- Deleting and clearing cookies
- Reading and writing current-origin `localStorage`
- Reading and writing current-origin `sessionStorage`
- Saving cookies and storage into a JSON session-state file
- Loading a saved session-state file into a clean browser
- Producing privacy-safe session health summaries
- Detecting auth-like cookies and storage keys
- Detecting JWT expiry without exposing token values
- Failing early when a loaded session is missing, expired, or near expiry

Design rule:

- Browser sessions stay clean by default.
- State reuse must be explicit through `orbit.storage`.
- Storage logic stays outside page actions, locator logic, and reports.

Status:

- Working and tested locally
- Released in 3.2.0

Near-term improvements:

- Add masked logging for sensitive cookie names
- Add multi-origin session-state helpers after the current-origin API settles
- Add clear docs around secure handling of saved auth files

## Orbit Reports

Orbit Reports turns test results into human-readable and machine-readable artifacts.

Current files:

- `runner/runner.js`
- `runner/report-logo.js`
- `runner/report-server.js`

Artifacts:

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

It is responsible for:

- HTML reports
- JSON reports
- Summary reports
- JUnit reports
- Failure screenshots
- Trace timeline embedding
- Code frames
- Smart Report evidence
- Local failure report auto-open
- Report cleanup

Near-term improvements:

- Move HTML rendering into `core/reports/html.js`
- Move JSON/summary generation into `core/reports/json.js`
- Move JUnit rendering into `core/reports/junit.js`
- Move report cleanup into `core/reports/cleanup.js`
- Add report-generation tests

## Orbit Smart Report

Orbit Smart Report collects browser evidence so failures are easier to understand.

Current files:

- `orbit.js`
- `runner/runner.js`

It captures:

- Browser console errors
- Page JavaScript errors
- Failed requests
- Slow requests
- Recent navigation
- Dialogs
- Current page state
- Smart failure signals

It is responsible for:

- Explaining likely failure causes
- Adding useful evidence to reports
- Failing tests when clear application failures are detected

Near-term improvements:

- Move collection internals into `core/browser/smart-report.js`
- Keep report rendering separate from collection
- Add tests around failure-gating rules

## Orbit Studio

Orbit Studio is the local dashboard for running and inspecting tests.

Current files:

- `runner/studio-server.js`
- `cli.js`

Commands:

```bash
orbittest studio
orbittest ui
```

It is responsible for:

- Showing a test explorer
- Starting test runs from the browser
- Showing live command output
- Showing recent reports
- Showing Orbit Intelligence
- Stopping Studio cleanly
- Releasing the local port after shutdown

Status:

- Released in 3.2.0
- Should remain separate from core test execution

Near-term improvements:

- Move Studio into `core/studio/*` or `studio/*`
- Add Studio start/stop regression test
- Keep Studio calling CLI/runner APIs instead of owning test logic

## Orbit CI

Orbit CI is the automation-system layer.

Current files:

- `core/config.js`
- `runner/runner.js`

Public flags:

```bash
orbittest run --ci
orbittest run --ci --workers 4
orbittest run --ci --shard 1/4
orbittest run --ci --fail-fast
orbittest run --ci --max-failures 3
orbittest run --ci --github-annotations
```

It is responsible for:

- CI-safe defaults
- Hiding browser by default in CI
- Disabling local report auto-open in CI
- Retry defaults
- Trace/screenshot defaults
- Sharding
- Fail-fast behavior
- Max-failure stopping
- JUnit and summary artifacts
- GitHub annotations

Near-term improvements:

- Add focused CI option tests
- Add sample GitHub Actions workflow to docs
- Keep CI behavior deterministic and low-noise

## Orbit Config

Orbit Config is the configuration and option-resolution layer.

Current files:

- `core/config.js`
- `orbittest.config.js`
- `core/scaffold.js`
- `tests/config.test.js`

It is responsible for:

- Loading project config
- Validating config shape
- Applying environment config
- Normalizing defaults
- Resolving CI options
- Resolving browser display
- Resolving trace and screenshot modes
- Discovering test files

Current config shape:

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
  }
};
```

## Target Structure

OrbitTest should gradually move toward this structure:

```txt
core/
  browser/
    evaluation.js
    dialogs.js
    windows.js
    permissions.js
    smart-report.js
  locator/
    index.js
    diagnostics.js
  actions/
    click.js
    type.js
    wait.js
    text.js
  assertions/
    index.js
  visual/
    index.js
    pixels.js
    png.js
  api/
    README.md       reserved for future API automation
  runner/
    scheduler.js
    lifecycle.js
    retries.js
  reports/
    html.js
    json.js
    junit.js
    cleanup.js
  studio/
    server.js
    ui.js
```

Do not move everything at once. Move one boundary at a time and run smoke tests after each move.

## Current Module Map

| Area | Files | Responsibility |
| --- | --- | --- |
| CLI shell | `cli.js` | Parse commands, print help, call core modules |
| Project config | `core/config.js` | Load/normalize config, resolve options, discover tests |
| Project scaffold | `core/scaffold.js` | Create starter config, starter test, package script, `.gitignore` entry |
| Browser evaluation | `core/browser/evaluation.js` | Build evaluation expressions and decode CDP return values |
| Browser launch | `core/launcher.js`, `core/target.js` | Start Chrome, manage targets, close Chrome |
| CDP connection | `core/connection.js`, `core/browser.js` | Send/receive Chrome DevTools Protocol messages |
| Visual engine | `core/visual/index.js` | Mouse coordinates, screenshots, pixels, color search, visual waits |
| Storage engine | `core/storage/index.js` | Cookies, localStorage, sessionStorage, session-state save/load |
| Page actions | `pages/actions/*`, `pages/helpers/*` | Locators, clicks, typing, waits, text extraction |
| Runner | `runner/runner.js` | Test registration, execution, retries, CI mode, reports |
| Reports | `runner/runner.js`, `runner/report-server.js`, `runner/report-logo.js` | HTML/JSON/JUnit/summary reports and local report serving |
| Studio | `runner/studio-server.js` | Local dashboard, run controls, report center, Orbit Intelligence |
| Public API | `orbit.js` | `Orbit` object and exported test APIs |

## Feature Map

| What exists | Status | Public API or command | Internal files | Test files | Docs |
| --- | --- | --- | --- | --- | --- |
| UI automation | Stable | `orbit.open()`, `orbit.click()`, `orbit.type()`, `orbit.exists()` | `orbit.js`, `pages/actions/*`, `pages/helpers/*` | `tests/example.test.js`, `tests/sample.test.js` | `README.md`, `docs/tutorial/how_to_use.md` |
| Locator engine | Stable | `orbit.css()`, `orbit.xpath()`, `orbit.getByRole()`, `orbit.getByAttribute()`, `orbit.all()` | `pages/helpers/locators.js`, `pages/actions/all.js` | `tests/sample.test.js` | `README.md`, `docs/tutorial/how_to_use.md` |
| Visual automation | Experimental | `orbit.evaluate()`, `orbit.mouse.*`, `orbit.visual.*` | `core/browser/evaluation.js`, `core/visual/index.js`, `orbit.js` | `tests/visual-features.test.js`, `tests/pinthing.visual.test.js` | `README.md`, `VISUAL_AUTOMATION_APIS.txt` |
| Browser storage/session state | Stable | `orbit.storage.*` | `core/storage/index.js`, `orbit.js` | `tests/storage.test.js` | `README.md`, `docs/tutorial/how_to_use.md` |
| Reports | Stable | `orbittest run`, `--trace`, `--smart-report` | `runner/runner.js`, `runner/report-logo.js`, `runner/report-server.js` | `tests/example.test.js`, `tests/sample.test.js` | `README.md`, `docs/tutorial/how_to_use.md` |
| Studio/UI | Stable | `orbittest studio`, `orbittest ui` | `runner/studio-server.js`, `cli.js` | Manual smoke for now | `README.md`, `docs/tutorial/how_to_use.md` |
| CI/CD | Stable | `--ci`, `--shard`, `--fail-fast`, `--max-failures`, `--github-annotations` | `core/config.js`, `runner/runner.js` | `tests/config.test.js` | `README.md`, `docs/tutorial/how_to_use.md` |
| Lifecycle hooks | Stable | `beforeAll()`, `afterAll()`, `beforeEach()`, `afterEach()`, `globalSetup` | `runner/runner.js`, `core/config.js`, `cli.js` | `tests/lifecycle.test.js` | `README.md`, `docs/tutorial/how_to_use.md` |
| Smart Report | Stable | `--smart-report` | `orbit.js`, `runner/runner.js` | Existing browser smoke coverage | `README.md`, `docs/tutorial/how_to_use.md` |
| API automation | Future | None during feature freeze | Reserved for future `core/api/*` | Not started | Roadmap only |

## Public API Stability

Stable APIs:

```js
await orbit.open(url);
await orbit.click(locatorOrText);
await orbit.type(locatorOrText, value);
await orbit.exists(locatorOrText);
await orbit.hasText(text);
await orbit.waitFor(locatorOrText);
await orbit.waitForText(text);
await orbit.text(locator);
await orbit.all(locator);
await orbit.url();
await orbit.title();
await orbit.pageState();
```

Stable lifecycle APIs:

```js
beforeAll(async (runInfo) => {});
beforeEach(async (orbit, testInfo) => {});
afterEach(async (orbit, testInfo) => {});
afterAll(async (runInfo) => {});
```

Stable locator helpers:

```js
orbit.css(selector);
orbit.xpath(selector);
orbit.getByRole(role, name);
orbit.getByAttribute(name, value);
orbit.nth(locator, index);
orbit.first(locator);
orbit.last(locator);
```

Experimental APIs:

```js
await orbit.evaluate(fnOrExpression);
await orbit.mouse.click(x, y);
await orbit.mouse.drag(from, to);
await orbit.visual.findColor(color);
await orbit.visual.clickColor(color);
await orbit.visual.expectPixel(x, y, color);
await orbit.visual.waitForStable();
```

Storage APIs:

```js
await orbit.storage.cookies();
await orbit.storage.setCookie({ name: "session", value: "abc123" });
await orbit.storage.setLocal("token", "abc123");
await orbit.storage.setSession("view", "compact");
await orbit.storage.saveSession("auth/session.json");
await orbit.storage.loadSession("auth/session.json");
await orbit.storage.inspect();
await orbit.storage.expectHealthySession();
```

Future API automation should eventually look simple:

```js
const res = await orbit.api.get("/users");
```

But API automation should not be added until after the architecture cleanup release.

## Feature Flags

`orbittest.config.js` accepts an `experimental` object so release status is explicit:

```js
experimental: {
  studio: true,
  visualAutomation: true,
  apiTesting: false
}
```

These flags document what is available or intentionally frozen. They should not break existing users.

## Execution Flow: `orbittest run`

```txt
User runs command
  -> cli.js parses args
  -> core/config.js loads and normalizes config
  -> core/config.js discovers test files
  -> cli.js sets collection mode
  -> test files are required
  -> runner/runner.js registers tests
  -> runner/runner.js executes selected tests
  -> Orbit instance launches Chrome
  -> test actions run through orbit.js
  -> page actions run through pages/actions/*
  -> CDP commands go through core/browser.js and core/connection.js
  -> results are collected
  -> reports are written
  -> process exit code is set
```

## Execution Flow: A Click

```txt
await orbit.click("Login")
  -> orbit.js traceStep()
  -> pages/page.js click()
  -> pages/actions/click.js
  -> locator helpers resolve candidates
  -> clickable point is selected
  -> input helper dispatches mouse event
  -> CDP command is sent through connection
  -> optional screenshot/trace/smart report evidence is captured
```

## Execution Flow: Visual Automation

```txt
await orbit.visual.findColor("#df1f1f")
  -> orbit.js exposes visual API
  -> core/visual/index.js captures screenshot
  -> PNG is decoded
  -> pixels are scanned
  -> best matching point is returned
```

## Execution Flow: Studio

```txt
orbittest studio
  -> cli.js starts Studio command
  -> runner/studio-server.js starts local server
  -> browser opens dashboard
  -> dashboard calls Studio API
  -> Studio starts CLI test runs
  -> live output is streamed
  -> reports are discovered from reports directory
```

Studio must stay separate from core execution. It can call the runner, but it should not own test execution logic.

## Execution Flow: Reports

```txt
Test finishes
  -> runner creates result object
  -> screenshot/trace/smart evidence is attached
  -> report object is built
  -> HTML report is rendered
  -> JSON report is written
  -> summary.json is written
  -> junit.xml is written
  -> latest files are updated
```

## Documentation Status

Docs should label features as:

- `Stable`: safe for normal users
- `Unreleased`: implemented locally and planned for the next release
- `Experimental`: useful, but still being shaped
- `Future`: planned but not implemented

## Testing Strategy

Current useful tests:

- `tests/example.test.js`: core UI flow
- `tests/sample.test.js`: hooks, locators, all-elements, title/url, mouse actions
- `tests/browser-features.test.js`: dialogs, notifications, windows/tabs
- `tests/config.test.js`: config normalization and discovery
- `tests/lifecycle.test.js`: `beforeAll`, `afterAll`, `globalSetup`, and richer `testInfo`
- `tests/visual-features.test.js`: visual API regression
- `tests/pinthing.visual.test.js`: external visual smoke
- `tests/bstackdemo.test.js`: external ecommerce smoke
- `tests/orangehrm.test.js`: external login smoke

Recommended release smoke:

```bash
node cli.js run tests\config.test.js tests\example.test.js tests\sample.test.js tests\visual-features.test.js --hide-browser --no-open-report-on-failure
```

Recommended full local run:

```bash
node cli.js run --hide-browser --no-open-report-on-failure
```

External-site tests are valuable, but failures may come from network or application changes. Core release confidence should primarily come from local deterministic tests.

## Cleanup Rules

- Do not add API automation during this freeze.
- Do not add new user-facing APIs unless they unblock cleanup or fix broken behavior.
- When a file grows because of a feature, create a small module before the feature becomes hard to move.
- Keep `cli.js` focused on commands, not config rules or scaffolding content.
- Keep `orbit.js` focused on public methods and orchestration, not every implementation detail.
- Keep `runner/runner.js` focused on execution, not report rendering.
- Every cleanup should preserve old commands, options, reports, and test syntax.
- Run smoke tests after every meaningful extraction.

## Suggested Next Extractions

These are architecture tasks, not new features:

- Done: move config/test discovery into `core/config.js`
- Done: move project scaffolding into `core/scaffold.js`
- Done: move browser evaluation helpers into `core/browser/evaluation.js`
- Done: move visual/mouse internals into `core/visual/index.js`
- Next: move dialog helpers from `orbit.js` into `core/browser/dialogs.js`
- Next: move window/tab helpers from `orbit.js` into `core/browser/windows.js`
- Next: move notification permission helpers into `core/browser/permissions.js`
- Next: move HTML report rendering into `core/reports/html.js`
- Next: move JUnit rendering into `core/reports/junit.js`
- Next: move report cleanup into `core/reports/cleanup.js`
- Later: move locator engine into `core/locator/*`

## Suggested Release Path

```txt
3.2.0 = Studio + Visual Automation + browser display controls + architecture cleanup + storage/session intelligence
3.x = Continued architecture cleanup + stability
4.0.0 = API automation
```

## Project Direction

OrbitTest should stay small, readable, and practical.

The main goals are:

- Make browser tests easy to write
- Keep setup simple for npm users
- Run each test in a clean browser environment
- Produce useful reports by default
- Prefer clear behavior over a large API
- Keep internals separated so each Orbit part can improve without making the rest harder to understand
- Keep public APIs stable while internals evolve
- Treat reports and diagnostics as a first-class product surface
- Add large features only when the architecture has a clean place for them

## Final Principle

OrbitTest should not become one giant runner.

It should become a modular testing platform where:

- `cli.js` is the command shell
- `orbit.js` is the public user API
- `runner/runner.js` coordinates execution
- `pages/*` handles page interaction
- `core/browser/*` owns browser capabilities
- `core/visual/*` owns visual automation
- `core/reports/*` will own reports
- `core/api/*` stays reserved for future API automation

The outside should stay simple:

```js
await orbit.click("Login");
```

The inside should stay organized.
