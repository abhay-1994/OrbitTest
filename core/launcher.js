const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let chromeProcess = null;
let userDataDir = null;

async function launchChrome() {
  const chromePath = findChromeExecutable();

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbittest-profile-"));

  chromeProcess = spawn(chromePath, [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-dev-shm-usage",
    "--disable-popup-blocking",
    "about:blank"
  ], {
    detached: true,
    stdio: "ignore"
  });

  chromeProcess.unref();

  const port = await waitForDevToolsPort(userDataDir, 15000);

  console.log("Fresh Chrome instance launched");

  return { port };
}

async function closeChrome() {
  if (chromeProcess) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(chromeProcess.pid), "/T", "/F"], {
        stdio: "ignore"
      });
    } else {
      try {
        process.kill(-chromeProcess.pid);
      } catch (error) {
        // Chrome may have already exited.
      }
    }

    chromeProcess = null;
  }

  await removeUserDataDir();
  console.log("Chrome closed");
}

function findChromeExecutable() {
  const candidates = [
    getBundledChromePath(),
    process.env.ORBITTEST_CHROME_PATH,
    ...getSystemChromePaths()
  ].filter(Boolean);

  const chromePath = candidates.find(candidate => fs.existsSync(candidate));

  if (!chromePath) {
    throw new Error(
      "Chrome executable was not found. Run `npm install` to download OrbitTest's managed Chrome, or set ORBITTEST_CHROME_PATH."
    );
  }

  return chromePath;
}

function getBundledChromePath() {
  try {
    const puppeteer = require("puppeteer");
    return puppeteer.executablePath();
  } catch (error) {
    return null;
  }
}

function getSystemChromePaths() {
  if (process.platform === "win32") {
    return [
      path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
}

async function waitForDevToolsPort(profileDir, timeoutMs = 10000) {
  const activePortFile = path.join(profileDir, "DevToolsActivePort");
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (chromeProcess && chromeProcess.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready. Exit code: ${chromeProcess.exitCode}`);
    }

    if (fs.existsSync(activePortFile)) {
      const [port] = fs.readFileSync(activePortFile, "utf8").split(/\r?\n/);

      if (port && /^\d+$/.test(port)) {
        return Number(port);
      }
    }

    await delay(100);
  }

  throw new Error("Timed out waiting for Chrome debug port");
}

async function removeUserDataDir() {
  if (!userDataDir) {
    return;
  }

  const dir = userDataDir;
  userDataDir = null;

  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      await delay(200);
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { launchChrome, closeChrome };
