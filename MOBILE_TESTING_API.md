# OrbitTest Mobile Testing API

This file lists the mobile testing APIs available in this OrbitTest tool.
Mobile automation is provided by `@orbittest/mobile`, and the normal test runner is imported from `orbittest`.

## Recommended Import Style

Use this in OrbitTest Desktop projects:

```js
const { test, expect } = require("orbittest");
```

Then get the mobile device context from the test callback:

```js
test("mobile test", async ({ orbit }) => {
  if (!orbit) throw new Error("Mobile context is not configured.");
  await orbit.wakeUp();
});
```

Do not use `require("orbittest/mobile")` unless your installed package explicitly exports that path. In the current Desktop workflow, `orbittest` is the public runner and `@orbittest/mobile` is loaded from `orbittest.config.js`.

## Requirements

- Android SDK platform tools installed.
- USB debugging enabled on the Android device.
- `adb devices` must show the device as `device`.
- `orbittest.config.js` must enable the mobile provider.

## Mobile Config

Example:

```js
module.exports = {
  openReportOnFailure: { enabled: false },
  use: {
    web: false,
    mobile: {
      provider: "@orbittest/mobile",
      platform: "android",
      adbPath: process.env.ADB_PATH || "adb",
      deviceSerial: process.env.DEVICE_SERIAL,
      apk: "./app.apk",
      appPackage: "com.myapp",
      appActivity: ".MainActivity",
      artifactsDir: "orbittest-results",
      screenshotOnFailure: true,
      logcatOnFailure: true,
      uiDumpOnFailure: true,
      defaultTimeoutMs: 5000
    }
  }
};
```

### Config Options

| Option | Type | Explanation |
| --- | --- | --- |
| `provider` | `string` | Mobile provider package. Usually `"@orbittest/mobile"`. |
| `platform` | `"android"` | Mobile platform. Current provider supports Android. |
| `adbPath` | `string` | Path to ADB. Use `"adb"` if it is on PATH. |
| `deviceSerial` | `string \| null` | Specific device serial. Useful when multiple devices are connected. |
| `apk` | `string \| null` | APK path used by `installApp()` when no path is passed. |
| `appPackage` | `string \| null` | Android package name used by app lifecycle methods. |
| `appActivity` | `string \| null` | Activity used by `launchApp()`. |
| `artifactsDir` | `string` | Folder for screenshots, UI dumps, logcat, and metadata. |
| `screenshotOnFailure` | `boolean` | Save screenshot when a mobile test fails. |
| `logcatOnFailure` | `boolean` | Save logcat when a mobile test fails. |
| `uiDumpOnFailure` | `boolean` | Save UIAutomator dump when a mobile test fails. |
| `defaultTimeoutMs` | `number` | Default timeout for waits and selector actions. |
| `projectRoot` | `string` | Advanced provider option for resolving paths. Usually injected by Desktop. |

## Test Context

When `use.mobile` is configured:

| Context Property | Explanation |
| --- | --- |
| `orbit` | Mobile device context. This is what you use for Android actions. |
| `mobile` | Alias for `orbit`. |
| `page` | Web page context, when web testing is enabled. |
| `web` | Alias for `page`. |
| `testInfo` | Metadata about the current test. |

Example:

```js
test("hybrid test", async ({ page, orbit }) => {
  await page.goto("https://example.com");
  await orbit.launchApp("com.example.app", ".MainActivity");
});
```

## App Lifecycle APIs

### `installApp(apkPath?)`

Installs an APK on the connected device.

```js
await orbit.installApp("./app.apk");
```

If `apkPath` is omitted, OrbitTest uses `use.mobile.apk`.

### `uninstallApp(packageName?)`

Uninstalls an app.

```js
await orbit.uninstallApp("com.example.app");
```

If omitted, uses `use.mobile.appPackage`.

### `launchApp(packageName?, activity?)`

Launches an app.

```js
await orbit.launchApp("com.orbitmart.app.debug", "com.orbitmart.app.MainActivity");
```

If package and activity are omitted, uses config values. If no activity is provided, the provider tries to resolve the launch activity and can fall back to Android `monkey`.

### `resolveLaunchActivity(packageName?)`

Returns the launchable Android component for a package, or `null`.

```js
const activity = await orbit.resolveLaunchActivity("com.example.app");
```

