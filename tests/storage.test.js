const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { afterAll, beforeAll, test, expect } = require("orbittest");

let server;
let baseUrl;
const stateFile = path.join(os.tmpdir(), `orbittest-storage-${process.pid}.json`);

beforeAll(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8"
    });
    response.end(`
      <!doctype html>
      <title>Storage Test</title>
      <h1>Storage Test</h1>
      <script>
        window.readAuth = () => ({
          local: localStorage.getItem("token"),
          session: sessionStorage.getItem("view"),
          cookie: document.cookie
        });
      </script>
    `);
  });

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}/`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }

  fs.rmSync(stateFile, {
    force: true
  });
});

test("Manage cookies and web storage", async orbit => {
  await orbit.open(baseUrl);

  await orbit.storage.setCookie({
    name: "auth",
    value: "abc123",
    httpOnly: true
  });
  await orbit.storage.setLocal("token", "local-token");
  await orbit.storage.setSession("view", "compact");

  const cookies = await orbit.storage.cookies();
  const authCookie = cookies.find(cookie => cookie.name === "auth");

  expect(Boolean(authCookie)).toBe(true);
  expect(authCookie.value).toBe("abc123");
  expect(authCookie.httpOnly).toBe(true);
  expect(await orbit.storage.getLocal("token")).toBe("local-token");
  expect(await orbit.storage.getSession("view")).toBe("compact");

  const local = await orbit.storage.local();
  const session = await orbit.storage.session();

  expect(local.token).toBe("local-token");
  expect(session.view).toBe("compact");

  await orbit.storage.deleteCookie("auth");
  await orbit.storage.removeLocal("token");
  await orbit.storage.removeSession("view");

  expect((await orbit.storage.cookies()).some(cookie => cookie.name === "auth")).toBe(false);
  expect(await orbit.storage.getLocal("token")).toBe(null);
  expect(await orbit.storage.getSession("view")).toBe(null);
});

test("Save and load browser session state", async orbit => {
  await orbit.open(baseUrl);

  await orbit.storage.setCookie("remember", "yes");
  await orbit.storage.setLocal("token", "saved-token");
  await orbit.storage.setSession("view", "saved-view");

  const saved = await orbit.storage.saveSession(stateFile);

  expect(fs.existsSync(saved.path)).toBe(true);
  expect(saved.cookies.some(cookie => cookie.name === "remember")).toBe(true);
  expect(saved.origins.length).toBe(1);

  await orbit.storage.clear();

  expect((await orbit.storage.cookies()).some(cookie => cookie.name === "remember")).toBe(false);
  expect(await orbit.storage.getLocal("token")).toBe(null);
  expect(await orbit.storage.getSession("view")).toBe(null);

  const loaded = await orbit.storage.loadSession(stateFile);

  expect(loaded.cookies >= 1).toBe(true);
  expect(loaded.origins.length).toBe(1);
  expect((await orbit.storage.cookies()).some(cookie => cookie.name === "remember")).toBe(true);
  expect(await orbit.storage.getLocal("token")).toBe("saved-token");
  expect(await orbit.storage.getSession("view")).toBe("saved-view");
});

test("Inspect session health without exposing secrets", async orbit => {
  await orbit.open(baseUrl);

  const token = createJwt({
    sub: "qa-user",
    exp: Math.floor(Date.now() / 1000) + 3600
  });

  await orbit.storage.setCookie({
    name: "auth_session",
    value: "cookie-secret-value",
    httpOnly: true,
    expires: Math.floor(Date.now() / 1000) + 3600
  });
  await orbit.storage.setLocal("accessToken", token);
  await orbit.storage.setSession("view", "compact");

  const inspection = await orbit.storage.inspect({
    minMinutes: 10
  });

  expect(inspection.auth.present).toBe(true);
  expect(inspection.auth.signalCount >= 2).toBe(true);
  expect(inspection.cookies.authLikeCount >= 1).toBe(true);
  expect(inspection.localStorage.authLikeCount).toBe(1);
  expect(inspection.privacy.valuesRedacted).toBe(true);
  expect(JSON.stringify(inspection).includes("cookie-secret-value")).toBe(false);
  expect(JSON.stringify(inspection).includes(token)).toBe(false);

  const healthy = await orbit.storage.expectHealthySession({
    minMinutes: 10,
    requireCookie: true,
    requireLocalStorage: true
  });

  expect(healthy.auth.present).toBe(true);

  await orbit.storage.clear();

  let failedWithHelpfulMessage = false;

  try {
    await orbit.storage.expectHealthySession();
  } catch (error) {
    failedWithHelpfulMessage = /Storage session is not healthy/.test(error.message);
  }

  expect(failedWithHelpfulMessage).toBe(true);
});

function createJwt(payload) {
  const header = {
    alg: "none",
    typ: "JWT"
  };

  return [
    base64Url(JSON.stringify(header)),
    base64Url(JSON.stringify(payload)),
    "signature"
  ].join(".");
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
