// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { OrbitDevice } = require("./device");
const { captureFailureArtifacts, captureReportArtifacts } = require("./artifacts");
const { listDevices } = require("./devices");
const { doctor } = require("./doctor");
const { Key } = require("./keys");

async function createMobileContext({ config = {} } = {}) {
  const orbit = new OrbitDevice(config);
  await orbit.adbClient.resolveSerial();

  return {
    orbit,
    async close() {
      // Android state is intentionally left alone. Tests control app lifecycle.
    },
    captureFailureArtifacts,
    captureReportArtifacts
  };
}

module.exports = {
  Key,
  OrbitDevice,
  captureFailureArtifacts,
  captureReportArtifacts,
  createMobileContext,
  doctor,
  listDevices
};