### `stopApp(packageName?)`

Force-stops an app.

```js
await orbit.stopApp("com.example.app");
```

### `clearAppData(packageName?)`

Clears app data and cache.

```js
await orbit.clearAppData("com.example.app");
```

This is often faster and cleaner than deleting text from fields one character at a time.

### `isAppInstalled(packageName?)`

Checks whether an app is installed.

```js
const installed = await orbit.isAppInstalled("com.example.app");
expect(installed).toBe(true);
```

## Touch And Gesture APIs

### `tap(x, y)`

Taps screen coordinates.

```js
await orbit.tap(540, 1600);
```

Use this only when no stable text, resource ID, or content description is available.

### `longPress(x, y, durationMs?)`

Long-presses at coordinates.

```js
await orbit.longPress(540, 1600, 1000);
```

Default duration is about `800` ms.

### `swipe(x1, y1, x2, y2, durationMs?)`

Swipes from one coordinate to another.

```js
await orbit.swipe(540, 1800, 540, 400, 500);
```

### `scrollDown(amount?)`

Scrolls down by swiping upward.

```js
await orbit.scrollDown();
await orbit.scrollDown(0.5);
```

The `amount` is relative to screen height in the current provider.

### `scrollUp(amount?)`

Scrolls up by swiping downward.

```js
await orbit.scrollUp();
await orbit.scrollUp(0.5);
```

## Keyboard And Text APIs

### `typeText(text)`

Types text into the focused field using Android input.

```js
await orbit.typeText("testuser");
```

Notes:

- Spaces are encoded for ADB input.
- Some special characters can depend on the active keyboard and Android input behavior.

### `clearText()`

Clears the focused input by sending delete key events.

```js
await orbit.clearText();
```

Important: this can be slow because it sends many key events through ADB. Prefer `clearAppData()` before launching the app when you need a clean login form.

### `sleep(ms)`

Waits for a fixed number of milliseconds.

```js
await orbit.sleep(500);
```

Prefer specific waits like `waitForId()` or `waitForText()` when possible.

### `pressKey(code)`

Presses an Android key code.

```js
await orbit.pressKey(4); // BACK
```

Common use: hide the soft keyboard before tapping another field or button.

## Key Constants

The provider exports these key codes for advanced/direct usage:

| Constant | Value | Meaning |
| --- | ---: | --- |
| `Key.HOME` | `3` | Home button |
| `Key.BACK` | `4` | Back button |
| `Key.ENTER` | `66` | Enter |
| `Key.DEL` | `67` | Delete/backspace |
| `Key.APP_SWITCH` | `187` | Recent apps |
| `Key.POWER` | `26` | Power |
| `Key.VOLUME_UP` | `24` | Volume up |
| `Key.VOLUME_DOWN` | `25` | Volume down |

In normal `require("orbittest")` tests, you can also use numeric values directly:

```js
await orbit.pressKey(4); // BACK
```

## Selector And Tap APIs

### `tapText(text, options?)`

Finds visible UI text and taps the best matching node.

```js
await orbit.tapText("Login");
await orbit.tapText("Login", { exact: true, timeoutMs: 10000 });
```

Options:

| Option | Explanation |
| --- | --- |
| `exact` | When true, text must match exactly. Otherwise partial match is allowed. |
| `timeoutMs` | Time to wait for the text. |

### `tapById(resourceId, options?)`

Finds a UIAutomator `resource-id` and taps its center.

```js
await orbit.tapById("loginUsername");
await orbit.tapById("com.example:id/loginUsername");
await orbit.tapById("loginUsername", { timeoutMs: 10000 });
```

Use the exact ID visible in the UI dump. WebView apps may expose IDs like `loginUsername`; native apps often expose full IDs like `com.example:id/loginUsername`.

### `tapByDescription(description, options?)`

Finds an Android content description and taps it.

```js
await orbit.tapByDescription("Open menu");
await orbit.tapByDescription("Open menu", { exact: true });
```

This is useful for icon buttons and accessibility labels.

## Screen Query APIs

### `getScreenSize()`

Returns physical screen size.

```js
const size = await orbit.getScreenSize();
console.log(size.width, size.height);
```

Returns:

```js
{ width: number, height: number }
```

### `dumpUi(options?)`

Returns parsed UIAutomator nodes.

