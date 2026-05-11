const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'assets', 'orbit-logo.svg');
let cachedLogoDataUri = null;

function renderReportLogo(className = 'report-logo') {
  const dataUri = readLogoDataUri();
  const safeClassName = String(className || 'report-logo').replace(/[^a-zA-Z0-9_-]/g, '');

  return `<img class="${safeClassName}" src="${dataUri}" alt="OrbitTest logo">`;
}

function readLogoDataUri() {
  if (cachedLogoDataUri) {
    return cachedLogoDataUri;
  }

  try {
    const logo = fs.readFileSync(logoPath);
    cachedLogoDataUri = `data:image/svg+xml;base64,${logo.toString('base64')}`;
  } catch (error) {
    const fallback = '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="48" fill="#175cd3"/><path d="M48 68l34-16-18 34-4-18-12 0z" fill="#fff"/></svg>';
    cachedLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(fallback).toString('base64')}`;
  }

  return cachedLogoDataUri;
}

module.exports = {
  renderReportLogo,
  readLogoDataUri
};
