const { test, expect } = require("orbittest");
const {
  discoverTestFiles,
  mergeCiOptions,
  normalizeConfig,
  parseShardValue,
  resolveBrowserDisplay
} = require("../core/config");

test("Normalize config boundaries", async () => {
  const config = normalizeConfig({
    testMatch: "**/*.test.js",
    globalSetup: "tests/setup.js",
    browser: "hide",
    experimental: {
      apiTesting: true
    },
    ci: {
      enabled: true,
      retries: 2
    }
  });

  expect(config.testMatch[0]).toBe("**/*.test.js");
  expect(config.globalSetup[0]).toBe("tests/setup.js");
  expect(config.browser.display).toBe("hide");
  expect(config.experimental.studio).toBe(true);
  expect(config.experimental.visualAutomation).toBe(true);
  expect(config.experimental.apiTesting).toBe(true);
  expect(config.ci.enabled).toBe(true);
  expect(config.ci.retries).toBe(2);
});

test("Resolve CLI display and CI options", async () => {
  const config = normalizeConfig({
    browser: {
      display: "auto"
    },
    ci: {
      enabled: false
    }
  });

  const localCi = mergeCiOptions(config.ci, {
    ci: null,
    failFast: null,
    maxFailures: null,
    shard: null,
    githubAnnotations: null
  });
  const forcedCi = mergeCiOptions(config.ci, {
    ci: true,
    failFast: true,
    maxFailures: "3",
    shard: "1/2",
    githubAnnotations: true
  });

  expect(resolveBrowserDisplay({ step: false, browserDisplay: null }, config, localCi)).toBe("show");
  expect(resolveBrowserDisplay({ step: false, browserDisplay: null }, config, forcedCi)).toBe("hide");
  expect(resolveBrowserDisplay({ step: true, browserDisplay: null }, config, forcedCi)).toBe("show");
  expect(forcedCi.failFast).toBe(true);
  expect(forcedCi.maxFailures).toBe(3);
  expect(forcedCi.shard).toBe("1/2");
  expect(Boolean(parseShardValue("1/2"))).toBe(true);
});

test("Discover explicit test file", async () => {
  const config = normalizeConfig({});
  const files = discoverTestFiles(["tests/example.test.js"], config, process.cwd());

  expect(files.length).toBe(1);
  expect(files[0].includes("example.test.js")).toBe(true);
});
