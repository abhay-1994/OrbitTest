// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

async function getHTML(connection) {
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
