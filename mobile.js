// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

'use strict';

const root = require('./orbit');
const { loadMobileProvider } = require('./core/providers/mobile');

const { Key } = loadMobileProvider();

function mobileTest(name, options, fn) {
  const testFn = typeof options === 'function' ? options : fn;
  const testOptions = typeof options === 'function' ? {} : options || {};

  if (typeof testFn !== 'function') {
    throw new Error(`Test "${name}" must include a function.`);
  }

  return root.test(name, testOptions, async (context) => {
    const orbit = requireMobileContext(context);
    return testFn(orbit, context.testInfo);
  });
}

function requireMobileContext(context) {
  const orbit = context && (context.orbit || context.mobile);

  if (!orbit) {
    throw new Error('Mobile context is not configured. Check orbittest.config.js and @orbittest/mobile.');
  }

  return orbit;
}

module.exports = {
  ...root,
  Key,
  test: mobileTest,
  it: mobileTest
};
