// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require("fs");
const path = require("path");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(value), "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slugify(value) {
  return String(value || "mobile-test")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "mobile-test";
}

function timestamp(date = new Date()) {
  return date.toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function normalizeTimeout(value, fallback = 5000) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

module.exports = {
  delay,
  ensureDir,
  normalizeTimeout,
  slugify,
  timestamp,
  writeJson,
  writeText
};
