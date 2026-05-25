const { test, expect } = require("orbittest");

test("Work inside an open shadow root", async (orbit) => {
  const html = `
    <open-profile></open-profile>
    <script>
      customElements.define("open-profile", class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "open" });
          root.innerHTML = \`
            <main>
              <h1>Open Profile</h1>
              <label>Email <input name="email"></label>
              <button id="save">Save Open</button>
              <p id="status">Waiting</p>
            </main>
          \`;

          root.querySelector("#save").addEventListener("click", () => {
            const email = root.querySelector("[name='email']").value;
            this.setAttribute("data-saved", email);
            root.querySelector("#status").textContent = "Saved " + email;
          });
        }
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const profile = await orbit.shadow(orbit.css("open-profile"));

  expect(await profile.hasText("Open Profile")).toBe(true);
  await profile.type("Email", "open@example.test");
  await profile.click("Save Open");

  expect(await orbit.exists(orbit.getByAttribute("data-saved", "open@example.test"))).toBe(true);
  expect(await profile.text(orbit.css("#status"))).toBe("Saved open@example.test");
});

test("Work inside a closed shadow root", async (orbit) => {
  const html = `
    <closed-vault></closed-vault>
    <script>
      customElements.define("closed-vault", class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "closed" });
          root.innerHTML = \`
            <main>
              <h1>Closed Vault</h1>
              <label>Code <input name="code"></label>
              <button id="unlock">Unlock</button>
              <p id="status">Locked</p>
            </main>
          \`;

          root.querySelector("#unlock").addEventListener("click", () => {
            const code = root.querySelector("[name='code']").value;
            this.setAttribute("data-unlocked", code);
            root.querySelector("#status").textContent = "Unlocked " + code;
          });
        }
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  expect(await orbit.evaluate(() => document.querySelector("closed-vault").shadowRoot === null)).toBe(true);

  const vault = await orbit.shadow(orbit.css("closed-vault"));

  await vault.type("Code", "777");
  await vault.click("Unlock");

  expect(await orbit.exists(orbit.getByAttribute("data-unlocked", "777"))).toBe(true);
  expect(await vault.text(orbit.css("#status"))).toBe("Unlocked 777");
  expect(await vault.evaluate(root => root.querySelector("#status").textContent)).toBe("Unlocked 777");
});

test("Work inside nested shadow roots", async (orbit) => {
  const html = `
    <outer-shell></outer-shell>
    <script>
      customElements.define("inner-panel", class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "closed" });
          root.innerHTML = \`
            <main>
              <h1>Inner Panel</h1>
              <button id="approve">Approve</button>
              <p id="status">Pending</p>
            </main>
          \`;

          root.querySelector("#approve").addEventListener("click", () => {
            this.setAttribute("data-approved", "yes");
            root.querySelector("#status").textContent = "Approved";
          });
        }
      });

      customElements.define("outer-shell", class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "closed" });
          root.innerHTML = \`
            <section>
              <h1>Outer Shell</h1>
              <inner-panel></inner-panel>
            </section>
          \`;
        }
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const panel = await orbit.shadow([
    orbit.css("outer-shell"),
    orbit.css("inner-panel")
  ]);

  expect(await panel.hasText("Inner Panel")).toBe(true);
  await panel.click("Approve");
  expect(await panel.text(orbit.css("#status"))).toBe("Approved");

  const shell = await orbit.shadow(orbit.css("outer-shell"));
  const nestedPanel = await shell.shadow(orbit.css("inner-panel"));

  expect(await shell.exists(orbit.getByAttribute("data-approved", "yes"))).toBe(true);
  expect(await nestedPanel.text(orbit.css("#status"))).toBe("Approved");
});

test("Run a callback inside a shadow root", async (orbit) => {
  const html = `
    <action-card></action-card>
    <script>
      customElements.define("action-card", class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "open" });
          root.innerHTML = '<button>Ready</button>';
          root.querySelector("button").addEventListener("click", () => {
            this.setAttribute("data-ready", "yes");
          });
        }
      });
    </script>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  await orbit.withShadow(orbit.css("action-card"), async shadow => {
    await shadow.click("Ready");
    expect(await orbit.exists(orbit.getByAttribute("data-ready", "yes"))).toBe(true);
  });
});
