const { test, expect } = require("orbittest");

test("Mobile device smoke", { timeout: 60000 }, async ({ orbit }) => {
  expect(Boolean(orbit)).toBe(true);
  expect(orbit.__orbittestMobile).toBe(true);

  await orbit.wakeUp();
  expect(await orbit.isScreenOn()).toBe(true);

  const model = await orbit.getModel();
  const androidVersion = await orbit.getAndroidVersion();
  const screenSize = await orbit.getScreenSize();

  expect(Boolean(model)).toBe(true);
  expect(Boolean(androidVersion)).toBe(true);
  expect(screenSize.width > 0).toBe(true);
  expect(screenSize.height > 0).toBe(true);

  const nodes = await orbit.dumpUi();
  expect(nodes.length > 0).toBe(true);

  await orbit.saveScreenshot("reports/mobile-smoke.png");
});
