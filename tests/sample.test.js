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

test("Read page title and URL", async (orbit) => {
  const html = `<title>Orbit Sample Page</title><main><h1>Title URL ready</h1></main>`;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const page = await orbit.pageState();

  expect(await orbit.title()).toBe("Orbit Sample Page");
  expect(await orbit.url()).toContain("data:text/html");
  expect(page.title).toBe("Orbit Sample Page");
  expect(page.url).toContain("data:text/html");
});

test("Iterate over all matched elements", async (orbit) => {
  const html = `
    <button data-id="alpha">Alpha</button>
    <button data-id="beta">Beta</button>
    <button data-id="gamma">Gamma</button>
    <script>
      const clicked = [];

      document.querySelectorAll("button").forEach(button => {
        button.addEventListener("click", () => {
          clicked.push(button.getAttribute("data-id"));
          document.body.setAttribute("data-clicked", clicked.join(","));
        });
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const buttons = await orbit.all(orbit.css("button"));
  const labels = [];

  expect(buttons.length).toBe(3);

  for (const button of buttons) {
    labels.push(await orbit.text(button));
    await orbit.click(button);
  }

  expect(labels.map(label => label.split(/\s+/)[0]).join(",")).toBe("Alpha,Beta,Gamma");
  expect(await orbit.exists(orbit.getByAttribute("data-clicked", "alpha,beta,gamma"))).toBe(true);
});

test("Prefer the most actionable visible text match", async (orbit) => {
  const html = `
    <section id="wrapper">
      <div>Save</div>
      <button id="save">Save</button>
      <button id="cancel">Cancel</button>
    </section>
    <script>
      document.querySelector("#save").addEventListener("click", () => {
        document.body.setAttribute("data-clicked", "save");
      });
      document.querySelector("#cancel").addEventListener("click", () => {
        document.body.setAttribute("data-clicked", "cancel");
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);
  await orbit.click("Save");

  expect(await orbit.exists(orbit.getByAttribute("data-clicked", "save"))).toBe(true);
  expect(await orbit.text(orbit.css("#save"))).toBe("Save");
  expect(await orbit.text(orbit.nth(orbit.css("button"), 1))).toBe("Cancel");
});
