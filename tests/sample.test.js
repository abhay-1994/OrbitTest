const { test, expect, run } = require('orbittest');

test("Click Login", async (orbit) => {
  await orbit.open("https://bug-orbit.vercel.app/");
  expect(await orbit.hasText("Login")).toBe(true);
  await orbit.click("Login");
});

run();
