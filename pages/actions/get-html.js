// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { buildRuntimeEvaluateParams } = require("../helpers/runtime");

async function getHTML(connection, options = {}) {
  if (options.contextId) {
    const response = await connection.send("Runtime.evaluate", buildRuntimeEvaluateParams(
      "document.documentElement ? document.documentElement.outerHTML : ''",
      options
    ));

    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.text || "Could not read frame HTML");
    }

    return response.result?.result?.value || "";
  }

  const response = await connection.send("DOM.getDocument");

  if (!response.result) {
    throw new Error("DOM is not ready");
  }

  const rootNodeId = response.result.root.nodeId;
  const htmlResponse = await connection.send("DOM.getOuterHTML", {
    nodeId: rootNodeId
  });

  return htmlResponse.result.outerHTML;
}

module.exports = getHTML;
