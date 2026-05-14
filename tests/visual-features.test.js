const { test, expect } = require("orbittest");

test("Automate canvas apps with visual APIs", async (orbit) => {
  await orbit.open(dataPage(`
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      canvas { display: block; width: 220px; height: 140px; }
    </style>
    <canvas id="stage" width="220" height="140"></canvas>
    <script>
      const canvas = document.querySelector("#stage");
      const ctx = canvas.getContext("2d");

      window.paint = color => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };

      canvas.addEventListener("click", () => {
        document.body.dataset.clicked = "yes";
      });

      window.paint("#ff0000");
    </script>
  `));

  expect(await orbit.evaluate((a, b) => a + b, 2, 3)).toBe(5);
  await orbit.visual.expectPixel({ x: 30, y: 30 }, "#ff0000", { tolerance: 2 });

  const changed = await orbit.visual.changed(async () => {
    await orbit.evaluate(() => window.paint("#0000ff"));
  });
  expect(changed).toBe(true);

  const blue = await orbit.visual.findColor("#0000ff", { tolerance: 2, step: 4 });
  expect(Boolean(blue)).toBe(true);

  await orbit.mouse.click(20, 20);
  expect(await orbit.evaluate(() => document.body.dataset.clicked)).toBe("yes");
});

function dataPage(html) {
  return `data:text/html,${encodeURIComponent(html)}`;
}
