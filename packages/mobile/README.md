# @orbittest/mobile

Android mobile automation provider for OrbitTest.

This package uses ADB and Android UIAutomator directly. It does not use Appium,
WebdriverIO, Detox, Maestro, or Playwright mobile.

## Install

```bash
npm install orbittest @orbittest/mobile
```

Configure OrbitTest:

```js
module.exports = {
  use: {
    mobile: {
      provider: "@orbittest/mobile",
      platform: "android",
      adbPath: process.env.ADB_PATH || "adb",
      deviceSerial: process.env.DEVICE_SERIAL,
      apk: "./app.apk",
      appPackage: "com.myapp",
      appActivity: ".MainActivity",
      artifactsDir: "orbittest-results"
    }
  }
};
```

## Example

```js
const { test, expect } = require("orbittest");

test("mobile smoke test", async ({ orbit }) => {
  await orbit.wakeUp();
  await orbit.installApp();
  await orbit.launchApp();
  await orbit.waitForText("Login", 10000);
  await expect(orbit).toHaveText("Login");
});
```

## Desktop Integration

OrbitTest Desktop can inject `DEVICE_SERIAL`, `ADB_PATH`, and `PROJECT_ROOT`.
`DEVICE_SERIAL` is used automatically. If it is not present, the first online
ADB device is selected.

Run diagnostics:

```bash
npx orbittest devices
npx orbittest doctor
```
