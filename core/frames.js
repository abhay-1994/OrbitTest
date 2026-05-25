// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { buildEvaluationExpression, deserializeRemoteValue, formatEvaluationError, formatEvaluationLabel } = require('./browser/evaluation');
const { buildLocatorExpression, describeLocator } = require('../pages/helpers/locators');

class OrbitFrame {
  constructor(orbit, frameId, label = 'frame') {
    this.orbit = orbit;
    this.frameId = frameId;
    this.label = label;
  }

  async click(locator, options) {
    return this.traceStep(`click ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.click(locator, await this.actionOptions(options));
    });
  }

  async hover(locator, options) {
    return this.traceStep(`hover ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.hover(locator, await this.actionOptions(options));
    });
  }

  async doubleClick(locator, options) {
    return this.traceStep(`doubleClick ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.doubleClick(locator, await this.actionOptions(options));
    });
  }

  async rightClick(locator, options) {
    return this.traceStep(`rightClick ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.rightClick(locator, await this.actionOptions(options));
    });
  }

  async type(locator, value, options) {
    return this.traceStep(`type into ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.type(locator, value, await this.actionOptions(options));
    });
  }

  async hasText(text, options) {
    return this.traceStep(`hasText "${text}"`, async () => {
      return this.orbit.browser.page.hasText(text, await this.actionOptions(options));
    });
  }

  async waitForText(text, options) {
    return this.traceStep(`waitForText "${text}"`, async () => {
      return this.orbit.browser.page.waitForText(text, await this.actionOptions(options));
    });
  }

  async exists(locator, options) {
    return this.traceStep(`exists ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.exists(locator, await this.actionOptions(options));
    });
  }

  async all(locator = this.css('*'), options) {
    return this.traceStep(`all ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.all(locator, await this.actionOptions(options));
    });
  }

  async elements(locator = this.css('*'), options) {
    return this.all(locator, options);
  }

  async waitFor(locator, options) {
    return this.traceStep(`waitFor ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.waitFor(locator, await this.actionOptions(options));
    });
  }

  async text(locator, options) {
    return this.traceStep(`text ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.text(locator, await this.actionOptions(options));
    });
  }

  async visibleText(locator, options) {
    return this.traceStep(`visibleText ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.visibleText(locator, await this.actionOptions(options));
    });
  }

  async domText(locator, options) {
    return this.traceStep(`domText ${describeLocator(locator)}`, async () => {
      return this.orbit.browser.page.domText(locator, await this.actionOptions(options));
    });
  }

  async evaluate(expressionOrFunction, ...args) {
    return this.traceStep(`evaluate ${formatEvaluationLabel(expressionOrFunction)}`, async () => {
      const options = await this.actionOptions({});
      const expression = buildEvaluationExpression(expressionOrFunction, args);
      const response = await this.orbit.requireConnection().send('Runtime.evaluate', {
        expression,
        contextId: options.contextId,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      }, {
        timeoutMs: normalizeTimeoutOption({}, 10000)
      });

      if (response.result?.exceptionDetails) {
        throw new Error(formatEvaluationError(response.result.exceptionDetails));
      }

      return deserializeRemoteValue(response.result?.result);
    });
  }

  async frame(locatorOrPath, options = {}) {
    return resolveFramePath(this.orbit, this.frameId, locatorOrPath, options);
  }

  async withFrame(locatorOrPath, fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('withFrame() expects a callback function.');
    }

    const frame = await this.frame(locatorOrPath, options);
    return fn(frame);
  }

  css(selector) {
    return this.orbit.css(selector);
  }

  xpath(selector) {
    return this.orbit.xpath(selector);
  }

  near(target, anchor) {
    return this.orbit.near(target, anchor);
  }

  within(anchor, target) {
    return this.orbit.within(anchor, target);
  }

  nth(locator, index) {
    return this.orbit.nth(locator, index);
  }

  first(locator) {
    return this.orbit.first(locator);
  }

  last(locator) {
    return this.orbit.last(locator);
  }

  getByRole(role, name) {
    return this.orbit.getByRole(role, name);
  }

  getByAttribute(name, value) {
    return this.orbit.getByAttribute(name, value);
  }

  async actionOptions(options = {}) {
    const actionOptions = this.orbit.withActionDefaults(options);
    const scope = await resolveFrameRuntimeScope(this.orbit.requireConnection(), this.frameId, actionOptions);

    return {
      ...actionOptions,
      contextId: scope.contextId,
      pointOffset: scope.pointOffset,
      frameId: this.frameId
    };
  }

  traceStep(name, fn) {
    return this.orbit.traceStep(`${this.label} ${name}`, fn);
  }
}

