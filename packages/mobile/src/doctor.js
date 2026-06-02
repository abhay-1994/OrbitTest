// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { AdbClient, listAdbDevices } = require("./adb");
const { OrbitDevice } = require("./device");

async function doctor(config = {}) {
  const checks = [];
  const adbPath = config.adbPath || process.env.ADB_PATH || "adb";

  checks.push({
    name: "mobile provider",
    status: "ok",
    message: "@orbittest/mobile loaded"
  });

  let devices = [];

  try {
    devices = await listAdbDevices({ adbPath });
    checks.push({
      name: "adb",
      status: "ok",
      message: `${adbPath} available`
    });
  } catch (error) {
    checks.push({
      name: "adb",
      status: "fail",
      message: error.message || String(error)
    });
    return checks;
  }

  const unauthorized = devices.filter(device => device.state === "unauthorized");
  if (unauthorized.length > 0) {
    checks.push({
      name: "unauthorized devices",
      status: "fail",
      message: unauthorized.map(device => device.serial).join(", ")
    });
  }

  const online = selectOnlineDevice(devices, config.deviceSerial);
  if (!online) {
    checks.push({
      name: "connected device",
      status: "fail",
      message: devices.length ? `No online device. States: ${devices.map(device => `${device.serial}:${device.state}`).join(", ")}` : "No Android devices found"
    });
    return checks;
  }

  checks.push({
    name: "connected device",
    status: "ok",
    message: `${online.serial}${online.model ? ` ${online.model}` : ""}`
  });

  const client = new AdbClient({
    adbPath,
    deviceSerial: online.serial
  });
  const orbit = new OrbitDevice({
    ...config,
    adbPath,
    deviceSerial: online.serial
  });

  await checkShell(checks, "android version", () => client.shell(["getprop", "ro.build.version.release"]));
  await checkShell(checks, "uiautomator dump", () => orbit.dumpUiXml());
  await checkShell(checks, "screenshot", () => orbit.screenshot());

  if (config.appPackage) {
    await checkShell(checks, "configured app package", async () => {
      const installed = await orbit.isAppInstalled(config.appPackage);
      if (!installed) {
        throw new Error(`${config.appPackage} is not installed`);
      }
      return "installed";
    });
  }

  return checks;
}

function selectOnlineDevice(devices, serial) {
  if (serial) {
    return devices.find(device => device.serial === serial && device.state === "device") || null;
  }

  return devices.find(device => device.state === "device") || null;
}

async function checkShell(checks, name, fn) {
  try {
    const output = await fn();
    checks.push({
      name,
      status: "ok",
      message: formatDoctorOutput(output)
    });
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      message: error.message || String(error)
    });
  }
}

function formatDoctorOutput(output) {
  if (Buffer.isBuffer(output)) {
    return `${output.length} bytes`;
  }

  const text = String(output || "").trim();

  if (!text) {
    return "ok";
  }

  const firstLine = text.split(/\r?\n/)[0];

  if (firstLine.length > 120) {
    return `${text.length} chars`;
  }

  return firstLine;
}

module.exports = { doctor };
