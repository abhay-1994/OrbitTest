const zlib = require("zlib");

function createMouseApi(orbit) {
  return {
    move(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);

      return orbit.traceStep(`mouse.move ${formatPoint(point)}`, () => {
        return orbit.dispatchVisualMouse({
          type: "mouseMoved",
          x: point.x,
          y: point.y
        }, options);
      });
    },

    async down(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);

      return orbit.traceStep(`mouse.down ${formatPoint(point)}`, async () => {
        await orbit.dispatchVisualMouse({
          type: "mouseMoved",
          x: point.x,
          y: point.y
        }, options);
        return orbit.dispatchVisualMouse({
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button: normalizeMouseButton(options.button),
          clickCount: normalizeClickCount(options.clickCount, 1)
        }, options);
      });
    },

    async up(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);

      return orbit.traceStep(`mouse.up ${formatPoint(point)}`, async () => {
        await orbit.dispatchVisualMouse({
          type: "mouseMoved",
          x: point.x,
          y: point.y
        }, options);
        return orbit.dispatchVisualMouse({
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button: normalizeMouseButton(options.button),
          clickCount: normalizeClickCount(options.clickCount, 1)
        }, options);
      });
    },

    async click(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);
      const button = normalizeMouseButton(options.button);
      const clickCount = normalizeClickCount(options.clickCount, 1);

      return orbit.traceStep(`mouse.click ${formatPoint(point)}`, async () => {
        await orbit.dispatchVisualMouse({
          type: "mouseMoved",
          x: point.x,
          y: point.y
        }, options);
        await orbit.dispatchVisualMouse({
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button,
          clickCount
        }, options);
        return orbit.dispatchVisualMouse({
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button,
          clickCount
        }, options);
      });
    },

    doubleClick(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);
      return this.click(point, {
        ...options,
        clickCount: 2
      });
    },

    rightClick(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);
      return this.click(point, {
        ...options,
        button: "right"
      });
    },

    async drag(from, to, options = {}) {
      const start = normalizePoint(from);
      const end = normalizePoint(to);
      const steps = normalizeNonNegativeInteger(options.steps, 12) || 1;
      const button = normalizeMouseButton(options.button);

      return orbit.traceStep(`mouse.drag ${formatPoint(start)} to ${formatPoint(end)}`, async () => {
        await orbit.dispatchVisualMouse({
          type: "mouseMoved",
          x: start.x,
          y: start.y
        }, options);
        await orbit.dispatchVisualMouse({
          type: "mousePressed",
          x: start.x,
          y: start.y,
          button,
          clickCount: 1
        }, options);

        for (let i = 1; i <= steps; i++) {
          const ratio = i / steps;
          await orbit.dispatchVisualMouse({
            type: "mouseMoved",
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio,
            button
          }, options);
        }

        return orbit.dispatchVisualMouse({
          type: "mouseReleased",
          x: end.x,
          y: end.y,
          button,
          clickCount: 1
        }, options);
      });
    },

    async wheel(deltaX = 0, deltaY = 0, options = {}) {
      const point = options.point ? normalizePoint(options.point) : await getViewportCenter(orbit);

      return orbit.traceStep(`mouse.wheel ${deltaX},${deltaY}`, () => {
        return orbit.dispatchVisualMouse({
          type: "mouseWheel",
          x: point.x,
          y: point.y,
          deltaX: Number(deltaX) || 0,
          deltaY: Number(deltaY) || 0
        }, options);
      });
    }
  };
}

