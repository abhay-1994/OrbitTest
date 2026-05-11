#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(options.root || process.cwd());
const reportFile = options.file || 'report.html';
const host = options.host || '127.0.0.1';
const port = normalizePort(options.port);
const ttlMs = normalizeInteger(options.ttl, 30 * 60 * 1000);

if (!fs.existsSync(path.join(root, reportFile))) {
  writeStartupMessage({ error: `Report file was not found: ${path.join(root, reportFile)}` });
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === '/' ? reportFile : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);

  if (!isInsideDirectory(filePath, root)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
});

server.once('error', error => {
  writeStartupMessage({ error: error.message || String(error) });
  process.exit(1);
});

server.listen(port, host, () => {
  const address = server.address();
  const url = `http://${host}:${address.port}/`;

  writeStartupMessage({
    url,
    root,
    port: address.port,
    report: reportFile
  });

  if (ttlMs > 0) {
    setTimeout(() => {
      server.close(() => process.exit(0));
    }, ttlMs).unref();
  }
});

function parseArgs(args) {
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[i + 1];

    if (next !== undefined && !next.startsWith('--')) {
      parsed[key] = next;
      i++;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function writeStartupMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(message);
}

function isInsideDirectory(target, parent) {
  const relative = path.relative(parent, target);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';

  return 'application/octet-stream';
}

function normalizePort(value) {
  const number = normalizeInteger(value, 0);
  return number >= 0 && number <= 65535 ? number : 0;
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}
