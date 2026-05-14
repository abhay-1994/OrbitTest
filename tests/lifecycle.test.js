const { afterEach, beforeEach, test, expect } = require("orbittest");

const seenStatuses = [];

beforeEach(async (orbit, testInfo) => {
  if (testInfo.file && testInfo.file.endsWith("lifecycle.test.js")) {
    expect(testInfo.status).toBe("running");
    expect(testInfo.attempt).toBe(1);
    expect(testInfo.retry).toBe(0);
  }
});

afterEach(async (orbit, testInfo) => {
  if (testInfo.file && testInfo.file.endsWith("lifecycle.test.js")) {
    seenStatuses.push(testInfo.status);
    expect(Boolean(testInfo.endedAt)).toBe(true);
    expect(testInfo.durationMs >= 0).toBe(true);
  }
});

test("Use global setup and beforeAll", async (orbit, testInfo) => {
  expect(global.__orbitLifecycle.setupLoaded).toBe(true);
  expect(global.__orbitLifecycle.beforeAllRuns).toBe(1);
  expect(Boolean(global.__orbitLifecycle.runId)).toBe(true);
  expect(global.__orbitLifecycle.selectedTests >= 1).toBe(true);
  expect(testInfo.name).toBe("Use global setup and beforeAll");
  expect(testInfo.status).toBe("running");
  expect(testInfo.retries).toBe(0);
});

test("Expose richer testInfo", async (orbit, testInfo) => {
  expect(testInfo.name).toBe("Expose richer testInfo");
  expect(testInfo.file.endsWith("lifecycle.test.js")).toBe(true);
  expect(testInfo.index >= 1).toBe(true);
  expect(testInfo.attempt).toBe(1);
  expect(testInfo.retry).toBe(0);
  expect(testInfo.timeout >= 0).toBe(true);
  expect(Boolean(testInfo.startedAt)).toBe(true);
});

test("Run afterEach with final status", async () => {
  expect(seenStatuses.every(status => status === "passed")).toBe(true);
});
