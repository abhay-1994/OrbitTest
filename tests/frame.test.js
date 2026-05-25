const { test, expect } = require("orbittest");

test("Work inside a frame", async (orbit) => {
  const frameHtml = `
    <main>
      <h1>Billing Frame</h1>
      <label>Email <input name="email"></label>
      <button id="save">Save billing</button>
      <script>
        document.querySelector("#save").addEventListener("click", () => {
          document.body.setAttribute("data-saved", document.querySelector("[name='email']").value);
        });
      </script>
    </main>
  `;
  const html = `
    <main>
      <h1>Host Page</h1>
      <iframe title="Billing" srcdoc="${escapeAttribute(frameHtml)}"></iframe>
    </main>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const billing = await orbit.frame(orbit.getByAttribute("title", "Billing"));

  expect(await billing.hasText("Billing Frame")).toBe(true);
  await billing.type("Email", "team@example.test");
  await billing.click("Save billing");

  expect(await billing.exists(orbit.getByAttribute("data-saved", "team@example.test"))).toBe(true);
  expect(await billing.text(orbit.getByRole("heading", "Billing Frame"))).toContain("Billing Frame");
});

test("Work inside nested frames", async (orbit) => {
  const innerHtml = `
    <main>
      <h1>Vault Frame</h1>
      <label>Token <input name="token"></label>
      <button id="approve">Approve</button>
      <script>
        document.querySelector("#approve").addEventListener("click", () => {
          const token = document.querySelector("[name='token']").value;
          document.body.setAttribute("data-approved", token);
          document.querySelector("#status").textContent = "Approved " + token;
        });
      </script>
      <p id="status">Waiting</p>
    </main>
  `;
  const outerHtml = `
    <main>
      <h1>Checkout Frame</h1>
      <iframe title="Vault" srcdoc="${escapeAttribute(innerHtml)}"></iframe>
    </main>
  `;
  const html = `
    <main>
      <h1>Host Page</h1>
      <iframe title="Checkout" srcdoc="${escapeAttribute(outerHtml)}"></iframe>
    </main>
  `;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  const vault = await orbit.frame([
    orbit.getByAttribute("title", "Checkout"),
    orbit.getByAttribute("title", "Vault")
  ]);

  await vault.type("Token", "abc123");
  await vault.click("Approve");

  expect(await vault.exists(orbit.getByAttribute("data-approved", "abc123"))).toBe(true);
  expect(await vault.text(orbit.css("#status"))).toBe("Approved abc123");

  const checkout = await orbit.frame(orbit.getByAttribute("title", "Checkout"));
  const nestedVault = await checkout.frame(orbit.getByAttribute("title", "Vault"));

  expect(await nestedVault.hasText("Vault Frame")).toBe(true);
});

test("Run a callback inside a frame", async (orbit) => {
  const frameHtml = `
    <main>
      <button id="ready">Ready</button>
      <script>
        document.querySelector("#ready").addEventListener("click", () => {
          document.body.setAttribute("data-ready", "yes");
        });
      </script>
    </main>
  `;
  const html = `<iframe title="Panel" srcdoc="${escapeAttribute(frameHtml)}"></iframe>`;

  await orbit.open(`data:text/html,${encodeURIComponent(html)}`);

  await orbit.withFrame(orbit.getByAttribute("title", "Panel"), async frame => {
    await frame.click("Ready");
    expect(await frame.exists(orbit.getByAttribute("data-ready", "yes"))).toBe(true);
  });
});

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
