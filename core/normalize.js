// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function normalizeBrowserDisplay(value) {
  return value === 'hide' ? 'hide' : 'show';
}

function normalizeViewportOptions(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const width = Number(value.width);
  const height = Number(value.height);
  const deviceScaleFactor = Number(value.deviceScaleFactor ?? 1);

  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
    return null;
  }

  return {
    width: Math.floor(width),
    height: Math.floor(height),
    deviceScaleFactor: Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1
  };
}

function normalizeTimeoutOption(options = {}, fallback = 5000) {
  if (typeof options === 'number' || typeof options === 'string') {
    return normalizeNonNegativeInteger(options, fallback);
  }

  if (!options || typeof options !== 'object') {
    return fallback;
  }

  return normalizeNonNegativeInteger(options.timeout ?? options.timeoutMs, fallback);
}

function normalizeAlertOptions(options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const commandTimeout = normalizeNonNegativeInteger(
    source.commandTimeout ?? source.commandTimeoutMs ?? source.handleTimeout ?? source.handleTimeoutMs,
    5000
  );

  return {
    accept: source.accept !== false,
    timeout: normalizeTimeoutOption(options, 5000),
    commandTimeout,
    ...(source.promptText !== undefined ? { promptText: source.promptText } : {})
  };
}

function normalizePermissionOptions(originOrOptions = {}) {
  if (typeof originOrOptions === 'string' || isUrlLike(originOrOptions)) {
    return {
      origin: normalizeOrigin(originOrOptions),
      browserContextId: null,
      timeout: 5000
    };
  }

  const source = originOrOptions && typeof originOrOptions === 'object'
    ? originOrOptions
    : {};

  return {
    origin: normalizeOrigin(source.origin ?? source.url),
    browserContextId: source.browserContextId || null,
    timeout: normalizeTimeoutOption(source, 5000)
  };
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function normalizeOrigin(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (isUrlLike(value)) {
    return value.origin === 'null' ? '' : value.origin;
  }

  const origin = String(value).trim();

  if (!origin) {
    return '';
  }

  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(origin)) {
    return origin;
  }

  try {
    const url = new URL(origin);
    return url.origin === 'null' ? '' : url.origin;
  } catch (error) {
    return origin;
  }
}

function isUrlLike(value) {
  return value &&
    typeof value === 'object' &&
    typeof value.href === 'string' &&
    typeof value.origin === 'string';
}

module.exports = {
  normalizeBrowserDisplay,
  normalizeViewportOptions,
  normalizeTimeoutOption,
  normalizeAlertOptions,
  normalizePermissionOptions,
  normalizeNonNegativeInteger,
  normalizeOrigin,
  isUrlLike
};
