const vm = require("vm");
const { test, expect } = require("orbittest");
const { startStudioServer } = require("../runner/studio-server");

test("Studio serves parseable HTML and project state", async () => {
  let studio = null;

  try {
    studio = await startStudioServer({
      root: process.cwd(),
      host: "127.0.0.1",
      port: 0
    });

    const htmlResponse = await fetch(studio.url);
    const html = await htmlResponse.text();
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(htmlResponse.status).toBe(200);
    expect(Boolean(scriptMatch)).toBe(true);
    expect(html.includes('id="playerPlayButton"')).toBe(true);
    expect(html.includes('id="frameScrubber"')).toBe(true);
    expect(html.includes('id="liveFrameUrl"')).toBe(true);
    expect(html.includes('class="browser-shell"')).toBe(true);
    expect(html.includes('id="frameStrip"')).toBe(false);
    expect(html.includes("scrollIntoView")).toBe(false);
    expect(html.includes("ensurePlayerInViewport")).toBe(true);
    expect(html.includes("pointerdown")).toBe(true);
    new vm.Script(scriptMatch[1], { filename: "studio-inline.js" });

    const baseUrl = studio.url.replace(/\/$/, "");
    const stateResponse = await fetch(`${baseUrl}/api/state`);
    const state = await stateResponse.json();

    expect(stateResponse.status).toBe(200);
    expect(state.project.name).toBeTruthy();
    expect(Array.isArray(state.tests)).toBe(true);
    expect(state.tests.length > 0).toBe(true);
  } finally {
    if (studio) {
      await studio.close();
    }
  }
});
