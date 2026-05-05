# Changelog

All notable changes to OrbitTest will be documented in this file.

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
