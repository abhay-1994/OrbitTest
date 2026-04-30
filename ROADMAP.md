# OrbitTest Roadmap

OrbitTest is organized as a small set of Orbit-themed parts. Each part has a clear job, and together they move a test from a user-written file to a real Chrome run with reports.

## Orbit Shell

Orbit Shell is the command surface users touch from the terminal.

It is responsible for:

- Starting a new project with `orbittest init`
- Running tests with `orbittest run`
- Showing help and version output
- Finding test files under the project
- Loading test files so they can register work
- Passing the discovered test list into the execution flow

Near-term improvements:

- Add clearer terminal output for missing files
- Add a headed/headless option
- Add a report output directory option
- Add a command to open the latest HTML report

## Orbit Core

Orbit Core is the user-facing JavaScript entry point.

It is responsible for:

- Exposing `test`, `expect`, and `run`
- Creating the `Orbit` object used inside tests
- Keeping browser commands simple and readable
- Hiding the lower-level Chrome communication details

The goal of Orbit Core is to keep the test author focused on intent:

```js
await orbit.open("https://example.com/");
await orbit.click("Login");
await orbit.type("Email", "user@example.com");
expect(await orbit.hasText("Welcome")).toBe(true);
```

Near-term improvements:

- Add more natural wait helpers
- Add better error messages for failed actions
- Add selector-based actions alongside text-based actions
- Keep the public API small and stable

## Orbit Mission Control

Orbit Mission Control coordinates test execution.

It is responsible for:

- Registering tests
- Running each test in order
- Creating a fresh browser session for each test
- Tracking passed and failed results
- Capturing failure details
- Capturing screenshots on failure
- Writing JSON and HTML reports
- Setting the process exit code for automation systems

Near-term improvements:

- Add before/after hooks
- Add test retries
- Add filtering by test name
- Add better CI-friendly output
- Add optional parallel execution when the browser lifecycle supports it safely

## Orbit Capsule

Orbit Capsule represents one isolated browser run.

It is responsible for:

- Starting a clean browser session
- Opening pages
- Waiting for page load
- Routing actions to the active page
- Taking screenshots
- Closing the browser session after the test

The important design idea is isolation. A test should not depend on cookies, extensions, history, or login state from a personal browser profile.

Near-term improvements:

- Add configurable viewport size
- Add headed browser mode
- Add browser launch options
- Add tracing or video capture support

## Orbit Surface

Orbit Surface is where page interaction happens.

It is responsible for:

- Finding visible text
- Clicking visible elements
- Typing into inputs matched by label, placeholder, name, or accessible text
- Checking whether text exists on the page
- Keeping page actions human-readable

Near-term improvements:

- Improve element matching
- Add timeout support per action
- Add stronger accessible-name matching
- Add support for select boxes, checkboxes, and file uploads
- Add clearer diagnostics when multiple elements match

## Orbit Signal

Orbit Signal carries messages between OrbitTest and Chrome.

It is responsible for:

- Opening the WebSocket connection
- Sending Chrome DevTools Protocol commands
- Receiving responses and events
- Matching command responses to requests
- Keeping browser communication predictable

Near-term improvements:

- Add better connection error handling
- Add command timeout support
- Add structured protocol logging for debugging
- Add safer cleanup when Chrome exits early

## Orbit Launchpad

Orbit Launchpad prepares Chrome for a test run.

It is responsible for:

- Finding a usable Chrome or Chromium executable
- Using Puppeteer's managed Chrome when available
- Respecting a custom browser path from `ORBITTEST_CHROME_PATH`
- Creating a temporary browser profile
- Starting Chrome with remote debugging enabled
- Reading the DevTools port
- Closing Chrome and removing temporary profile data

Near-term improvements:

- Add clearer messages when Chrome cannot be found
- Add support for more Chrome-like browsers
- Add launch diagnostics for CI environments
- Add configurable launch flags

## Current Flow

```txt
Orbit Shell
  -> Orbit Core
  -> Orbit Mission Control
  -> Orbit Capsule
  -> Orbit Surface
  -> Orbit Signal
  -> Orbit Launchpad
  -> Chrome
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
