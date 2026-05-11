const http = require("http");

async function getWebSocketUrl(port, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const intervalMs = options.intervalMs || 250;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const pages = await fetchTargets(port);
      const page = pages.find(target => target.type === "page" && target.webSocketDebuggerUrl);

      if (page) {
        return page.webSocketDebuggerUrl;
      }

      lastError = new Error("No page target found");
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw new Error(`Could not get Chrome WebSocket URL after ${timeoutMs}ms: ${lastError?.message || "unknown error"}`);
}

async function listPageTargets(port) {
  const targets = await fetchTargets(port);

  return targets
    .filter(target => target.type === "page" && target.webSocketDebuggerUrl)
    .map(target => ({
      id: target.id,
      title: target.title || "",
      url: target.url || "",
      type: target.type,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      attached: Boolean(target.attached)
    }));
}

async function activateTarget(port, targetId) {
  await callJsonEndpoint(port, `/json/activate/${encodeURIComponent(targetId)}`);
}

async function closeTarget(port, targetId) {
  await callJsonEndpoint(port, `/json/close/${encodeURIComponent(targetId)}`);
}

function fetchTargets(port) {
  return callJsonEndpoint(port, "/json");
}

function callJsonEndpoint(port, endpoint) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}${endpoint}`, (res) => {
      let data = "";

      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Chrome target endpoint returned ${res.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            resolve(data);
          }
        } catch (error) {
          reject(new Error(`Invalid Chrome target response from ${endpoint}: ${error.message}`));
        }
      });
    });

    request.setTimeout(2000, () => {
      request.destroy(new Error("Timed out reading Chrome targets"));
    });

    request.on("error", reject);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = getWebSocketUrl;
module.exports.fetchTargets = fetchTargets;
module.exports.listPageTargets = listPageTargets;
module.exports.activateTarget = activateTarget;
module.exports.closeTarget = closeTarget;
