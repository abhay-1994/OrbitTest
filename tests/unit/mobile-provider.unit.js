const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const rootPackage = require("../../package.json");
const { parseAdbDevices } = require("../../packages/mobile/src/adb");
const { findNodeWithRetry } = require("../../packages/mobile/src/selectors");
const { UI_DUMP_PATH, dumpUiXml, parseBounds, parseUiXml } = require("../../packages/mobile/src/uiautomator");

describe("@orbittest/mobile parser foundation", () => {
  it("parses adb devices output", () => {
    const devices = parseAdbDevices(`List of devices attached
emulator-5554 device product:sdk model:Pixel_8 device:emu transport_id:1
abc unauthorized transport_id:2
`);

    assert.equal(devices.length, 2);
    assert.equal(devices[0].serial, "emulator-5554");
    assert.equal(devices[0].state, "device");
    assert.equal(devices[0].model, "Pixel_8");
    assert.equal(devices[1].state, "unauthorized");
  });

  it("parses UIAutomator XML into flat nodes", () => {
    const nodes = parseUiXml(`<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node text="Login" resource-id="com.app:id/login" class="android.widget.Button" package="com.app" content-desc="Sign in" clickable="true" enabled="true" bounds="[10,20][110,70]" />
</hierarchy>`);

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].text, "Login");
    assert.equal(nodes[0].resourceId, "com.app:id/login");
    assert.deepEqual(nodes[0].center, { x: 60, y: 45 });
  });

  it("parses bounds", () => {
    assert.deepEqual(parseBounds("[1,2][101,202]"), {
      left: 1,
      top: 2,
      right: 101,
      bottom: 202
    });
  });

  it("retries a transient UIAutomator process kill", async () => {
    let dumpAttempts = 0;
    const adb = {
      async shell(args) {
        if (args[0] === "uiautomator") {
          dumpAttempts += 1;

          if (dumpAttempts === 1) {
            const error = new Error("Command failed with exit code 137");
            error.cause = { exitCode: 137 };
            throw error;
          }

          assert.deepEqual(args, ["uiautomator", "dump", UI_DUMP_PATH]);
        }
      },
      async adb(args) {
        assert.deepEqual(args, ["exec-out", "cat", UI_DUMP_PATH]);
        return `<hierarchy rotation="0">
  <node text="Login" resource-id="loginUsername" class="android.widget.EditText" enabled="true" bounds="[10,20][110,70]" />
</hierarchy>`;
      }
    };

    const xml = await dumpUiXml(adb);

    assert.equal(dumpAttempts, 2);
    assert.match(xml, /loginUsername/);
  });

  it("keeps searching when one hierarchy dump fails", async () => {
    let calls = 0;
    const node = await findNodeWithRetry({
      async dumpUi() {
        calls += 1;

        if (calls === 1) {
          throw new Error("Unable to dump Android UI hierarchy after retries.");
        }

        return [{
          resourceId: "loginUsername",
          enabled: true,
          clickable: false,
          bounds: {
            left: 10,
            top: 20,
            right: 110,
            bottom: 70
          },
          center: {
            x: 60,
            y: 45
          }
        }];
      },
      matcher: item => item.resourceId === "loginUsername",
      description: 'resource id "loginUsername"',
      timeoutMs: 100,
      intervalMs: 1
    });

    assert.equal(calls, 2);
    assert.equal(node.resourceId, "loginUsername");
  });

  it("keeps the root mobile export publishable", () => {
    assert.ok(rootPackage.files.includes("packages/mobile"));

    for (const dependency of [
      "debug",
      "execa",
      "fast-xml-parser",
      "get-port",
      "p-limit",
      "pixelmatch",
      "pngjs"
    ]) {
      assert.ok(
        rootPackage.dependencies[dependency],
        `${dependency} must be a root dependency because the bundled mobile provider resolves from orbittest/packages/mobile.`
      );
    }

    const mobile = require("../../mobile");

    assert.equal(mobile.Key.BACK, 4);
    assert.equal(typeof mobile.test, "function");
  });
});
