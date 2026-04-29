const http = require("http");

function getWebSocketUrl(port, retries = 15) {
  return new Promise((resolve, reject) => {
    const tryFetch = () => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = "";

        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const pages = JSON.parse(data);
            const page = pages.find(p => p.type === "page");

            if (!page) {
              throw new Error("No page target found");
            }

            resolve(page.webSocketDebuggerUrl);
          } catch (error) {
            if (retries-- > 0) {
              setTimeout(tryFetch, 300);
            } else {
              reject(new Error("Could not get WebSocket URL"));
            }
          }
        });
      }).on("error", () => {
        if (retries-- > 0) {
          setTimeout(tryFetch, 300);
        } else {
          reject(new Error("Debug port not ready"));
        }
      });
    };

    tryFetch();
  });
}

module.exports = getWebSocketUrl;