```js
const nodes = await orbit.dumpUi();
console.log(nodes[0]);
```

Each node has this shape:

```js
{
  text: string,
  resourceId: string,
  className: string,
  packageName: string,
  contentDescription: string,
  clickable: boolean,
  enabled: boolean,
  bounds: { left: number, top: number, right: number, bottom: number },
  center: { x: number, y: number }
}
```

### `dumpUiXml()`

Returns raw UIAutomator XML.

```js
const xml = await orbit.dumpUiXml();
```

Useful when debugging selectors.

### `parseUiXml(xml)`

Parses UIAutomator XML into UI nodes.

```js
const nodes = orbit.parseUiXml(xml);
```

### `getScreenText()`

Returns all node text joined by newlines.

```js
const text = await orbit.getScreenText();
expect(text).toContain("Login");
```

### `hasText(text, options?)`

Returns `true` if text exists on the screen.

```js
const visible = await orbit.hasText("Login");
const exact = await orbit.hasText("Login", { exact: true });
```

## Wait APIs

### `waitForText(text, timeoutMs?)`

Waits until text appears.

```js
await orbit.waitForText("Login", 10000);
```

### `waitForId(resourceId, timeoutMs?)`

Waits until a resource ID appears.

```js
await orbit.waitForId("loginUsername", 10000);
```

### `waitForGoneText(text, timeoutMs?)`

Waits until text disappears.

```js
await orbit.waitForGoneText("Loading", 10000);
```

## Current App APIs

### `getCurrentActivity()`

Returns the foreground activity/component string.

```js
const activity = await orbit.getCurrentActivity();
console.log(activity);
```

### `getCurrentPackage()`

Returns the current foreground package.

```js
const pkg = await orbit.getCurrentPackage();
expect(pkg).toBe("com.orbitmart.app.debug");
```

## Screenshot And Visual APIs

### `screenshot()`

Captures a PNG screenshot and returns a `Buffer`.

```js
const png = await orbit.screenshot();
```

### `saveScreenshot(path)`

Saves a screenshot to a file.

```js
await orbit.saveScreenshot("reports/login-screen.png");
```

### `compareScreenshot(baselinePath, options?)`

Compares current screenshot against a baseline PNG.

```js
const result = await orbit.compareScreenshot("baselines/home.png", {
  threshold: 0.01,
  diffPath: "reports/home-diff.png"
});

expect(result.pass).toBe(true);
```

Returns:

```js
{
  pass: boolean,
  diffPixels: number,
  diffPath?: string
}
```

Options:

| Option | Explanation |
| --- | --- |
| `threshold` | If `0` to `1`, treated as allowed ratio of pixels. If greater than `1`, treated as allowed pixel count. |
| `diffPath` | Optional file path for a visual diff image. |

## Logcat APIs

### `clearLogcat()`

Clears current logcat buffer.

```js
await orbit.clearLogcat();
```

### `getLogcat(filter?)`

Returns logcat lines. Optional filter keeps only matching lines.

```js
const lines = await orbit.getLogcat();
const appLines = await orbit.getLogcat("OrbitMart");
```

### `saveLogcat(path, filter?)`

Saves logcat lines to a file.

```js
await orbit.saveLogcat("reports/logcat.txt");
await orbit.saveLogcat("reports/orbitmart-logcat.txt", "OrbitMart");
```

## Device State APIs

### `wakeUp()`

Turns the device screen on.

```js
await orbit.wakeUp();
```

### `sleepScreen()`

Turns the device screen off.

```js
await orbit.sleepScreen();
```

### `isScreenOn()`

Returns whether the screen is on.

```js
expect(await orbit.isScreenOn()).toBe(true);
```

### `getAndroidVersion()`

Returns Android version.

```js
const version = await orbit.getAndroidVersion();
```

### `getModel()`

Returns device model name.

```js
const model = await orbit.getModel();
```

## Raw ADB APIs

### `adb(args)`

Runs raw ADB arguments.

```js
const output = await orbit.adb(["devices", "-l"]);
```

### `shell(command)`

Runs an Android shell command. Accepts a string or an array of arguments.

```js
const version = await orbit.shell(["getprop", "ro.build.version.release"]);
const size = await orbit.shell("wm size");
```

Prefer higher-level APIs when they exist. Use raw ADB for app-specific or device-specific debugging.

