// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { AdbClient, listAdbDevices } = require("./adb");

async function listDevices(config = {}) {
  const adbPath = config.adbPath || process.env.ADB_PATH || "adb";
  const devices = await listAdbDevices({ adbPath });

  return Promise.all(devices.map(async device => {
    if (device.state !== "device") {
      return {
        ...device,
        androidVersion: ""
      };
    }

    const client = new AdbClient({
      adbPath,
      deviceSerial: device.serial
    });

    return {
      ...device,
      model: device.model || await safeShell(client, ["getprop", "ro.product.model"]),
      androidVersion: await safeShell(client, ["getprop", "ro.build.version.release"])
    };
  }));
}

async function safeShell(client, command) {
  try {
    return (await client.shell(command, { timeoutMs: 5000 })).trim();
  } catch (error) {
    return "";
  }
}

module.exports = { listDevices };
