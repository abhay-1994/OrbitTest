const { executeAction } = require("../helpers/execution");

async function hasText(connection, text, options = {}) {
  return executeAction(`hasText "${text}"`, options, async () => {
    const response = await connection.send("Runtime.evaluate", {
      expression: `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(String(text).toLowerCase())})`,
      returnByValue: true
    });

    return Boolean(response.result?.result?.value);
  });
}

module.exports = hasText;
