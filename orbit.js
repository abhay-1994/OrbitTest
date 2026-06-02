// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

const Orbit = require('./core/orbit');
const { afterAll, afterEach, beforeAll, beforeEach, describe, test, run, expect } = require('./runner/runner');

module.exports = Orbit;
module.exports.Orbit = Orbit;
module.exports.test = test;
module.exports.describe = describe;
module.exports.beforeAll = beforeAll;
module.exports.afterAll = afterAll;
module.exports.beforeEach = beforeEach;
module.exports.afterEach = afterEach;
module.exports.expect = expect;
module.exports.run = run;
module.exports.defineConfig = (config) => config;