function createVisualApi(orbit) {
  let lastFrame = null;

  return {
    clickAt(pointOrX, yOrOptions, maybeOptions) {
      return orbit.mouse.click(pointOrX, yOrOptions, maybeOptions);
    },

    drag(from, to, options) {
      return orbit.mouse.drag(from, to, options);
    },

    snapshot(filePath, options = {}) {
      return orbit.traceStep(`visual.snapshot ${filePath}`, () => orbit.screenshot(filePath, options));
    },

    async capture(options = {}) {
      return orbit.traceStep("visual.capture", async () => {
        lastFrame = await orbit.captureVisualFrame(options);
        return lastFrame;
      });
    },

    async changed(actionOrOptions = {}, maybeOptions = {}) {
      const hasAction = typeof actionOrOptions === "function";
      const options = hasAction ? maybeOptions : actionOrOptions;

      return orbit.traceStep("visual.changed", async () => {
        const before = lastFrame || await orbit.captureVisualFrame(options);

        if (hasAction) {
          await actionOrOptions();
          await delay(normalizeNonNegativeInteger(options.wait ?? options.waitMs, 250));
        }

        const after = await orbit.captureVisualFrame(options);
        lastFrame = after;
        return before !== after;
      });
    },

    hasChanged(actionOrOptions = {}, maybeOptions = {}) {
      return this.changed(actionOrOptions, maybeOptions);
    },

    async expectChanged(action, options = {}) {
      const changed = await this.changed(action, options);

      if (!changed) {
        throw new Error("Expected the screen to change, but the captured frame stayed the same.");
      }

      return true;
    },

    async waitForStable(options = {}) {
      const timeout = normalizeNonNegativeInteger(options.timeout ?? options.timeoutMs, 5000);
      const interval = normalizeNonNegativeInteger(options.interval ?? options.intervalMs, 250);
      const stableFrames = Math.max(1, normalizeNonNegativeInteger(options.stableFrames, 2));
      const startedAt = Date.now();
      let previous = await orbit.captureVisualFrame(options);
      let stableCount = 0;

      return orbit.traceStep("visual.waitForStable", async () => {
        while (Date.now() - startedAt <= timeout) {
          await delay(interval);
          const current = await orbit.captureVisualFrame(options);

          if (current === previous) {
            stableCount++;

            if (stableCount >= stableFrames) {
              lastFrame = current;
              return true;
            }
          } else {
            stableCount = 0;
          }

          previous = current;
        }

        throw new Error(`Timed out after ${timeout}ms waiting for the screen to become stable.`);
      });
    },

    pixel(pointOrX, yOrOptions, maybeOptions) {
      const { point, options } = parsePointArgs(pointOrX, yOrOptions, maybeOptions);
      return orbit.traceStep(`visual.pixel ${formatPoint(point)}`, () => orbit.readVisualPixel(point, options));
    },

    async expectPixel(pointOrX, yOrColor, colorOrOptions, maybeOptions) {
      const { point, color, options } = parsePixelExpectationArgs(pointOrX, yOrColor, colorOrOptions, maybeOptions);
      const expected = parseColor(color);
      const tolerance = normalizeNonNegativeInteger(options.tolerance, 0);
      const actual = await this.pixel(point, options);
      const distance = colorDistance(actual, expected);

      if (distance > tolerance) {
        throw new Error(`Expected pixel ${formatPoint(point)} to be ${expected.hex}, but found ${actual.hex} (distance ${distance}, tolerance ${tolerance}).`);
      }

      return actual;
    },

    async findColor(color, options = {}) {
      return orbit.traceStep(`visual.findColor ${color}`, async () => {
        const expected = parseColor(color);
        const tolerance = normalizeNonNegativeInteger(options.tolerance, 8);
        const step = Math.max(1, normalizeNonNegativeInteger(options.step, 1));
        const base64 = await orbit.captureVisualFrame(options);
        const image = decodePng(Buffer.from(base64, "base64"));
        const dpr = options.devicePixels ? 1 : await orbit.getDeviceScaleFactor();
        const region = normalizeImageRegion(options.region, image, dpr);
        let best = null;

        for (let y = region.y; y < region.y + region.height; y += step) {
          for (let x = region.x; x < region.x + region.width; x += step) {
            const pixel = image.getPixel(x, y);
            const distance = colorDistance(pixel, expected);

            if (!best || distance < best.distance) {
              best = {
                x: Math.round(x / dpr),
                y: Math.round(y / dpr),
                deviceX: x,
                deviceY: y,
                color: rgbToHex(pixel.r, pixel.g, pixel.b),
                distance
              };
            }

            if (distance <= tolerance) {
              return best;
            }
          }
        }

        return null;
      });
    },

    async clickColor(color, options = {}) {
      const match = await this.findColor(color, options);

      if (!match) {
        throw new Error(`Could not find color ${color} on the current screen.`);
      }

      await orbit.mouse.click({ x: match.x, y: match.y }, options);
      return match;
    }
  };
}

function parsePointArgs(pointOrX, yOrOptions, maybeOptions) {
  if (isPointLike(pointOrX)) {
    return {
      point: normalizePoint(pointOrX),
      options: yOrOptions && typeof yOrOptions === "object" ? yOrOptions : {}
    };
  }

  return {
    point: normalizePoint({
      x: pointOrX,
      y: yOrOptions
    }),
    options: maybeOptions && typeof maybeOptions === "object" ? maybeOptions : {}
  };
}

function parsePixelExpectationArgs(pointOrX, yOrColor, colorOrOptions, maybeOptions) {
  if (pointOrX && typeof pointOrX === "object" && pointOrX.color !== undefined) {
    return {
      point: normalizePoint(pointOrX),
      color: pointOrX.color,
      options: yOrColor && typeof yOrColor === "object" ? yOrColor : {}
    };
  }

  if (isPointLike(pointOrX)) {
    return {
      point: normalizePoint(pointOrX),
      color: yOrColor,
      options: colorOrOptions && typeof colorOrOptions === "object" ? colorOrOptions : {}
    };
  }

  return {
    point: normalizePoint({
      x: pointOrX,
      y: yOrColor
    }),
    color: colorOrOptions,
    options: maybeOptions && typeof maybeOptions === "object" ? maybeOptions : {}
  };
}

function isPointLike(value) {
  return value && typeof value === "object" && value.x !== undefined && value.y !== undefined;
}

