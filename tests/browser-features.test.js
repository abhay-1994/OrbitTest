const http = require("http");
const { test, expect } = require("orbittest");

test("Handle alerts, prompts, confirms, and direct dialog handling", async (orbit) => {
  const html = `
    <button onclick="alert('hello')">Alert</button>
    <button onclick="document.body.setAttribute('data-prompt', prompt('Name?', 'guest') || '')">Prompt</button>
    <button onclick="document.body.setAttribute('data-confirm', confirm('Continue?') ? 'yes' : 'no')">Confirm</button>
    <button onclick="document.body.setAttribute('data-direct', confirm('Handle directly?') ? 'yes' : 'no')">Direct Handle</button>
  `;

  await orbit.open(dataPage(html));

  await orbit.click("Alert");
  const alert = await orbit.waitForAlert({ timeout: 3000 });
  expect(alert.type).toBe("alert");
  expect(alert.message).toBe("hello");
  expect(await orbit.alertText()).toBe("hello");

  const accepted = await orbit.acceptAlert();
  expect(accepted.handled).toBe(true);
  expect(accepted.handledBy).toBe("acceptAlert");

  await orbit.click("Prompt");
  expect(await orbit.alertText()).toBe("Name?");
  await orbit.acceptAlert({ promptText: "Abhay" });
  expect(await orbit.exists(orbit.getByAttribute("data-prompt", "Abhay"))).toBe(true);

  await orbit.click("Confirm");
  const dismissed = await orbit.dismissAlert();
  expect(dismissed.handled).toBe(true);
  expect(dismissed.handledBy).toBe("dismissAlert");
  expect(await orbit.exists(orbit.getByAttribute("data-confirm", "no"))).toBe(true);

  await orbit.click("Direct Handle");
  const handled = await orbit.handleAlert({ accept: false });
  expect(handled.message).toBe("Handle directly?");
  expect(handled.handled).toBe(true);
  expect(await orbit.exists(orbit.getByAttribute("data-direct", "no"))).toBe(true);
});

test("Override notification permissions", async (orbit) => {
  const server = await startServer("<h1>Notifications</h1>");

  try {
    await orbit.open(server.origin);
    expect(await orbit.getNotificationPermission()).toBe("default");

    const granted = await orbit.grantNotifications();
    expect(granted.origin).toBe(server.origin);
    expect(granted.permission).toBe("granted");
    expect(await orbit.getNotificationPermission()).toBe("granted");

    const denied = await orbit.denyNotifications(`${server.origin}/settings`);
    expect(denied.origin).toBe(server.origin);
    expect(denied.permission).toBe("denied");
    expect(await orbit.getNotificationPermission()).toBe("denied");

    const reset = await orbit.resetNotificationPermission({ origin: server.origin });
    expect(reset.origin).toBe(server.origin);
    expect(reset.permission).toBe("default");
    expect(await orbit.getNotificationPermission()).toBe("default");
  } finally {
    await closeServer(server.instance);
  }
});

test("Manage windows and tabs", async (orbit) => {
  const mainHtml = `
    <title>Main Window</title>
    <h1>Main Window</h1>
    <button onclick="window.open('about:blank', '_blank')">Open Popup</button>
  `;

  await orbit.open(dataPage(mainHtml));

  const initialWindows = await orbit.listWindows();
  expect(initialWindows.length).toBe(1);
  expect(initialWindows[0].active).toBe(true);
  expect((await orbit.windows()).length).toBe(1);

  const created = await orbit.newWindow(dataPage("<title>Created Tab</title><h1>Created Tab</h1>"));
  expect(created.id).toBeTruthy();
  await orbit.waitForText("Created Tab", { timeout: 5000 });

  const afterNewWindow = await orbit.listWindows();
  expect(afterNewWindow.length).toBe(2);
  expect(afterNewWindow.some(window => window.id === created.id && window.active)).toBe(true);

  await orbit.switchToWindow(0);
  expect(await orbit.hasText("Main Window")).toBe(true);

  await orbit.closeWindow(created.id);
  expect((await waitForWindowCount(orbit, 1)).length).toBe(1);

  await orbit.click("Open Popup");
  const popup = await orbit.waitForWindow({ switchTo: true, timeout: 5000 });
  expect(popup.id).toBeTruthy();

  await orbit.open(dataPage("<title>Popup Tab</title><h1>Popup Tab</h1>"));
  expect(await orbit.hasText("Popup Tab")).toBe(true);

  await orbit.switchToWindow(0);
  expect(await orbit.hasText("Main Window")).toBe(true);

  await orbit.switchToWindow(popup.id);
  await orbit.closeWindow();
  expect((await waitForWindowCount(orbit, 1)).length).toBe(1);
  expect(await orbit.hasText("Main Window")).toBe(true);
});

function dataPage(html) {
  return `data:text/html,${encodeURIComponent(html)}`;
}

function startServer(html) {
  const instance = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>${html}`);
  });

  return new Promise(resolve => {
    instance.listen(0, "127.0.0.1", () => {
      resolve({
        instance,
        origin: `http://127.0.0.1:${instance.address().port}`
      });
    });
  });
}

function closeServer(instance) {
  return new Promise(resolve => {
    instance.close(resolve);
  });
}

async function waitForWindowCount(orbit, count, timeoutMs = 3000) {
  const startedAt = Date.now();
  let windows = [];

  while (Date.now() - startedAt < timeoutMs) {
    windows = await orbit.listWindows();

    if (windows.length === count) {
      return windows;
    }

    await delay(100);
  }

  throw new Error(`Expected ${count} window(s), found ${windows.length}.`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
