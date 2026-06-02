// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

let execaPromise = null;

class AdbClient {
  constructor(config = {}) {
    this.adbPath = config.adbPath || process.env.ADB_PATH || "adb";
    this.deviceSerial = config.deviceSerial || process.env.DEVICE_SERIAL || null;
    this.timeoutMs = config.adbTimeoutMs || 30000;
  }

  async resolveSerial() {
    if (this.deviceSerial) {
      return this.deviceSerial;
    }

    const devices = await listAdbDevices({ adbPath: this.adbPath });
    const online = devices.find(device => device.state === "device");

    if (!online) {
      const states = devices.map(device => `${device.serial}:${device.state}`).join(", ") || "none";
      throw new Error(`No online Android device found. ADB devices: ${states}`);
    }

    this.deviceSerial = online.serial;
    return this.deviceSerial;
  }

  async adb(args, options = {}) {
    const serial = await this.resolveSerial();
    return runAdb({
      adbPath: this.adbPath,
      args: ["-s", serial, ...args],
      serial,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      encoding: options.encoding
    });
  }

  async shell(command, options = {}) {
    if (Array.isArray(command)) {
      return this.adb(["shell", ...command], options);
    }

    return this.adb(["shell", "sh", "-c", String(command)], options);
  }
}

async function runAdb({ adbPath = "adb", args = [], serial = null, timeoutMs = 30000, encoding = "utf8" } = {}) {
  const execa = await loadExeca();

  try {
    const result = await execa(adbPath, args, {
      timeout: timeoutMs,
      encoding,
      all: false,
      reject: true
    });

    return result.stdout;
  } catch (error) {
    throw formatAdbError({ adbPath, args, serial, error });
  }
}

async function listAdbDevices({ adbPath = "adb", timeoutMs = 10000 } = {}) {
  const output = await runAdb({
    adbPath,
    args: ["devices", "-l"],
    timeoutMs
  });

  return parseAdbDevices(output);
}

function parseAdbDevices(output) {
  return String(output || "")
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split(/\s+/);
      const serial = parts[0];
      const state = parts[1] || "unknown";
      const details = {};

      for (const part of parts.slice(2)) {
        const index = part.indexOf(":");
        if (index > 0) {
          details[part.slice(0, index)] = part.slice(index + 1);
        }
      }

      return {
        serial,
        state,
        model: details.model || "",
        product: details.product || "",
        device: details.device || "",
        transportId: details.transport_id || ""
      };
    });
}

async function loadExeca() {
  if (!execaPromise) {
    execaPromise = import("execa").then(mod => mod.execa || mod.default || mod);
  }

  return execaPromise;
}

function formatAdbError({ adbPath, args, serial, error }) {
  const stdout = bufferOrString(error.stdout);
  const stderr = bufferOrString(error.stderr);
  const command = `${adbPath} ${args.join(" ")}`;
  const message = [
    `ADB command failed: ${command}`,
    `Device serial: ${serial || "not selected"}`,
    error.shortMessage || error.message || String(error),
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null
  ].filter(Boolean).join("\n");

  const wrapped = new Error(message);
  wrapped.cause = error;
  wrapped.stdout = stdout;
  wrapped.stderr = stderr;
  wrapped.command = command;
  wrapped.deviceSerial = serial || null;
  return wrapped;
}

function bufferOrString(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return value ? String(value) : "";
}

module.exports = {
  AdbClient,
  listAdbDevices,
  parseAdbDevices,
  runAdb
};