function normalizePoint(point, fallbackY = null) {
  const source = isPointLike(point)
    ? point
    : {
      x: point,
      y: fallbackY
    };
  const x = Number(source.x);
  const y = Number(source.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Invalid point: expected numeric x/y, received ${JSON.stringify(point)}.`);
  }

  return {
    x,
    y
  };
}

function formatPoint(point) {
  return `(${Math.round(point.x)}, ${Math.round(point.y)})`;
}

function normalizeMouseButton(button) {
  const normalized = String(button || "left").toLowerCase();

  if (["left", "right", "middle", "back", "forward"].includes(normalized)) {
    return normalized;
  }

  return "left";
}

function normalizeClickCount(value, fallback) {
  const count = normalizeNonNegativeInteger(value, fallback);
  return count > 0 ? count : fallback;
}

async function getViewportCenter(orbit) {
  try {
    const size = await orbit.evaluateOnPage("({ width: window.innerWidth, height: window.innerHeight })", [], { timeout: 1000 });

    return {
      x: Math.round(Number(size?.width || 0) / 2),
      y: Math.round(Number(size?.height || 0) / 2)
    };
  } catch (error) {
    return {
      x: 0,
      y: 0
    };
  }
}

function parseColor(color) {
  if (typeof color === "string") {
    const value = color.trim();
    const hex = value.startsWith("#") ? value.slice(1) : value;

    if (/^[\da-f]{3}$/i.test(hex)) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 255, hex: rgbToHex(r, g, b) };
    }

    if (/^[\da-f]{6}$/i.test(hex)) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 255, hex: rgbToHex(r, g, b) };
    }

    const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i);
    if (rgb) {
      const r = clampInteger(Number(rgb[1]), 0, 255);
      const g = clampInteger(Number(rgb[2]), 0, 255);
      const b = clampInteger(Number(rgb[3]), 0, 255);
      const a = rgb[4] === undefined ? 255 : clampInteger(Math.round(Number(rgb[4]) * 255), 0, 255);
      return { r, g, b, a, hex: rgbToHex(r, g, b) };
    }
  }

  if (color && typeof color === "object") {
    const r = clampInteger(Number(color.r), 0, 255);
    const g = clampInteger(Number(color.g), 0, 255);
    const b = clampInteger(Number(color.b), 0, 255);
    const a = color.a === undefined ? 255 : clampInteger(Number(color.a), 0, 255);
    return { r, g, b, a, hex: rgbToHex(r, g, b) };
  }

  throw new Error(`Invalid color: ${color}`);
}

function colorDistance(actual, expected) {
  return Math.max(
    Math.abs(Number(actual.r) - expected.r),
    Math.abs(Number(actual.g) - expected.g),
    Math.abs(Number(actual.b) - expected.b)
  );
}

function rgbToHex(r, g, b) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value) {
  return clampInteger(Number(value), 0, 255).toString(16).padStart(2, "0");
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeImageRegion(region, image, dpr = 1) {
  if (!region) {
    return {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height
    };
  }

  const x = clampInteger(Number(region.x || 0) * dpr, 0, image.width - 1);
  const y = clampInteger(Number(region.y || 0) * dpr, 0, image.height - 1);
  const maxWidth = image.width - x;
  const maxHeight = image.height - y;
  const width = clampInteger(Number(region.width || maxWidth) * dpr, 1, maxWidth);
  const height = clampInteger(Number(region.height || maxHeight) * dpr, 1, maxHeight);

  return { x, y, width, height };
}

function pickScreenshotOptions(options = {}) {
  const picked = {};

  for (const key of ["format", "quality", "clip", "fromSurface", "captureBeyondViewport", "optimizeForSpeed"]) {
    if (options[key] !== undefined) {
      picked[key] = options[key];
    }
  }

  return picked;
}

function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";

  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Invalid PNG image data.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![0, 2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bit depth ${bitDepth}, color type ${colorType}.`);
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const raw = Buffer.alloc(width * height * channels);
  let inputOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const line = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    const recon = Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? recon[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      let value;

      if (filter === 0) {
        value = line[x];
      } else if (filter === 1) {
        value = line[x] + left;
      } else if (filter === 2) {
        value = line[x] + up;
      } else if (filter === 3) {
        value = line[x] + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value = line[x] + paethPredictor(left, up, upLeft);
      } else {
        throw new Error(`Unsupported PNG filter: ${filter}.`);
      }

      recon[x] = value & 0xff;
    }

    recon.copy(raw, outputOffset);
    outputOffset += stride;
    previous = recon;
  }

  return {
    width,
    height,
    getPixel(x, y) {
      const safeX = clampInteger(x, 0, width - 1);
      const safeY = clampInteger(y, 0, height - 1);
      const index = (safeY * width + safeX) * channels;

      if (colorType === 0) {
        const value = raw[index];
        return { r: value, g: value, b: value, a: 255 };
      }

      return {
        r: raw[index],
        g: raw[index + 1],
        b: raw[index + 2],
        a: channels === 4 ? raw[index + 3] : 255
      };
    }
  };
}

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);

  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function normalizeNonNegativeInteger(value, fallback) {
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
  clampInteger,
  createMouseApi,
  createVisualApi,
  decodePng,
  normalizePoint,
  pickScreenshotOptions,
  rgbToHex
};
