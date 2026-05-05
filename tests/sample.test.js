const { afterEach, beforeEach, test, expect } = require('orbittest');

beforeEach(async (orbit, testInfo) => {
  expect(testInfo.name).toBeTruthy();
});

afterEach(async (orbit, testInfo) => {
  expect(testInfo.file).toBeTruthy();
});

test("Use multiple locator types", async (orbit) => {
  const html = `
    <label>Email <input name="email" data-testid="email-input"></label>
    <button id="login" data-testid="login-button">Login</button>
    <button id="hover-target" data-testid="hover-button">Hover me</button>
    <button id="double-target" data-testid="double-button">Double me</button>
    <button id="right-target" data-testid="right-button">Right click me</button>
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

      document.querySelector("[name='email']").addEventListener("input", (event) => {
        document.body.setAttribute("data-typed", event.target.value);
      });

      document.querySelector("#hover-target").addEventListener("mouseover", () => {
        document.body.setAttribute("data-hovered", "yes");
      });

      document.querySelector("#double-target").addEventListener("dblclick", () => {
        document.body.setAttribute("data-double-clicked", "yes");
      });

      document.querySelector("#right-target").addEventListener("contextmenu", (event) => {
        event.preventDefault();
        document.body.setAttribute("data-right-clicked", "yes");
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  await orbit.type(orbit.css("[name='email']"), "user@example.com");
  expect(await orbit.exists(orbit.getByAttribute("data-typed", "user@example.com"))).toBe(true);
  expect(await orbit.exists(orbit.xpath("//button[@id='login']"))).toBe(true);
  expect(await orbit.text(orbit.getByRole("heading", "Welcome"))).toContain("Welcome");
  expect(await orbit.exists(orbit.getByAttribute("data-testid", "login-button"))).toBe(true);

  await orbit.waitForText("Loaded later", 2000);
  await orbit.waitFor(orbit.css(".ready"), { timeout: 2000 });

  await orbit.click(orbit.getByRole("button", "Login"));
  expect(await orbit.exists(orbit.getByAttribute("data-clicked", "yes"))).toBe(true);

  await orbit.hover(orbit.getByAttribute("data-testid", "hover-button"));
  expect(await orbit.exists(orbit.getByAttribute("data-hovered", "yes"))).toBe(true);

  await orbit.doubleClick(orbit.getByAttribute("data-testid", "double-button"));
  expect(await orbit.exists(orbit.getByAttribute("data-double-clicked", "yes"))).toBe(true);

  await orbit.rightClick(orbit.getByAttribute("data-testid", "right-button"));
  expect(await orbit.exists(orbit.getByAttribute("data-right-clicked", "yes"))).toBe(true);
});

test("Open an isolated page", { retries: 1, timeout: 10000 }, async (orbit) => {
  const html = `<main><h1>Second test ready</h1></main>`;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  expect(await orbit.hasText("Second test ready")).toBe(true);
});
