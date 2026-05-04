const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const activeLaunches = new Set();
let cleanupHandlersInstalled = false;

async function launchChrome() {
  installCleanupHandlers();
  const chromePath = findChromeExecutable();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbittest-profile-"));

  const chromeProcess = spawn(chromePath, [
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

  const launch = {
    process: chromeProcess,
    userDataDir
  };

  activeLaunches.add(launch);

  let port;

  try {
    port = await waitForDevToolsPort(launch, 15000);
  } catch (error) {
    await closeChrome(launch);
    throw error;
  }

  console.log("Fresh Chrome instance launched");

  return { port, launch };
}

async function closeChrome(launch = null) {
  if (!launch) {
    const launches = Array.from(activeLaunches);
    await Promise.all(launches.map(current => closeChrome(current)));
    return;
  }

  activeLaunches.delete(launch);
  const chromeProcess = launch.process;

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
  }

  await removeUserDataDir(launch.userDataDir);
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

async function waitForDevToolsPort(launch, timeoutMs = 10000) {
  const profileDir = launch.userDataDir;
  const chromeProcess = launch.process;
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

async function removeUserDataDir(userDataDir) {
  if (!userDataDir) {
    return;
  }

  const dir = userDataDir;

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

function installCleanupHandlers() {
  if (cleanupHandlersInstalled) {
    return;
  }

  cleanupHandlersInstalled = true;

  process.once("exit", () => {
    cleanupActiveLaunchesSync();
  });

  process.once("SIGINT", () => {
    cleanupActiveLaunchesSync();
    process.exit(130);
  });

  process.once("SIGTERM", () => {
    cleanupActiveLaunchesSync();
    process.exit(143);
  });
}

function cleanupActiveLaunchesSync() {
  for (const launch of Array.from(activeLaunches)) {
    activeLaunches.delete(launch);

    try {
      if (launch.process && process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(launch.process.pid), "/T", "/F"], {
          stdio: "ignore"
        });
      } else if (launch.process) {
        process.kill(-launch.process.pid);
      }
    } catch (error) {
      // Chrome may have already exited.
    }

    try {
      fs.rmSync(launch.userDataDir, { recursive: true, force: true });
    } catch (error) {
      // Best effort cleanup during process shutdown.
    }
  }
}

module.exports = { launchChrome, closeChrome };
