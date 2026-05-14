# Changelog

All notable changes to OrbitTest will be documented in this file.

## Unreleased

No changes yet.

## 3.2.0 - 2026-05-14

- Added browser display control with `--show-browser`, `--hide-browser`, and `browser.display` config using `auto`, `show`, or `hide`.
- Improved visible browser launches so Studio/local runs open Chrome in a normal maximized foreground window instead of inheriting a minimized Windows process state.
- Added OrbitTest Studio with `orbittest studio` and `orbittest ui` for a local dashboard, test explorer, run controls, live output, and report center.
- Improved Studio with OrbitTest logo branding, professional dashboard styling, run presets, command preview, test/report filters, result distribution bars, project metadata, and denser report scanning.
- Added Studio shutdown cleanup with a `Stop Studio` action, `/api/studio/stop`, socket cleanup, and Ctrl+C/SIGTERM handling so the local port is released cleanly.
- Added Orbit Intelligence in Studio to analyze recent report history, calculate a health score, detect failure hotspots, recommend the next run target, and apply/run the recommendation.
- Added visual automation APIs for canvas, WebGL, games, maps, and custom-rendered apps: `orbit.evaluate()`, `orbit.mouse.*`, and `orbit.visual.*`.
- Added visual assertions and detection helpers including screenshot change detection, pixel checks, color search, color click, and visual stability waits.
- Added a visual automation regression test and verified the new APIs with a PinThing WebGL/canvas smoke.
- Started an architecture cleanup freeze by moving project config/test discovery into `core/config.js`, moving project scaffolding into `core/scaffold.js`, moving browser evaluation helpers into `core/browser/evaluation.js`, moving visual/mouse internals into `core/visual/index.js`, adding experimental release flags, adding config regression tests, documenting Stable/Unreleased/Future feature status, and documenting module boundaries in `docs/ARCHITECTURE.md`.
- Expanded `docs/ARCHITECTURE.md` into a full tool architecture guide covering Orbit Shell, Orbit Core, Mission Control, Capsule, Surface, Locator, Signal, Launchpad, Vision, Reports, Smart Report, Studio, CI, Config, execution flows, target structure, feature map, testing strategy, and release direction.
- Improved Studio shutdown UX so stopping Studio closes the tab when possible or falls back to a blank page instead of showing a custom shutdown message.
- Added framework-level lifecycle support with `beforeAll`, `afterAll`, config-driven `globalSetup`, richer `testInfo`, run-level `runInfo`, and lifecycle regression tests.
- Added `orbit.storage.*` browser state APIs for CDP cookies, `HttpOnly` cookie support, `localStorage`, `sessionStorage`, session-state save/load, privacy-safe session inspection, session health assertions, JWT expiry detection, and storage regression tests.

## 3.0.0

- Upgraded HTML reports with failure diagnostics, inline failure screenshots, source code frames, smarter failure guidance, and embedded trace timelines when `--trace` is used.
- Added trace summaries to JSON reports so failed steps, last page state, and action timing are available in the main report data.
- Added synthetic trace failure steps for assertion and other non-browser-action errors so the trace status matches the main report.
- Added per-run report folders plus `orbittest clean-reports` to keep report history organized without breaking existing `latest.html` and `latest.json` usage.
- Added `--smart-report` to capture console errors, page JavaScript errors, failed requests, slow requests, navigation, and current page state in failure reports.
- Improved Smart Report visibility so passed tests also show browser evidence and important recent network activity in the HTML report.
- Improved Smart Report network capture with response-stage observation so failed XHR/fetch calls can show status codes and short response bodies such as validation errors.
- Added Smart Report failure gating so clear application failures like invalid credentials, failed API responses, and serious browser errors mark the test failed.
- Fixed Smart Report failure screenshots by disabling response interception before screenshot capture.
- Replaced Smart Report last-action screenshot fallback with failure-only screenshots or failure snapshots so reports do not show pre-error images.
- Added public APIs for JavaScript dialogs, notification permissions, and multi-window/tab workflows, including stable window indexes across target activation.
- Added local failure report auto-open support with a small temporary report server, controlled by `openReportOnFailure`, `--no-open-report-on-failure`, and `--report-port`.
- Added CI/CD mode with `--ci`, CI-safe console output, automatic local report auto-open disabling, and CI-focused defaults for retries, traces, and screenshots.
- Added machine-readable CI artifacts: `summary.json`, `junit.xml`, `latest-summary.json`, and `latest-junit.xml`.
- Added test sharding with `--shard current/total` for parallel pipeline jobs.
- Added failure controls with `--fail-fast` and `--max-failures N` so CI runs can stop scheduling new tests after a failure threshold.
- Added flaky test reporting when a retry passes after an earlier failed attempt, including failed-attempt evidence in the report data.
- Added skipped result reporting for tests not scheduled after fail-fast or max-failure limits.
- Added GitHub Actions annotations with `--github-annotations` for inline failed and flaky test messages in pull requests.

## 2.1.2

- Updated documentation wording for live step debugging.

## 2.1.1

- Added `--trace` step-by-step HTML traces with screenshots, URLs, durations, and report links.
- Added `--step` live Orbit Inspector mode with Step, Resume, and Stop controls in an isolated testing browser window.
- Added red click visualization for `click()`, `doubleClick()`, and `rightClick()` actions.
- Improved typing behavior for app frameworks by dispatching keyboard-style input events.
- Added short auto-wait behavior for `exists()` and `hasText()` assertions.
- Fixed numeric timeout forwarding for helpers like `waitForText("Dashboard", 10000)`.
- Hardened Chrome launch handling for transient Windows `DevToolsActivePort` file locks.

## 1.1.3

- Added CSS, XPath, role, and attribute locators.
- Added `exists()` and `text()` page helpers.
- Added `wait()`, `waitFor()`, and `waitForText()` helpers.
- Hardened WebSocket close handling, command timeouts, navigation waits, and click point selection.
- Fixed bundled CLI test registration for the npm `dist` package.

## 1.1.2

- Added open-source project files.

## 1.1.1

- Simplified the README for npm.
- Changed the package license to Apache-2.0.

## 1.1.0

- Added the OrbitTest CLI and test runner.
- Added browser automation helpers.
- Added HTML and JSON reports.
