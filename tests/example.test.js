const { test, expect } = require("orbittest");

test("Login flow", async (orbit) => {
  await orbit.open("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login");
  await orbit.type("Username", "Admin");
  await orbit.type("Password", "admin123");

  await orbit.click(orbit.css("button[type='submit']"));

  await orbit.waitForText("Dashboard", { timeout: 15000 });
  expect(await orbit.exists("Dashboard")).toBe(true);
  await orbit.click(orbit.xpath("//button[text()=' Upgrade']"))
});