async function resolveFramePath(orbit, startFrameId, locatorOrPath, options = {}) {
  const connection = orbit.requireConnection();
  const path = normalizeFramePath(locatorOrPath);
  let parentFrameId = startFrameId || await getMainFrameId(connection);
  let label = startFrameId ? 'nested frame' : 'frame';

  for (const locator of path) {
    const child = await resolveChildFrame(connection, parentFrameId, locator, options);
    parentFrameId = child.frameId;
    label = child.label;
  }

  return new OrbitFrame(orbit, parentFrameId, label);
}

async function resolveFrameRuntimeScope(connection, frameId, options = {}) {
  const contextId = await createFrameContext(connection, frameId, options);
  const pointOffset = await computeFrameOffset(connection, frameId, options);

  return {
    contextId,
    pointOffset
  };
}

async function resolveChildFrame(connection, parentFrameId, locator, options = {}) {
  const timeout = normalizeTimeoutOption(options, 5000, 'frameTimeout');
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt <= timeout) {
    try {
      const found = await findChildFrameOnce(connection, parentFrameId, locator, options);

      if (found) {
        return found;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(Math.min(100, Math.max(1, timeout - (Date.now() - startedAt))));
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`No frame found for ${describeLocator(locator)}.`);
}

async function findChildFrameOnce(connection, parentFrameId, locator, options = {}) {
  const parentContextId = await createFrameContext(connection, parentFrameId, options);
  const token = createFrameToken();
  const markResponse = await connection.send('Runtime.evaluate', {
    expression: buildLocatorExpression(locator, 'frameElement', { token }),
    contextId: parentContextId,
    returnByValue: true
  }, {
    timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
  });

  if (markResponse.result?.exceptionDetails) {
    throw new Error(markResponse.result.exceptionDetails.text || `Could not evaluate ${describeLocator(locator)}`);
  }

  const descriptor = markResponse.result?.result?.value;

  if (!descriptor) {
    return null;
  }

  try {
    const frames = flattenFrameTree((await connection.send('Page.getFrameTree')).result?.frameTree)
      .filter(frame => frame.parentId === parentFrameId);

    for (const frame of frames) {
      const match = await frameOwnerMatchesToken(connection, parentContextId, frame.id, token);

      if (match.matched) {
        return {
          frameId: frame.id,
          label: formatFrameLabel(descriptor, frame)
        };
      }
    }
  } finally {
    await clearFrameToken(connection, parentContextId, token);
  }

  return null;
}

async function createFrameContext(connection, frameId, options = {}) {
  const response = await connection.send('Page.createIsolatedWorld', {
    frameId,
    worldName: 'orbittest',
    grantUniveralAccess: false
  }, {
    timeoutMs: normalizeInteger(options.frameContextTimeout ?? options.frameContextTimeoutMs, 3000)
  });
  const contextId = response.result?.executionContextId;

  if (!contextId) {
    throw new Error(`Could not create an execution context for frame ${frameId}.`);
  }

  return contextId;
}

async function computeFrameOffset(connection, frameId, options = {}) {
  const frames = flattenFrameTree((await connection.send('Page.getFrameTree')).result?.frameTree);
  const byId = new Map(frames.map(frame => [frame.id, frame]));
  const chain = [];
  let current = byId.get(frameId);

  while (current?.parentId) {
    chain.unshift(current.id);
    current = byId.get(current.parentId);
  }

  let x = 0;
  let y = 0;

  for (const childFrameId of chain) {
    const child = byId.get(childFrameId);
    const parentContextId = await createFrameContext(connection, child.parentId, options);
    const offset = await readFrameOwnerOffset(connection, parentContextId, childFrameId);
    x += offset.x;
    y += offset.y;
  }

  return { x, y };
}

async function readFrameOwnerOffset(connection, parentContextId, frameId) {
  const owner = await connection.send('DOM.getFrameOwner', { frameId });
  const backendNodeId = owner.result?.backendNodeId;

  if (!backendNodeId) {
    throw new Error(`Could not find the owner element for frame ${frameId}.`);
  }

  const resolved = await connection.send('DOM.resolveNode', {
    backendNodeId,
    executionContextId: parentContextId,
    objectGroup: 'orbittest-frame'
  });
  const objectId = resolved.result?.object?.objectId;

  if (!objectId) {
    throw new Error(`Could not inspect the owner element for frame ${frameId}.`);
  }

  try {
    const response = await connection.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = this.getBoundingClientRect();
        return {
          x: rect.left + (this.clientLeft || 0),
          y: rect.top + (this.clientTop || 0)
        };
      }`,
      returnByValue: true
    });

    const value = response.result?.result?.value || {};

    return {
      x: Number(value.x || 0),
      y: Number(value.y || 0)
    };
  } finally {
    await releaseObject(connection, objectId);
  }
}

async function frameOwnerMatchesToken(connection, parentContextId, frameId, token) {
  const owner = await connection.send('DOM.getFrameOwner', { frameId });
  const backendNodeId = owner.result?.backendNodeId;

  if (!backendNodeId) {
    return { matched: false };
  }

  const resolved = await connection.send('DOM.resolveNode', {
    backendNodeId,
    executionContextId: parentContextId,
    objectGroup: 'orbittest-frame'
  });
  const objectId = resolved.result?.object?.objectId;

  if (!objectId) {
    return { matched: false };
  }

  try {
    const response = await connection.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(token) {
        return {
          matched: this.getAttribute('data-orbittest-frame-token') === token
        };
      }`,
      arguments: [{ value: token }],
      returnByValue: true
    });

    return response.result?.result?.value || { matched: false };
  } finally {
    await releaseObject(connection, objectId);
  }
}

