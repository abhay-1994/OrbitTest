// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const { dispatchMouseEvent } = require('../pages/helpers/input');
const { describeLocator, normalizeLocator } = require('../pages/helpers/locators');
const {
  buildEvaluationExpression,
  deserializeRemoteValue,
  formatEvaluationError,
  formatEvaluationLabel
} = require('./browser/evaluation');

class OrbitShadow {
  constructor(orbit, rootBackendNodeId, label = 'shadow') {
    this.orbit = orbit;
    this.rootBackendNodeId = rootBackendNodeId;
    this.label = label;
  }

  async click(locator, options) {
    return this.traceStep(`click ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { clickable: true });
      await clickNode(this.connection(), node, this.actionOptions(options));
    });
  }

  async hover(locator, options) {
    return this.traceStep(`hover ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { visible: true });
      const point = await pointForNode(this.connection(), node, this.actionOptions(options));

      await dispatchMouseEvent(this.connection(), {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      }, this.actionOptions(options));
    });
  }

  async doubleClick(locator, options) {
    return this.traceStep(`doubleClick ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { clickable: true });
      await clickNode(this.connection(), node, this.actionOptions(options), { clickCount: 2 });
    });
  }

  async rightClick(locator, options) {
    return this.traceStep(`rightClick ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { clickable: true });
      await clickNode(this.connection(), node, this.actionOptions(options), { button: 'right' });
    });
  }

  async type(locator, value, options) {
    return this.traceStep(`type into ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForInput(locator, options);
      await setNodeValue(this.connection(), node, value, this.actionOptions(options));
    });
  }

  async exists(locator, options) {
    return this.traceStep(`exists ${describeShadowLocator(locator)}`, async () => {
      const actionOptions = this.actionOptions(options);
      const waitOptions = normalizeWaitOptions(actionOptions, 5000);
      const startedAt = Date.now();

      while (Date.now() - startedAt <= waitOptions.timeout) {
        const nodes = await this.waitForNodes(locator, { ...actionOptions, timeout: 0, allowEmpty: true });

        for (const node of nodes) {
          if (await isVisibleNode(this.connection(), node, actionOptions)) {
            return true;
          }
        }

        if (waitOptions.timeout === 0) {
          break;
        }

        await delay(Math.min(waitOptions.interval, Math.max(1, waitOptions.timeout - (Date.now() - startedAt))));
      }

      return false;
    });
  }

  async hasText(text, options) {
    return this.traceStep(`hasText "${text}"`, async () => {
      const waitOptions = normalizeWaitOptions(this.actionOptions(options), 5000);
      const startedAt = Date.now();
      const expected = lowerText(text);

      while (Date.now() - startedAt <= waitOptions.timeout) {
        const { root } = await readScope(this.connection(), this.rootBackendNodeId);

        if (lowerText(nodeText(root)).includes(expected)) {
          return true;
        }

        await delay(Math.min(waitOptions.interval, Math.max(1, waitOptions.timeout - (Date.now() - startedAt))));
      }

      return false;
    });
  }

  async waitForText(text, options) {
    return this.traceStep(`waitForText "${text}"`, async () => {
      const waitOptions = normalizeWaitOptions(this.actionOptions(options), 5000);
      const startedAt = Date.now();

      while (Date.now() - startedAt <= waitOptions.timeout) {
        if (await this.hasText(text, { ...options, log: false, timeout: 0 })) {
          return true;
        }

        await delay(Math.min(waitOptions.interval, Math.max(1, waitOptions.timeout - (Date.now() - startedAt))));
      }

      throw new Error(`Timed out after ${waitOptions.timeout}ms waiting for text "${text}" inside ${this.label}.`);
    });
  }

  async waitFor(locator, options) {
    return this.traceStep(`waitFor ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { visible: true });
      return Boolean(node);
    });
  }

  async text(locator, options) {
    return this.traceStep(`text ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { visible: true });
      return compactText(nodeText(node));
    });
  }

  async visibleText(locator, options) {
    return this.text(locator, options);
  }

  async domText(locator, options) {
    return this.traceStep(`domText ${describeShadowLocator(locator)}`, async () => {
      const node = await this.waitForNode(locator, options, { visible: false });
      return compactText(nodeText(node));
    });
  }

  async all(locator = this.css('*'), options = {}) {
    return this.traceStep(`all ${describeShadowLocator(locator)}`, async () => {
      const nodes = await this.waitForNodes(locator, { ...options, allowEmpty: true });
      const snapshots = [];

      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];

        snapshots.push({
          type: 'shadowNode',
          backendNodeId: node.backendNodeId,
          index,
          tag: tagName(node),
          text: compactText(nodeText(node)),
          visible: await isVisibleNode(this.connection(), node, this.actionOptions(options)),
          attributes: attributesObject(node)
        });
      }

      return snapshots;
    });
  }

  async elements(locator = this.css('*'), options = {}) {
    return this.all(locator, options);
  }

  async evaluate(expressionOrFunction, ...args) {
    return this.traceStep(`evaluate ${formatEvaluationLabel(expressionOrFunction)}`, async () => {
      const objectId = await resolveNodeObject(this.connection(), {
        backendNodeId: this.rootBackendNodeId
      }, this.actionOptions({}));
      const functionDeclaration = buildShadowEvaluationFunction(expressionOrFunction);

      try {
        const response = await this.connection().send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration,
          arguments: args.map(value => ({ value })),
          awaitPromise: true,
          returnByValue: true,
          userGesture: true
        }, {
          timeoutMs: normalizeInteger(this.actionOptions({}).timeout ?? this.actionOptions({}).timeoutMs, 10000)
        });

        if (response.result?.exceptionDetails) {
          throw new Error(formatEvaluationError(response.result.exceptionDetails));
        }

        return deserializeRemoteValue(response.result?.result);
      } finally {
        await releaseObject(this.connection(), objectId);
      }
    });
  }

  async shadow(locatorOrPath, options = {}) {
    return resolveShadowPath(this.orbit, this.rootBackendNodeId, locatorOrPath, this.actionOptions(options));
  }

  async withShadow(locatorOrPath, fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('withShadow() expects a callback function.');
    }

    const shadow = await this.shadow(locatorOrPath, options);
    return fn(shadow);
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

  async waitForNode(locator, options = {}, intent = {}) {
    const nodes = await this.waitForNodes(locator, options);

    for (const node of nodes) {
      const target = intent.clickable
        ? clickableNodeFor(node, (await readScope(this.connection(), this.rootBackendNodeId)).parentByBackend)
        : node;

      if (!target) {
        continue;
      }

      if (intent.visible === false || await isVisibleNode(this.connection(), target, this.actionOptions(options))) {
        return target;
      }
    }

    throw new Error(`No visible element found for ${describeShadowLocator(locator)} inside ${this.label}.`);
  }

  async waitForInput(locator, options = {}) {
    const waitOptions = normalizeWaitOptions(this.actionOptions(options), 5000);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= waitOptions.timeout) {
      const scope = await readScope(this.connection(), this.rootBackendNodeId);
      const input = await findInputNode(this.connection(), scope, locator, this.actionOptions(options));

      if (input) {
        return input;
      }

      await delay(Math.min(waitOptions.interval, Math.max(1, waitOptions.timeout - (Date.now() - startedAt))));
    }

    throw new Error(`No input found for ${describeShadowLocator(locator)} inside ${this.label}.`);
  }

  async waitForNodes(locator, options = {}, intent = {}) {
    const waitOptions = normalizeWaitOptions(this.actionOptions(options), intent.allowEmpty || options.allowEmpty ? 0 : 5000);
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt <= waitOptions.timeout) {
      try {
        const scope = await readScope(this.connection(), this.rootBackendNodeId);
        const nodes = await findNodes(this.connection(), scope, locator, this.actionOptions(options));

        if (nodes.length > 0 || intent.allowEmpty || options.allowEmpty) {
          return nodes;
        }
      } catch (error) {
        lastError = error;
      }

      if (waitOptions.timeout === 0) {
        break;
      }

      await delay(Math.min(waitOptions.interval, Math.max(1, waitOptions.timeout - (Date.now() - startedAt))));
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }

  traceStep(name, fn) {
    return this.orbit.traceStep(`${this.label} ${name}`, fn);
  }

  actionOptions(options = {}) {
    return this.orbit.withActionDefaults(options);
  }

  connection() {
    return this.orbit.requireConnection();
  }
}

function buildShadowEvaluationFunction(expressionOrFunction) {
  if (typeof expressionOrFunction === 'function') {
    return `function(...args) {
      return (${expressionOrFunction.toString()})(this, ...args);
    }`;
  }

  const expression = buildEvaluationExpression(expressionOrFunction, []);

  return `function() {
    return (${expression});
  }`;
}

async function resolveShadowPath(orbit, startRootBackendNodeId, locatorOrPath, options = {}) {
  const connection = orbit.requireConnection();
  const path = normalizeShadowPath(locatorOrPath);
  let scopeBackendNodeId = startRootBackendNodeId || null;
  let label = startRootBackendNodeId ? 'nested shadow' : 'shadow';

  for (const locator of path) {
    const scope = await readScope(connection, scopeBackendNodeId);
    const hosts = await findNodes(connection, scope, locator, options);
    const host = hosts.find(node => shadowRootFor(node));

    if (!host) {
      throw new Error(`No shadow host found for ${describeShadowLocator(locator)}.`);
    }

    const root = shadowRootFor(host);
    scopeBackendNodeId = root.backendNodeId;
    label = `${tagName(host)} shadow`;
  }

  return new OrbitShadow(orbit, scopeBackendNodeId, label);
}

async function readScope(connection, rootBackendNodeId = null) {
  const document = await readDom(connection);
  const root = rootBackendNodeId
    ? document.byBackend.get(rootBackendNodeId)
    : document.root;

  if (!root) {
    throw new Error('Shadow root is no longer attached to the document.');
  }

  return {
    ...document,
    root
  };
}

async function readDom(connection) {
  const response = await connection.send('DOM.getDocument', {
    depth: -1,
    pierce: true
  });
  const root = response.result?.root;

  if (!root) {
    throw new Error('DOM is not ready.');
  }

  const byNodeId = new Map();
  const byBackend = new Map();
  const parentByBackend = new Map();

  function visit(node, parent = null) {
    if (!node) {
      return;
    }

    if (node.nodeId) {
      byNodeId.set(node.nodeId, node);
    }

    if (node.backendNodeId) {
      byBackend.set(node.backendNodeId, node);

      if (parent?.backendNodeId) {
        parentByBackend.set(node.backendNodeId, parent);
      }
    }

    for (const shadowRoot of shadowRootsFor(node)) {
      visit(shadowRoot, node);
    }

    for (const child of node.children || []) {
      visit(child, node);
    }
  }

  visit(root);

  return {
    root,
    byNodeId,
    byBackend,
    parentByBackend
  };
}

async function findNodes(connection, scope, target, options = {}) {
  if (target?.type === 'shadowNode') {
    const node = scope.byBackend.get(target.backendNodeId);
    return node ? [node] : [];
  }

  const locator = normalizeLocator(target);

  if (locator.type === 'nth') {
    const nodes = await findNodes(connection, scope, locator.locator, options);
    const index = locator.index < 0 ? nodes.length + locator.index : locator.index;
    return Number.isInteger(index) && nodes[index] ? [nodes[index]] : [];
  }

  if (locator.type === 'css') {
    return queryCss(connection, scope, locator.selector, options);
  }

  if (locator.type === 'xpath') {
    throw new Error('XPath locators are not supported inside shadow roots. Use css, text, role, or attribute locators.');
  }

  const nodes = descendants(scope.root);

  if (locator.type === 'role') {
    const role = lowerText(locator.role);
    const name = locator.name === undefined || locator.name === null ? null : lowerText(locator.name);
    const matches = nodes.filter(node => {
      if (roleFor(node) !== role) return false;
      if (!name) return true;
      const elName = lowerText(accessibleNameFor(node, scope));
      return elName === name || elName.startsWith(name) || matchesWordBoundary(elName, name);
    });
    return name ? rankByText(matches, name, scope) : matches;
  }

  if (locator.type === 'attribute') {
    return nodes.filter(node => {
      if (!hasAttribute(node, locator.name)) {
        return false;
      }

      return locator.value === undefined || locator.value === null || attributeValue(node, locator.name) === String(locator.value);
    });
  }

  if (locator.type === 'text') {
    const text = lowerText(locator.text);
    return rankByText(nodes.filter(node => textCandidatesFor(node, scope).some(value => lowerText(value).includes(text))), text, scope);
  }

  if (locator.type === 'near') {
    return findNearNodes(connection, scope, locator, options);
  }

  throw new Error(`Unsupported shadow locator: ${locator.type}`);
}

async function queryCss(connection, scope, selector, options = {}) {
  let response;

  try {
    response = await connection.send('DOM.querySelectorAll', {
      nodeId: scope.root.nodeId,
      selector
    }, {
      timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
    });
  } catch (error) {
    throw new Error(`Invalid CSS selector inside shadow root: ${selector}`);
  }

  return (response.result?.nodeIds || [])
    .map(nodeId => scope.byNodeId.get(nodeId))
    .filter(Boolean);
}

async function findNearNodes(connection, scope, locator, options = {}) {
  const targets = await findNodes(connection, scope, locator.target, options);
  const anchors = await findNodes(connection, scope, locator.anchor, options);
  const ranked = [];

  for (const target of targets) {
    let best = Infinity;

    for (const anchor of anchors) {
      const score = await distanceBetweenNodes(connection, target, anchor, options);

      if (score < best) {
        best = score;
      }
    }

    if (Number.isFinite(best)) {
      ranked.push({ node: target, score: best });
    }
  }

  return ranked.sort((a, b) => a.score - b.score).map(item => item.node);
}

async function findInputNode(connection, scope, locator, options = {}) {
  const normalized = normalizeLocator(locator);

  if (normalized.type === 'text') {
    const text = lowerText(normalized.text);
    const inputCandidates = descendants(scope.root).filter(node => {
      if (!isInputNode(node)) return false;
      return textCandidatesFor(node, scope).some(c => lowerText(c).includes(text));
    });
    const ranked = rankByText(inputCandidates, text, scope);

    for (const input of ranked) {
      if (await isVisibleNode(connection, input, options)) {
        return input;
      }
    }

    return null;
  }

  const nodes = await findNodes(connection, scope, locator, options);

  for (const node of nodes) {
    const input = isInputNode(node)
      ? node
      : descendants(node).find(isInputNode);

    if (input && await isVisibleNode(connection, input, options)) {
      return input;
    }
  }

  return null;
}

async function clickNode(connection, node, options = {}, clickOptions = {}) {
  await scrollNodeIntoView(connection, node, options);

  try {
    const point = await pointForNode(connection, node, options);
    const button = clickOptions.button || 'left';
    const clickCount = clickOptions.clickCount || 1;

    if ((await dispatchMouseEvent(connection, { type: 'mouseMoved', x: point.x, y: point.y }, options)).dialogOpened) {
      return;
    }

    if ((await dispatchMouseEvent(connection, {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button,
      clickCount
    }, options)).dialogOpened) {
      return;
    }

    await dispatchMouseEvent(connection, {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button,
      clickCount
    }, options);
  } catch (error) {
    await callOnNode(connection, node, `function() {
      this.focus?.();
      this.click?.();
      return true;
    }`, [], options);
  }
}

async function setNodeValue(connection, node, value, options = {}) {
  await callOnNode(connection, node, `function(value) {
    this.scrollIntoView?.({ block: 'center', inline: 'center' });
    this.focus?.();

    if (this.isContentEditable) {
      this.textContent = value;
      this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return this.textContent;
    }

    if (!('value' in this)) {
      throw new Error('Target element cannot receive text input.');
    }

    const prototype = Object.getPrototypeOf(this);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(this, value);
    } else {
      this.value = value;
    }

    this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    this.dispatchEvent(new Event('change', { bubbles: true }));
    return this.value;
  }`, [{ value: String(value) }], options);
}

async function pointForNode(connection, node, options = {}) {
  await scrollNodeIntoView(connection, node, options);

  const response = await connection.send('DOM.getBoxModel', {
    backendNodeId: node.backendNodeId
  }, {
    timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
  });
  const quad = response.result?.model?.border || response.result?.model?.content;

  if (!quad || quad.length < 8) {
    throw new Error(`Element ${nodeLabel(node)} does not have a visible box.`);
  }

  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
  };
}

async function distanceBetweenNodes(connection, a, b, options = {}) {
  try {
    const pointA = await pointForNode(connection, a, options);
    const pointB = await pointForNode(connection, b, options);
    return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
  } catch (error) {
    return Infinity;
  }
}

async function isVisibleNode(connection, node, options = {}) {
  if (!node || node.nodeType !== 1) {
    return false;
  }

  try {
    const result = await callOnNode(connection, node, `function() {
      const style = window.getComputedStyle(this);
      const rect = this.getBoundingClientRect();

      if (style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          Number(style.opacity || '1') === 0 ||
          rect.width === 0 ||
          rect.height === 0) {
        return false;
      }

      let parent = this.parentElement;
      while (parent) {
        if (Number(window.getComputedStyle(parent).opacity || '1') === 0) return false;
        parent = parent.parentElement;
      }

      return true;
    }`, [], options);

    return Boolean(result);
  } catch (error) {
    return false;
  }
}

async function scrollNodeIntoView(connection, node, options = {}) {
  try {
    await callOnNode(connection, node, `function() {
      this.scrollIntoView?.({ block: 'center', inline: 'center' });
      return true;
    }`, [], options);
  } catch (error) {
    // Box-model lookup below will produce the actionable error if scrolling failed.
  }
}

async function callOnNode(connection, node, functionDeclaration, args = [], options = {}) {
  const objectId = await resolveNodeObject(connection, node, options);

  try {
    const response = await connection.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, {
      timeoutMs: normalizeInteger(options.commandTimeout ?? options.commandTimeoutMs, 10000)
    });

    if (response.result?.exceptionDetails) {
      throw new Error(formatEvaluationError(response.result.exceptionDetails));
    }

    return deserializeRemoteValue(response.result?.result);
  } finally {
    await releaseObject(connection, objectId);
  }
}

async function resolveNodeObject(connection, node, options = {}) {
  const response = await connection.send('DOM.resolveNode', {
    backendNodeId: node.backendNodeId,
    objectGroup: 'orbittest-shadow',
    ...(options.contextId ? { executionContextId: options.contextId } : {})
  }, {
    timeoutMs: normalizeInteger(options.locatorTimeout ?? options.locatorTimeoutMs, 3000)
  });
  const objectId = response.result?.object?.objectId;

  if (!objectId) {
    throw new Error(`Could not inspect ${nodeLabel(node)}.`);
  }

  return objectId;
}

async function releaseObject(connection, objectId) {
  try {
    await connection.send('Runtime.releaseObject', { objectId }, { timeoutMs: 1000 });
  } catch (error) {
    // The browser will release temporary objects when the context is destroyed.
  }
}

function descendants(node) {
  const result = [];

  function visit(current) {
    for (const child of current.children || []) {
      result.push(child);
      visit(child);
    }
  }

  visit(node);
  return result.filter(child => child.nodeType === 1);
}

function shadowRootsFor(node) {
  return (node.shadowRoots || []).filter(root => root.shadowRootType !== 'user-agent');
}

function shadowRootFor(node) {
  return shadowRootsFor(node)[0] || null;
}

function clickableNodeFor(node, parentByBackend) {
  let current = node;

  while (current) {
    if (isClickableNode(current)) {
      return current;
    }

    current = parentByBackend.get(current.backendNodeId);
  }

  return node;
}

function isClickableNode(node) {
  const tag = tagName(node);
  const role = lowerText(attributeValue(node, 'role'));

  return ['button', 'a', 'input', 'select', 'textarea', 'label', 'summary'].includes(tag) ||
    ['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio', 'switch'].includes(role) ||
    hasAttribute(node, 'onclick') ||
    attributeValue(node, 'tabindex') !== undefined;
}

function isInputNode(node) {
  const tag = tagName(node);
  return ['input', 'textarea'].includes(tag) || attributeValue(node, 'contenteditable') === 'true';
}

function roleFor(node) {
  const explicit = attributeValue(node, 'role');

  if (explicit) {
    return lowerText(explicit);
  }

  const tag = tagName(node);
  const type = lowerText(attributeValue(node, 'type'));

  if (tag === 'button') return 'button';
  if (tag === 'a' && hasAttribute(node, 'href')) return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return 'button';
  if (tag === 'input' && type === 'checkbox') return 'checkbox';
  if (tag === 'input' && type === 'radio') return 'radio';
  if (tag === 'input' && ['email', 'password', 'search', 'tel', 'text', 'url', ''].includes(type)) return 'textbox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'img') return 'img';
  if (tag === 'li') return 'listitem';
  if (tag === 'ul' || tag === 'ol') return 'list';

  return '';
}

function accessibleNameFor(node, scope) {
  return uniqueTextParts([
    attributeValue(node, 'aria-label'),
    labelledByText(node, scope),
    attributeValue(node, 'alt'),
    attributeValue(node, 'title'),
    isInputNode(node) ? inputLabelFor(node, scope) : '',
    attributeValue(node, 'value'),
    nodeText(node)
  ]).join(' ');
}

function labelledByText(node, scope) {
  const labelledBy = attributeValue(node, 'aria-labelledby');

  if (!labelledBy) {
    return '';
  }

  const ids = labelledBy.split(/\s+/).filter(Boolean);
  return descendants(scope.root)
    .filter(candidate => ids.includes(attributeValue(candidate, 'id')))
    .map(nodeText)
    .join(' ');
}

function inputLabelFor(input, scope) {
  const id = attributeValue(input, 'id');
  const parentLabel = ancestorLabelText(input, scope);
  const labels = id
    ? descendants(scope.root)
      .filter(node => tagName(node) === 'label' && attributeValue(node, 'for') === id)
      .map(nodeText)
    : [];

  return uniqueTextParts([
    attributeValue(input, 'aria-label'),
    attributeValue(input, 'placeholder'),
    attributeValue(input, 'name'),
    attributeValue(input, 'value'),
    parentLabel,
    ...labels
  ]).join(' ');
}

function ancestorLabelText(node, scope) {
  let current = scope.parentByBackend.get(node.backendNodeId);

  while (current && current !== scope.root) {
    if (tagName(current) === 'label') {
      return nodeText(current);
    }

    current = scope.parentByBackend.get(current.backendNodeId);
  }

  return '';
}

function textCandidatesFor(node, scope) {
  return uniqueTextParts([
    accessibleNameFor(node, scope),
    attributeValue(node, 'value'),
    nodeText(node),
    isInputNode(node) ? inputLabelFor(node, scope) : ''
  ]);
}

function rankByText(nodes, targetText, scope) {
  return uniqueNodes(nodes).sort((a, b) => {
    const aScore = textScore(a, targetText, scope);
    const bScore = textScore(b, targetText, scope);
    return aScore - bScore;
  });
}

function ownNodeText(node) {
  const directText = (node.children || [])
    .filter(c => c.nodeType === 3)
    .map(c => c.nodeValue || '')
    .join(' ');
  return uniqueTextParts([
    directText,
    attributeValue(node, 'aria-label'),
    attributeValue(node, 'title'),
    attributeValue(node, 'alt'),
    attributeValue(node, 'value')
  ]).join(' ');
}

function textScore(node, targetText, scope) {
  const candidates = textCandidatesFor(node, scope).map(lowerText).filter(Boolean);
  const exact = candidates.some(value => value === targetText);
  const starts = candidates.some(value => value.startsWith(targetText));
  const wordBoundary = !exact && !starts && candidates.some(value => matchesWordBoundary(value, targetText));
  const ownExact = targetText && lowerText(ownNodeText(node)) === targetText;
  const clickable = isClickableNode(node) ? -350 : 0;
  const exactBonus = exact ? -700 : starts ? -450 : wordBoundary ? -280 : 0;
  const ownBonus = ownExact ? -200 : 0;
  const semanticBonus = semanticTierBonus(node);
  const childPenalty = (node.children || []).some(child => child.nodeType === 1) ? 35 : 0;
  const textLengthPenalty = Math.min(lowerText(nodeText(node)).length / 10, 250);

  return clickable + exactBonus + ownBonus + semanticBonus + childPenalty + textLengthPenalty;
}

function nodeText(node) {
  if (!node) {
    return '';
  }

  if (node.nodeType === 3) {
    return node.nodeValue || '';
  }

  return (node.children || []).map(nodeText).join(' ');
}

function attributesObject(node) {
  const attrs = {};
  const raw = node.attributes || [];

  for (let i = 0; i < raw.length; i += 2) {
    attrs[raw[i]] = raw[i + 1] || '';
  }

  return attrs;
}

function attributeValue(node, name) {
  return attributesObject(node)[name];
}

function hasAttribute(node, name) {
  return Object.prototype.hasOwnProperty.call(attributesObject(node), name);
}

function tagName(node) {
  return String(node.localName || node.nodeName || '').toLowerCase();
}

function nodeLabel(node) {
  const id = attributeValue(node, 'id');
  return id ? `${tagName(node)}#${id}` : tagName(node) || 'node';
}

