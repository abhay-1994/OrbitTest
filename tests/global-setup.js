const { afterAll, beforeAll } = require("orbittest");

global.__orbitLifecycle = {
  setupLoaded: true,
  beforeAllRuns: 0,
  afterAllRuns: 0,
  afterAllSelectedTests: 0,
  afterAllStatus: null
};

beforeAll(async (runInfo) => {
  global.__orbitLifecycle.beforeAllRuns += 1;
  global.__orbitLifecycle.runId = runInfo.runId;
  global.__orbitLifecycle.selectedTests = runInfo.selectedTests;
});

afterAll(async (runInfo) => {
  global.__orbitLifecycle.afterAllRuns += 1;
  global.__orbitLifecycle.afterAllSelectedTests = runInfo.selectedTests;
  global.__orbitLifecycle.afterAllStatus = runInfo.status;
});