async function clearFrameToken(connection, contextId, token) {
  try {
    await connection.send('Runtime.evaluate', {
      contextId,
      expression: `document.querySelectorAll('[data-orbittest-frame-token="${token}"]').forEach(el => el.removeAttribute('data-orbittest-frame-token'))`,
      returnByValue: true
    }, {
      timeoutMs: 1000
    });
  } catch (error) {
    // Token cleanup is best-effort and should not hide the real frame error.
  }
}

async function releaseObject(connection, objectId) {
  try {
    await connection.send('Runtime.releaseObject', { objectId }, { timeoutMs: 1000 });
  } catch (error) {
    // Chrome releases temporary objects when the context is destroyed.
  }
}

async function getMainFrameId(connection) {
  const frameTree = (await connection.send('Page.getFrameTree')).result?.frameTree;
  const frameId = frameTree?.frame?.id;

  if (!frameId) {
    throw new Error('Could not find the main frame.');
  }

  return frameId;
}

function flattenFrameTree(node, result = []) {
  if (!node?.frame) {
    return result;
  }

  result.push(node.frame);

  for (const child of node.childFrames || []) {
    flattenFrameTree(child, result);
  }

  return result;
}

function normalizeFramePath(locatorOrPath) {
  const path = Array.isArray(locatorOrPath) ? locatorOrPath : [locatorOrPath];

  if (path.length === 0 || path.some(locator => locator === undefined || locator === null)) {
    throw new Error('frame() expects a frame locator or a non-empty array of frame locators.');
  }

  return path;
}

function formatFrameLabel(descriptor = {}, frame = {}) {
  const name = descriptor.title || descriptor.name || frame.name || frame.url || descriptor.src || 'frame';
  return `frame(${String(name).replace(/\s+/g, ' ').trim().slice(0, 80)})`;
}

function createFrameToken() {
  return `orbit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTimeoutOption(options = {}, fallback = 5000, key = 'timeout') {
  if (typeof options === 'number' || typeof options === 'string') {
    return normalizeInteger(options, fallback);
  }

  if (!options || typeof options !== 'object') {
    return fallback;
  }

  return normalizeInteger(options[key] ?? options[`${key}Ms`] ?? options.timeout ?? options.timeoutMs, fallback);
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  OrbitFrame,
  resolveFramePath
};
