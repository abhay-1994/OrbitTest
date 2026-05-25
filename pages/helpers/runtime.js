// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function buildRuntimeEvaluateParams(expression, options = {}, extra = {}) {
  return {
    expression,
    returnByValue: true,
    ...(options.contextId ? { contextId: options.contextId } : {}),
    ...extra
  };
}

function applyPointOffset(point, options = {}) {
  if (!point) {
    return point;
  }

  const offset = options.pointOffset || {};
  const x = Number(offset.x || 0);
  const y = Number(offset.y || 0);

  if (!x && !y) {
    return point;
  }

  return {
    ...point,
    x: point.x + x,
    y: point.y + y,
    localX: point.x,
    localY: point.y,
    frameOffset: { x, y }
  };
}

module.exports = {
  applyPointOffset,
  buildRuntimeEvaluateParams
};
