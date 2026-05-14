const { test, expect } = require("orbittest");

test("PinThing WebGL visual smoke", async (orbit) => {
  await orbit.open("https://www.pinthing.com/");

  expect(await orbit.title()).toBe("PinThing Demo");
  expect(await orbit.exists(orbit.css("canvas"), { timeout: 10000 })).toBe(true);

  await orbit.wait(1200);
  const displayedTime = await orbit.evaluate(() => {
    const now = new Date();
    const hour = now.getHours() % 12 || 12;
    const minute = now.getMinutes().toString().padStart(2, "0");

    return `${hour}:${minute}`;
  });
  console.log("PinThing displayed time:", displayedTime);

  await orbit.evaluate(() => window.stopClock && window.stopClock());
  await orbit.visual.waitForStable({ timeout: 10000, interval: 400, stableFrames: 1 });

  const redPin = await orbit.visual.findColor("#df1f1f", {
    tolerance: 70,
    step: 5
  });
  expect(Boolean(redPin)).toBe(true);

  const changedDown = await orbit.visual.changed(async () => {
    await orbit.evaluate(() => window.pinthing.down());
    await orbit.wait(1200);
  }, { wait: 300 });
  expect(changedDown).toBe(true);

  const downState = await orbit.evaluate(() => window.positions2String());
  expect((downState.match(/1/g) || []).length).toBe(0);

  const changedUp = await orbit.visual.changed(async () => {
    await orbit.evaluate(() => window.pinthing.up());
    await orbit.wait(1200);
  }, { wait: 300 });
  expect(changedUp).toBe(true);

  const upState = await orbit.evaluate(() => window.positions2String());
  expect((upState.match(/1/g) || []).length).toBe(75);

  await orbit.visual.snapshot("reports/pinthing-visual-smoke.png");
});
