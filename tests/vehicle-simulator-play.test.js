const { test, expect } = require("orbittest");

const SIMULATOR_URL = "https://testtrack.org/vehicle-simulator";
const KEY_INFO = {
  KeyW: { code: "KeyW", key: "w" },
  KeyS: { code: "KeyS", key: "s" },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft" },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight" }
};

test("Drive TestTrack vehicle simulator to the target zone", { timeout: 90000 }, async (orbit) => {
  await orbit.open(SIMULATOR_URL, { timeout: 30000 });

  expect(await orbit.title()).toContain("Test Track");
  await orbit.waitForText("VEHICLE SIMULATOR", { timeout: 15000 });
  expect(await orbit.exists(orbit.css("canvas"), { timeout: 15000 })).toBe(true);

  await startSimulation(orbit);

  const route = await driveToTarget(orbit);
  await releaseAllKeys(orbit, route.pressed);
  await orbit.visual.snapshot("reports/vehicle-simulator-target-reached.png");

  console.log(
    `Vehicle simulator final telemetry: X=${route.final.x.toFixed(2)}, Y=${route.final.z.toFixed(2)}, ` +
    `distance=${route.final.distance.toFixed(1)}m, status=${route.final.targetStatus}`
  );

  if (!route.success) {
    throw new Error(`Vehicle did not reach target zone. Final telemetry: ${JSON.stringify(route.final)}`);
  }

  expect(route.final.targetStatus).toBe("TARGET REACHED");
  expect(route.final.objectiveComplete).toBe(true);
});

async function startSimulation(orbit) {
  await orbit.evaluate(() => {
    const startButton = [...document.querySelectorAll("button")]
      .find(button => button.textContent.includes("START"));

    if (startButton) {
      startButton.click();
    }
  });

  await waitUntil(orbit, async () => {
    const telemetry = await readTelemetry(orbit);
    return telemetry.active;
  }, 5000, "simulation to become active");
}

async function driveToTarget(orbit) {
  const pressed = new Set();
  const waypoints = [
    { name: "left lane south", x: -40, z: -35, radius: 8 },
    { name: "cross lower gap", x: -5, z: -35, radius: 8 },
    { name: "middle lane north", x: 0, z: 45, radius: 8 },
    { name: "cross upper gap", x: 40, z: 45, radius: 8 },
    { name: "target zone", x: 40, z: -40, radius: 8 }
  ];

  const state = {
    current: await readTelemetry(orbit),
    previous: null,
    heading: 0
  };
  state.previous = state.current;

  for (const waypoint of waypoints) {
    const reached = await driveToWaypoint(orbit, pressed, waypoint, state);

    await releaseAllKeys(orbit, pressed);
    await orbit.wait(350);

    state.current = await readTelemetry(orbit);
    state.previous = state.current;

    if (!reached && !state.current.objectiveComplete) {
      return { success: false, final: state.current, pressed };
    }
  }

  return {
    success: state.current.objectiveComplete,
    final: state.current,
    pressed
  };
}

async function driveToWaypoint(orbit, pressed, waypoint, state) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 25000) {
    state.current = await readTelemetry(orbit);
    updateHeadingEstimate(state);

    const distance = distanceTo(waypoint, state.current);

    if (state.current.objectiveComplete || distance <= waypoint.radius) {
      return true;
    }

    const desiredHeading = Math.atan2(waypoint.x - state.current.x, -(waypoint.z - state.current.z));
    const headingError = normalizeAngle(desiredHeading - state.heading);
    const wantedKeys = chooseDriveKeys(state.current, headingError, distance);

    await setKeys(orbit, pressed, wantedKeys);
    state.previous = state.current;
    await orbit.wait(100);
  }

  console.log(`Timed out driving to ${waypoint.name}`);
  return false;
}

function updateHeadingEstimate(state) {
  const movedX = state.current.x - state.previous.x;
  const movedZ = state.current.z - state.previous.z;
  const moved = Math.hypot(movedX, movedZ);

  if (moved > 0.05) {
    state.heading = Math.atan2(movedX, -movedZ);
  }
}

function chooseDriveKeys(telemetry, headingError, distance) {
  const wanted = [];
  const needsSharpTurn = Math.abs(headingError) > 0.6;
  const closeToWaypoint = distance < 14;
  const tooFastClose = closeToWaypoint && telemetry.speed > 5;

  if (!tooFastClose && (!needsSharpTurn || telemetry.speed < 10)) {
    wanted.push("KeyW");
  }

  if (tooFastClose) {
    wanted.push("KeyS");
  }

  if (Math.abs(headingError) > 0.08 && telemetry.speed > 0.2) {
    wanted.push(headingError > 0 ? "ArrowRight" : "ArrowLeft");
  }

  return wanted;
}

async function readTelemetry(orbit) {
  return orbit.evaluate(() => {
    const lines = document.body.innerText
      .split(/\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const valueAfterLast = (label) => {
      let value = "";

      for (let index = 0; index < lines.length; index++) {
        if (lines[index] === label) {
          value = lines[index + 1] || "";
        }
      }

      return value;
    };

    const targetStatus = [...lines].reverse()
      .find(line => line === "TARGET REACHED" || line === "EN ROUTE") || "";

    return {
      active: lines.includes("STATUS: ACTIVE"),
      speed: parseNumber(valueAfterLast("SPEED:")),
      heading: parseNumber(valueAfterLast("HEADING:")),
      x: parseNumber(valueAfterLast("X:")),
      z: parseNumber(valueAfterLast("Y:")),
      altitude: parseNumber(valueAfterLast("Z:")),
      distance: parseNumber(valueAfterLast("DISTANCE:")),
      targetStatus,
      objectiveComplete: targetStatus === "TARGET REACHED"
    };

    function parseNumber(value) {
      const match = String(value).match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : 0;
    }
  });
}

async function setKeys(orbit, pressed, wantedList) {
  const wanted = new Set(wantedList);

  for (const code of Object.keys(KEY_INFO)) {
    if (wanted.has(code) && !pressed.has(code)) {
      await dispatchKey(orbit, "keydown", KEY_INFO[code]);
      pressed.add(code);
    } else if (!wanted.has(code) && pressed.has(code)) {
      await dispatchKey(orbit, "keyup", KEY_INFO[code]);
      pressed.delete(code);
    }
  }
}

async function releaseAllKeys(orbit, pressed) {
  await setKeys(orbit, pressed, []);
}

async function dispatchKey(orbit, type, info) {
  await orbit.evaluate((eventType, eventCode, eventKey) => {
    window.dispatchEvent(new KeyboardEvent(eventType, {
      key: eventKey,
      code: eventCode,
      bubbles: true,
      cancelable: true
    }));
  }, type, info.code, info.key);
}

async function waitUntil(orbit, predicate, timeoutMs, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await orbit.wait(100);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function distanceTo(waypoint, telemetry) {
  return Math.hypot(waypoint.x - telemetry.x, waypoint.z - telemetry.z);
}

function normalizeAngle(angle) {
  let normalized = angle;

  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }

  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }

  return normalized;
}
