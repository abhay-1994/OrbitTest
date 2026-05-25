// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const path = require('path');

function printCiAnnotations(report, options = {}) {
  if (!options.ci?.enabled || !options.ci.githubAnnotations) {
    return;
  }

  for (const result of report.results) {
    if (result.status === 'failed') {
      const location = result.error?.location || {};
      const props = {
        file: toCiFilePath(location.file || result.file || 'unknown'),
        line: location.line || 1,
        col: location.column || 1
      };
      const message = `${result.name}: ${result.error?.message || 'Test failed'}`;
      console.log(`::error ${formatGithubAnnotationProps(props)}::${escapeGithubAnnotation(message)}`);
    }

    if (result.status === 'flaky') {
      const props = {
        file: toCiFilePath(result.file || 'unknown'),
        line: 1,
        col: 1
      };
      const message = `${result.name}: flaky test passed after ${result.attempts} attempts`;
      console.log(`::warning ${formatGithubAnnotationProps(props)}::${escapeGithubAnnotation(message)}`);
    }
  }
}

function formatGithubAnnotationProps(props) {
  return Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${escapeGithubAnnotationProperty(value)}`)
    .join(',');
}

function escapeGithubAnnotation(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function escapeGithubAnnotationProperty(value) {
  return escapeGithubAnnotation(value)
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function toProjectRelativePath(filePath) {
  if (!filePath || filePath === 'unknown') {
    return 'unknown';
  }

  const resolved = path.resolve(filePath);
  const relative = path.relative(process.cwd(), resolved);

  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  return filePath;
}

function toCiFilePath(filePath) {
  return toProjectRelativePath(filePath).replace(/\\/g, '/');
}

module.exports = { printCiAnnotations };
