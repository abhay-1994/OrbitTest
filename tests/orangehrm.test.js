const { test, expect } = require("orbittest");

test("OrangeHRM login and dashboard", async (orbit) => {
    await orbit.open("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login");
  await orbit.type("Username", "Admin");
  await orbit.type("Password", "admin123");
  await orbit.click(orbit.css("button[type='submit']"));    
})