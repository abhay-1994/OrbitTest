// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { ensureDir } = require("./utils");

let pixelmatchPromise = null;

async function comparePngBuffers(actualBuffer, baselinePath, options = {}) {
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const actual = PNG.sync.read(actualBuffer);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      pass: false,
      diffPixels: Number.POSITIVE_INFINITY,
      diffPath: null,
      message: `Screenshot size mismatch. Baseline ${baseline.width}x${baseline.height}, actual ${actual.width}x${actual.height}.`
    };
  }

  const diff = new PNG({ width: actual.width, height: actual.height });
  const pixelmatch = await loadPixelmatch();
  const diffPixels = pixelmatch(
    baseline.data,
    actual.data,
    diff.data,
    actual.width,
    actual.height,
    {
      threshold: normalizePixelmatchThreshold(options.threshold)
    }
  );
  const limit = normalizeDiffLimit(options.threshold, actual.width * actual.height);
  let diffPath = options.diffPath || null;

  if (diffPath) {
    ensureDir(path.dirname(diffPath));
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    pass: diffPixels <= limit,
    diffPixels,
    diffPath
  };
}

function normalizePixelmatchThreshold(threshold) {
  if (threshold === undefined || threshold === null) {
    return 0.1;
  }

  const number = Number(threshold);

  if (!Number.isFinite(number)) {
    return 0.1;
  }

  return Math.max(0, Math.min(1, number));
}

function normalizeDiffLimit(threshold, totalPixels) {
  if (threshold === undefined || threshold === null) {
    return 0;
  }

  const number = Number(threshold);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return number <= 1 ? Math.floor(totalPixels * number) : Math.floor(number);
}

async function loadPixelmatch() {
  if (!pixelmatchPromise) {
    pixelmatchPromise = import("pixelmatch").then(mod => mod.default || mod.pixelmatch || mod);
  }

  return pixelmatchPromise;
}

module.exports = {
  comparePngBuffers
};
