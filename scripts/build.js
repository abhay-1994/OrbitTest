// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const roots = process.argv.slice(2);
const targets = roots.length > 0
  ? roots
  : [
    "cli.js",
    "orbit.js",
    "core",
    "pages",
    "runner",
    "packages/mobile"
  ];

for (const target of targets) {
  const resolved = path.resolve(process.cwd(), target);

  if (!fs.existsSync(resolved)) {
    continue;
  }

  for (const file of collectJavaScriptFiles(resolved)) {
    execFileSync(process.execPath, ["--check", file], {
      stdio: "inherit"
    });
  }
}

console.log("Build check passed.");

function collectJavaScriptFiles(target) {
  const stat = fs.statSync(target);

  if (stat.isFile()) {
    return target.endsWith(".js") ? [target] : [];
  }

  const files = [];

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "reports" || entry.name === "dist") {
      continue;
    }

    files.push(...collectJavaScriptFiles(path.join(target, entry.name)));
  }

  return files;
}
