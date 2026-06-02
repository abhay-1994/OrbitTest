// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const path = require("path");

const DEFAULT_MOBILE_PROVIDER = "@orbittest/mobile";

function isMobileConfigured(config = {}) {
  return Boolean(config && typeof config === "object" && config.provider);
}

async function createMobileContext({ config, testInfo, projectRoot = process.cwd(), logger = console } = {}) {
  if (!isMobileConfigured(config)) {
    return null;
  }

  const provider = loadMobileProvider(config.provider);

  if (!provider || typeof provider.createMobileContext !== "function") {
    throw new Error(`Mobile provider "${config.provider}" must export createMobileContext().`);
  }

  const context = await provider.createMobileContext({
    config: withRuntimeMobileDefaults(config, projectRoot),
    testInfo,
    projectRoot,
    logger
  });

  if (!context || !context.orbit) {
    throw new Error(`Mobile provider "${config.provider}" did not return an orbit context.`);
  }

  return {
    provider,
    orbit: context.orbit,
    close: typeof context.close === "function" ? context.close : async () => {},
    captureFailureArtifacts: typeof context.captureFailureArtifacts === "function"
      ? context.captureFailureArtifacts
      : provider.captureFailureArtifacts,
    captureReportArtifacts: typeof context.captureReportArtifacts === "function"
      ? context.captureReportArtifacts
      : provider.captureReportArtifacts
  };
}

async function captureMobileFailureArtifacts({ mobileContext, result, error, testInfo } = {}) {
  if (!mobileContext || typeof mobileContext.captureFailureArtifacts !== "function") {
    return null;
  }

  const artifacts = await mobileContext.captureFailureArtifacts({
    orbit: mobileContext.orbit,
    result,
    error,
    testInfo
  });

  if (artifacts && result) {
    result.artifacts = {
      ...(result.artifacts || {}),
      mobile: {
        ...(result.artifacts?.mobile || {}),
        ...artifacts
      }
    };
  }

  return artifacts || null;
}

async function captureMobileReportArtifacts({ mobileContext, result, testInfo } = {}) {
  if (!mobileContext || typeof mobileContext.captureReportArtifacts !== "function") {
    return null;
  }

  const artifacts = await mobileContext.captureReportArtifacts({
    orbit: mobileContext.orbit,
    result,
    testInfo
  });

  if (artifacts && result) {
    result.artifacts = {
      ...(result.artifacts || {}),
      mobile: {
        ...(result.artifacts?.mobile || {}),
        ...artifacts
      }
    };
  }

  return artifacts || null;
}

async function closeMobileContext(mobileContext, result) {
  if (!mobileContext || typeof mobileContext.close !== "function") {
    return;
  }

  try {
    await mobileContext.close();
  } catch (error) {
    if (result && result.status !== "failed") {
      result.status = "failed";
      result.error = {
        name: error.name || "Error",
        message: `Mobile cleanup failed: ${error.message || error}`,
        stack: error.stack || ""
      };
    }
  }
}

async function listMobileDevices(config = {}, options = {}) {
  const providerName = config.provider || DEFAULT_MOBILE_PROVIDER;
  const provider = loadMobileProvider(providerName, { optional: true });

  if (!provider) {
    return {
      available: false,
      provider: providerName,
      devices: [],
      message: `Install ${providerName} to list mobile devices.`
    };
  }

  if (typeof provider.listDevices !== "function") {
    throw new Error(`Mobile provider "${providerName}" must export listDevices().`);
  }

  return {
    available: true,
    provider: providerName,
    devices: await provider.listDevices(withRuntimeMobileDefaults(config, options.projectRoot || process.cwd()))
  };
}

async function runMobileDoctor(config = {}, options = {}) {
  const providerName = config.provider || DEFAULT_MOBILE_PROVIDER;
  const provider = loadMobileProvider(providerName, { optional: true });

  if (!provider) {
    return [{
      name: "mobile provider",
      status: "warn",
      message: `${providerName} is not installed. Mobile tests are skipped unless configured.`
    }];
  }

  if (typeof provider.doctor !== "function") {
    throw new Error(`Mobile provider "${providerName}" must export doctor().`);
  }

  return provider.doctor(withRuntimeMobileDefaults(config, options.projectRoot || process.cwd()));
}

function withRuntimeMobileDefaults(config = {}, projectRoot = process.cwd()) {
  const artifactsDir = config.artifactsDir || "orbittest-results";

  return {
    ...config,
    provider: config.provider || DEFAULT_MOBILE_PROVIDER,
    platform: config.platform || "android",
    adbPath: process.env.ADB_PATH || config.adbPath || "adb",
    deviceSerial: process.env.DEVICE_SERIAL || config.deviceSerial || null,
    projectRoot: process.env.PROJECT_ROOT || projectRoot,
    artifactsDir: path.isAbsolute(artifactsDir)
      ? artifactsDir
      : path.resolve(process.env.PROJECT_ROOT || projectRoot, artifactsDir)
  };
}

function loadMobileProvider(providerName = DEFAULT_MOBILE_PROVIDER, options = {}) {
  try {
    return require(providerName);
  } catch (error) {
    const fallback = resolveWorkspaceProvider(providerName);

    if (fallback) {
      try {
        return require(fallback);
      } catch (fallbackError) {
        if (!options.optional) {
          throw createProviderLoadError(providerName, fallbackError);
        }
      }
    }

    if (options.optional) {
      return null;
    }

    throw createProviderLoadError(providerName, error);
  }
}

function resolveWorkspaceProvider(providerName) {
  if (providerName !== DEFAULT_MOBILE_PROVIDER) {
    return null;
  }

  return path.resolve(__dirname, "..", "..", "packages", "mobile");
}

function createProviderLoadError(providerName, error) {
  return new Error(
    `Mobile provider "${providerName}" could not be loaded. ` +
    `Install it with npm install ${providerName}. ${error.message || error}`
  );
}

module.exports = {
  DEFAULT_MOBILE_PROVIDER,
  captureMobileFailureArtifacts,
  captureMobileReportArtifacts,
  closeMobileContext,
  createMobileContext,
  isMobileConfigured,
  listMobileDevices,
  loadMobileProvider,
  runMobileDoctor,
  withRuntimeMobileDefaults
};