function compactText(value) {
  return normalizeText(value).slice(0, 240);
}

function normalizeText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueTextParts(parts) {
  const seen = new Set();
  const result = [];

  for (const part of parts) {
    const text = normalizeText(part);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

function matchesWordBoundary(text, target) {
  const t = String(text || '').toLowerCase();
  const q = String(target || '').toLowerCase();
  if (!q) return false;

  function isBoundary(c) {
    if (!c) return true;
    const code = c.charCodeAt(0);
    return code <= 32 || code === 45 || code === 95 || code === 47 ||
      code === 124 || code === 46 || code === 44 || code === 59 ||
      code === 58 || code === 33 || code === 63 || code === 40 ||
      code === 41 || code === 91 || code === 93 || code === 123 ||
      code === 125 || code === 34 || code === 39;
  }

  let idx = t.indexOf(q);
  while (idx !== -1) {
    const before = idx > 0 ? t[idx - 1] : '';
    const after = idx + q.length < t.length ? t[idx + q.length] : '';
    if (isBoundary(before) && isBoundary(after)) return true;
    idx = t.indexOf(q, idx + 1);
  }
  return false;
}

function semanticTierBonus(node) {
  const tag = tagName(node);
  if (['button', 'a', 'input', 'select', 'textarea', 'label', 'summary'].includes(tag)) return -150;
  if (attributeValue(node, 'role')) return -75;
  return 0;
}

function uniqueNodes(nodes) {
  const seen = new Set();
  const result = [];

  for (const node of nodes) {
    if (!node?.backendNodeId || seen.has(node.backendNodeId)) {
      continue;
    }

    seen.add(node.backendNodeId);
    result.push(node);
  }

  return result;
}

function normalizeShadowPath(locatorOrPath) {
  const path = Array.isArray(locatorOrPath) ? locatorOrPath : [locatorOrPath];

  if (path.length === 0 || path.some(locator => locator === undefined || locator === null)) {
    throw new Error('shadow() expects a shadow host locator or a non-empty array of host locators.');
  }

  return path;
}

function normalizeWaitOptions(options = {}, fallbackTimeout = 5000) {
  if (typeof options === 'number') {
    return {
      timeout: normalizeInteger(options, fallbackTimeout),
      interval: 100
    };
  }

  return {
    timeout: normalizeInteger(options.timeout ?? options.timeoutMs, fallbackTimeout),
    interval: normalizeInteger(options.interval ?? options.intervalMs, 100)
  };
}

function normalizeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function describeShadowLocator(locator) {
  if (locator?.type === 'shadowNode') {
    return `shadow element ${locator.tag || locator.backendNodeId}`;
  }

  return describeLocator(locator);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  OrbitShadow,
  resolveShadowPath
};
