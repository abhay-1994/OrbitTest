const { test, expect, run } = require('orbittest');

test("Use multiple locator types", async (orbit) => {
  const html = `
    <label>Email <input name="email" data-testid="email-input"></label>
    <button id="login" data-testid="login-button">Login</button>
    <a href="#docs" aria-label="Docs link">Docs</a>
    <h1>Welcome</h1>
    <script>
      setTimeout(() => {
        const status = document.createElement("p");
        status.className = "ready";
        status.textContent = "Loaded later";
        document.body.appendChild(status);
      }, 150);

      document.querySelector("#login").addEventListener("click", () => {
        document.body.setAttribute("data-clicked", "yes");
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  await orbit.type(orbit.css("[name='email']"), "user@example.com");
  expect(await orbit.exists(orbit.xpath("//button[@id='login']"))).toBe(true);
  expect(await orbit.text(orbit.getByRole("heading", "Welcome"))).toContain("Welcome");
  expect(await orbit.exists(orbit.getByAttribute("data-testid", "login-button"))).toBe(true);

  await orbit.waitFor(orbit.css(".ready"), { timeout: 2000 });
  await orbit.waitForText("Loaded later", 2000);

  await orbit.click(orbit.getByRole("button", "Login"));
  expect(await orbit.exists(orbit.getByAttribute("data-clicked", "yes"))).toBe(true);
});

run();
