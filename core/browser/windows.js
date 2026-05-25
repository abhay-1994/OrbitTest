// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function normalizeWindowWaitOptions(options = {}) {
  if (typeof options === 'number' || typeof options === 'string' || options instanceof RegExp || typeof options === 'function') {
    return {
      timeout: typeof options === 'number' ? normalizeWindowNonNegativeInteger(options, 5000) : 5000,
      interval: 150,
      switchTo: false,
      excludeCurrent: true,
      selector: typeof options === 'number' ? null : options,
      id: null,
      url: null,
      title: null,
      index: null,
      predicate: null
    };
  }

  const source = options && typeof options === 'object' ? options : {};
  const index = source.index === undefined ? null : normalizeWindowIndexValue(source.index);

  return {
    timeout: normalizeWindowNonNegativeInteger(source.timeout ?? source.timeoutMs, 5000),
    interval: normalizeWindowNonNegativeInteger(source.interval ?? source.intervalMs, 150),
    switchTo: Boolean(source.switchTo),
    excludeCurrent: source.excludeCurrent !== false && source.includeCurrent !== true,
    selector: source.selector ?? null,
    id: source.id ?? source.targetId ?? null,
    url: source.url ?? source.href ?? null,
    title: source.title ?? source.name ?? null,
    index,
    predicate: typeof source.predicate === 'function'
      ? source.predicate
      : typeof source.match === 'function'
        ? source.match
        : null
  };
}

function matchesWindowTarget(target, options = {}) {
  if (options.index !== null && options.index !== undefined) {
    if (target.index !== options.index) {
      return false;
    }
  }

  if (options.id) {
    if (target.id !== String(options.id)) {
      return false;
    }
  }

  if (options.url !== null && options.url !== undefined) {
    if (!matchesWindowValue(target.url, options.url, target)) {
      return false;
    }
  }

  if (options.title !== null && options.title !== undefined) {
    if (!matchesWindowValue(target.title, options.title, target)) {
      return false;
    }
  }

  if (options.selector !== null && options.selector !== undefined) {
    if (!matchesWindowSelector(target, options.selector)) {
      return false;
    }
  }

  if (options.predicate) {
    if (!options.predicate(target)) {
      return false;
    }
  }

  return true;
}

function resolveWindowTarget(targets, selector = 0) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return null;
  }

  if (typeof selector === 'number') {
    return getTargetAtIndex(targets, selector);
  }

  if (typeof selector === 'string') {
    const value = selector.trim();

    if (!value) {
      return null;
    }

    return targets.find(target => target.id === value) ||
      targets.find(target => target.url === value || target.title === value) ||
      targets.find(target => matchesWindowSelector(target, value)) ||
      null;
  }

  if (selector instanceof RegExp || typeof selector === 'function') {
    return targets.find(target => matchesWindowSelector(target, selector)) || null;
  }

  if (selector && typeof selector === 'object') {
    if (selector.index !== undefined) {
      return getTargetAtIndex(targets, normalizeWindowIndexValue(selector.index));
    }

    const targetId = selector.id ?? selector.targetId;

    if (targetId) {
      const byId = targets.find(target => target.id === String(targetId));

      if (byId) {
        return byId;
      }
    }

    const opts = normalizeWindowWaitOptions({
      ...selector,
      excludeCurrent: false
    });

    return targets.find((target, index) => matchesWindowTarget({ ...target, index }, opts)) || null;
  }

  return null;
}

function orderTargets(targets, order) {
  const byId = new Map(targets.map(target => [target.id, target]));
  const ordered = [];
  const seen = new Set();

  for (const id of order) {
    const target = byId.get(id);

    if (target) {
      ordered.push(target);
      seen.add(id);
    }
  }

  for (const target of targets) {
    if (!seen.has(target.id)) {
      ordered.push(target);
    }
  }

  return ordered;
}

function formatWindowSelector(selector) {
  if (selector === null || selector === undefined) {
    return 'current window/tab';
  }

  if (typeof selector === 'number') {
    return `index ${selector}`;
  }

  if (typeof selector === 'string') {
    return `"${selector}"`;
  }

  if (selector instanceof RegExp) {
    return selector.toString();
  }

  if (typeof selector === 'function') {
    return 'predicate function';
  }

  if (selector && typeof selector === 'object') {
    const entries = ['index', 'id', 'targetId', 'url', 'title', 'name']
      .filter(key => selector[key] !== undefined)
      .map(key => `${key}: ${String(selector[key])}`);

    return entries.length ? `{ ${entries.join(', ')} }` : 'window selector object';
  }

  return String(selector);
}

function matchesWindowSelector(target, selector) {
  if (typeof selector === 'string') {
    const value = selector.trim();

    return target.id === value ||
      matchesWindowValue(target.url, value, target) ||
      matchesWindowValue(target.title, value, target);
  }

  if (selector instanceof RegExp) {
    return matchesWindowValue(target.id, selector, target) ||
      matchesWindowValue(target.url, selector, target) ||
      matchesWindowValue(target.title, selector, target);
  }

  if (typeof selector === 'function') {
    return Boolean(selector(target));
  }

  if (selector && typeof selector === 'object') {
    const opts = normalizeWindowWaitOptions({
      ...selector,
      excludeCurrent: false
    });

    return matchesWindowTarget(target, opts);
  }

  return false;
}

function matchesWindowValue(value, pattern, target) {
  const text = String(value || '');

  if (Array.isArray(pattern)) {
    return pattern.some(current => matchesWindowValue(value, current, target));
  }

  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }

  if (typeof pattern === 'function') {
    return Boolean(pattern(text, target));
  }

  const expected = String(pattern ?? '').trim();

  if (!expected) {
    return text === '';
  }

  return text === expected || text.includes(expected);
}

function getTargetAtIndex(targets, index) {
  if (!Number.isInteger(index)) {
    return null;
  }

  const normalized = index < 0 ? targets.length + index : index;

  return targets[normalized] || null;
}

function normalizeWindowIndexValue(value) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return Number.NaN;
  }

  return number;
}

function normalizeWindowNonNegativeInteger(value, fallback) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

module.exports = {
  normalizeWindowWaitOptions,
  matchesWindowTarget,
  resolveWindowTarget,
  orderTargets,
  formatWindowSelector,
  matchesWindowSelector,
  matchesWindowValue,
  getTargetAtIndex,
  normalizeWindowIndexValue
};
