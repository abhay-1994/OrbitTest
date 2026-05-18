const { test, expect } = require("orbittest");

const CHESS_URL = "https://testtrack.org/3d-chess";
const KEY_DELAY_MS = 180;

test("Play two legal moves on TestTrack 3D Chess", { timeout: 60000 }, async (orbit) => {
  await orbit.open(CHESS_URL);

  expect(await orbit.title()).toContain("Test Track");
  expect(await orbit.exists(orbit.css("canvas"), { timeout: 15000 })).toBe(true);

  await startChessGame(orbit);

  const startHud = await readChessHud(orbit);
  expect(startHud.player).toBe("WHITE");
  expect(startHud.moves).toBe("0");

  await playKeys(orbit, [
    "PageDown", // C3c -> B3c
    "ArrowDown", // B3c -> B2b, a white pawn
    "Space", // select white pawn
    "PageUp", // B2b -> C2b, legal level move
    "Space" // move white pawn
  ]);

  const afterWhiteMove = await readChessHud(orbit);
  expect(afterWhiteMove.player).toBe("BLACK");
  expect(afterWhiteMove.moves).toBe("1");
  expect(afterWhiteMove.selection).toBe("NO SELECTION");

  await playKeys(orbit, [
    "PageUp", // C2b -> D2b
    "ArrowUp", // D2b -> D3c
    "ArrowLeft", // D3c -> D4b, a black pawn
    "Space", // select black pawn
    "PageDown", // D4b -> C4b, legal level move
    "Space" // move black pawn
  ]);

  const afterBlackMove = await readChessHud(orbit);
  expect(afterBlackMove.player).toBe("WHITE");
  expect(afterBlackMove.moves).toBe("2");
  expect(afterBlackMove.selection).toBe("NO SELECTION");
  expect(afterBlackMove.level).toBe("C");
  expect(afterBlackMove.rank).toBe("4");
  expect(afterBlackMove.file).toBe("b");

  await orbit.visual.snapshot("reports/3d-chess-after-two-moves.png");
});

async function startChessGame(orbit) {
  const center = await orbit.evaluate(() => {
    const canvas = document.querySelector("canvas");

    if (!canvas) {
      return null;
    }

    canvas.scrollIntoView({ block: "center", inline: "center" });

    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  });

  expect(Boolean(center)).toBe(true);
  await orbit.mouse.click(center);
  await orbit.wait(500);
}

async function playKeys(orbit, codes) {
  for (const code of codes) {
    await pressChessKey(orbit, code);
  }
}

async function pressChessKey(orbit, code) {
  await orbit.evaluate((eventCode) => {
    const keyByCode = {
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      ArrowUp: "ArrowUp",
      PageDown: "PageDown",
      PageUp: "PageUp",
      Space: " "
    };

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: keyByCode[eventCode] || eventCode,
      code: eventCode,
      bubbles: true,
      cancelable: true
    }));
  }, code);

  await orbit.wait(KEY_DELAY_MS);
}

async function readChessHud(orbit) {
  return orbit.evaluate(() => {
    const lines = document.body.innerText
      .split(/\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const valueAfter = (label) => {
      const index = lines.indexOf(label);
      return index >= 0 ? lines[index + 1] || "" : "";
    };

    return {
      player: valueAfter("PLAYER:"),
      moves: valueAfter("MOVES:"),
      selection: valueAfter("SELECTION"),
      level: lastValueAfter(lines, "LEVEL:"),
      rank: lastValueAfter(lines, "RANK:"),
      file: lastValueAfter(lines, "FILE:")
    };

    function lastValueAfter(source, label) {
      let value = "";

      for (let index = 0; index < source.length; index++) {
        if (source[index] === label) {
          value = source[index + 1] || "";
        }
      }

      return value;
    }
  });
}
