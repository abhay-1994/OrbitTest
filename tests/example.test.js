const { test, expect } = require("orbittest");

test("Login flow", async (orbit) => {
  const html = `
    <main>
      <h1>Login</h1>
      <label>Username <input name="username" autocomplete="username"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password"></label>
      <button type="submit">Login</button>
      <section id="dashboard" hidden>
        <h2>Dashboard</h2>
        <button>Upgrade</button>
      </section>
    </main>
    <script>
      document.querySelector("button[type='submit']").addEventListener("click", () => {
        const username = document.querySelector("[name='username']").value;
        const password = document.querySelector("[name='password']").value;

        if (username === "Admin" && password === "admin123") {
          document.querySelector("#dashboard").hidden = false;
          document.body.setAttribute("data-login", "success");
        }
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);
  await orbit.type("Username", "Admin");
  await orbit.type("Password", "admin123");

  await orbit.click(orbit.css("button[type='submit']"));

  await orbit.waitForText("Dashboard", { timeout: 3000 });
  expect(await orbit.exists("Dashboard")).toBe(true);
  expect(await orbit.exists(orbit.getByAttribute("data-login", "success"))).toBe(true);
  await orbit.click(orbit.xpath("//button[text()='Upgrade']"));
});