## Mobile Assertions

Mobile assertions are available through `expect(orbit)`.

### `toHaveText(text, options?)`

Waits for text on the current Android screen.

```js
await expect(orbit).toHaveText("Login");
await expect(orbit).toHaveText("Login", { exact: true, timeoutMs: 10000 });
await expect(orbit).toHaveText("Login", 10000);
```

### `toHaveId(resourceId, options?)`

Waits for a UIAutomator resource ID.

```js
await expect(orbit).toHaveId("loginUsername");
await expect(orbit).toHaveId("loginUsername", { timeoutMs: 10000 });
```

### `toMatchScreenshot(baselinePath, options?)`

Compares current screenshot with a baseline.

```js
await expect(orbit).toMatchScreenshot("baselines/login.png", {
  threshold: 0.01,
  diffPath: "reports/login-diff.png"
});
```

## Provider Exports For Advanced Use

Most tests should use the `orbit` object from the test context. These exports are available from the mobile provider for advanced scripts or internals:

| Export | Explanation |
| --- | --- |
| `OrbitDevice` | Device class used by the provider. |
| `Key` | Key code constants. |
| `createMobileContext(options?)` | Creates a mobile context with `{ orbit, close, captureFailureArtifacts, captureReportArtifacts }`. |
| `captureFailureArtifacts(args)` | Provider hook to capture failure artifacts. |
| `captureReportArtifacts(args)` | Provider hook to capture report artifacts. |
| `listDevices(config?)` | Lists connected Android devices. |
| `doctor(config?)` | Runs mobile environment checks. |

## CLI Commands

### `orbittest devices`

Lists connected devices.

```bash
orbittest devices
```

### `orbittest doctor`

Checks Node, config, provider loading, ADB, device connection, UIAutomator, and screenshots.

```bash
orbittest doctor
```

### `orbittest run`

Runs tests.

```bash
orbittest run tests/mobile-login.test.js
```

## Common Login Example

```js
const { test, expect } = require("orbittest");

test("OrbitMart login", { timeout: 60000 }, async ({ orbit }) => {
  if (!orbit) throw new Error("Mobile context is not configured.");

  await orbit.wakeUp();
  await orbit.clearAppData("com.orbitmart.app.debug");

  await orbit.launchApp(
    "com.orbitmart.app.debug",
    "com.orbitmart.app.MainActivity"
  );

  await orbit.waitForId("loginUsername", 10000);
  await orbit.tapById("loginUsername");
  await orbit.typeText("testuser");

  await orbit.pressKey(4); // hide keyboard

  await orbit.tapById("loginPassword");
  await orbit.typeText("Test@123");

  await orbit.pressKey(4); // hide keyboard

  await orbit.tapById("loginBtn");

  await expect(orbit).toHaveText("Good morning", { timeoutMs: 15000 });
});
```

## Practical Notes

### Prefer IDs Over Coordinates

Best:

```js
await orbit.tapById("loginBtn");
```

Use coordinates only as a fallback:

```js
await orbit.tap(540, 1930);
```

Coordinates can break on different phones or screen sizes.

### Hide The Keyboard Before The Next Tap

After typing into a field, Android's keyboard can cover the next field or button.

```js
await orbit.pressKey(4);
```

### Avoid `clearText()` When Possible

`clearText()` can be slow because it sends many delete events through ADB. For clean test state, prefer:

```js
await orbit.clearAppData("com.example.app");
```

### Use A Real Success Assertion

Do not assert text that is already on the login page:

```js
await expect(orbit).toHaveText("Welcome back!");
```

Instead, assert text or an ID that only appears after login:

```js
await expect(orbit).toHaveText("Good morning");
await expect(orbit).toHaveId("homePage");
```

### Check UI Dumps When Selectors Fail

```js
const nodes = await orbit.dumpUi();
console.log(nodes.map(node => ({
  text: node.text,
  id: node.resourceId,
  desc: node.contentDescription,
  bounds: node.bounds
})));
```

This helps confirm exact resource IDs and visible bounds.

### UIAutomator Can See Hidden WebView Content

In WebView apps, UIAutomator may include offscreen or zero-height nodes in the tree. `tapById()` and `waitForText()` prefer visible/enabled nodes, but hidden WebView text can still appear in raw dumps. Use screenshots and bounds to confirm what is really visible.

