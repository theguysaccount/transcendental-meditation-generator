// End-to-end test of the real pages in headless Chrome.
//   node scripts/e2e.mjs                 # serve dist/ locally and test it
//   node scripts/e2e.mjs https://host/x/ # test a live site
//   node scripts/e2e.mjs --screens [url] # also save screenshots to docs/screens/
// Plays a real one-minute session (captions arrive on cue, pause holds the clock, end shows a link
// that replays the same session), renders sessions offline to check the sound itself (audible, never
// clipping, the binaural tone differs between ears), and checks every page for console errors,
// network requests (there must be none to other sites) and phone-width overflow.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve, sleep } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const screens = args.includes("--screens");
let base = args.find((a) => !a.startsWith("--"));
let server = null;
if (!base) {
  server = await serve(path.join(ROOT, "dist"));
  base = server.url;
}
if (!base.endsWith("/")) base += "/";
const origin = new URL(base).origin;
const shot = (page, name, opts) => (screens ? page.screenshot(path.join(ROOT, "docs", "screens", `${name}.png`), opts) : null);
const log = (...m) => console.log(...m);

const browser = await launch();
const failures = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    log(`FAIL ${name}: ${e.stack || e.message}`);
  }
}

const page = await browser.newPage();
await page.viewport(1280, 900);
let firstPlan = null;
let link = "";

await step("home: the builder, today's session and every practice are there", async () => {
  await page.goto(base);
  await page.eval("localStorage.clear()");
  await page.goto(base);
  assert.match(await page.eval("document.querySelector('h1').textContent"), /meditation session/i);
  assert.match(await page.eval("document.querySelector('#daily-what').textContent"), /^\d+-minute /);
  assert.equal(await page.eval("document.querySelectorAll('input[name=p]').length"), 9);
  assert.match(await page.eval("document.querySelector('#summary').textContent"), /10 minutes/);
  await shot(page, "home-desktop", { fullPage: true });
});

await step("session: starts, speaks its first line on cue, pauses and resumes", async () => {
  await page.goto(base + "#len=1&p=breath&g=full&seed=e2etest1");
  await page.waitFor("document.querySelector('#summary').textContent.startsWith('1 minute ·')", "the settings from the link");
  await page.click("#builder button[type=submit]");
  await page.waitFor("document.body.dataset.session === 'playing'", "the session to start");
  firstPlan = await page.eval("window.__humbell.plan()");
  assert.equal(firstPlan.duration, 60);
  assert.ok(firstPlan.cues.length >= 2, "a 1-minute session with full guidance has cues");
  const first = firstPlan.cues[0];
  await page.waitFor(`window.__humbell.elapsed() > ${first.t + 0.6}`, "the first cue time", 20000);
  assert.equal(await page.eval("document.querySelector('#caption').textContent"), first.text, "caption shows the first line");
  await shot(page, "session-desktop");
  await page.click("#pause");
  await page.waitFor("document.body.dataset.session === 'paused'", "pause");
  const held = await page.eval("document.querySelector('#clock').textContent");
  await sleep(1600);
  assert.equal(await page.eval("document.querySelector('#clock').textContent"), held, "the clock holds while paused");
  await page.click("#pause");
  await page.waitFor("document.body.dataset.session === 'playing'", "resume");
  await sleep(1300);
  assert.notEqual(await page.eval("document.querySelector('#clock').textContent"), held, "the clock moves again");
});

await step("end: offers the same session again, a link to it, and a favourite", async () => {
  await page.click("#end");
  await page.waitFor("!document.querySelector('#done').hidden", "the end panel");
  link = await page.eval("document.querySelector('#done-link').value");
  assert.match(link, /seed=e2etest1/);
  await page.click("#fav");
  const favs = await page.eval("JSON.parse(localStorage.getItem('humandbell.favourites.v1'))");
  assert.equal(favs.length, 1);
  assert.match(favs[0].name, /^1-minute settle with the breath/i);
  await shot(page, "done-desktop");
});

await step("the shared link replays exactly the same session", async () => {
  const other = await browser.newPage();
  await other.goto(base + link.slice(link.indexOf("#")));
  await other.click("#builder button[type=submit]");
  await other.waitFor("document.body.dataset.session === 'playing'", "the session to start");
  const again = await other.eval("window.__humbell.plan()");
  assert.deepEqual(again.cues, firstPlan.cues);
  assert.deepEqual(again.bells, firstPlan.bells);
  await other.click("#end");
});

await step("sound: every option is audible, never clips, and the binaural tone differs between ears", async () => {
  await page.goto(base);
  const r = async (frag, s = 8) => page.eval(`window.__humbell.render(${JSON.stringify(frag)}, ${s})`);
  for (const frag of ["len=1", "len=1&mood=deep&noise=ocean", "len=1&mood=bright&noise=rain&bin=10", "len=1&mood=open&noise=brown&bin=4", "len=1&tone=g&mood=warm"]) {
    const m = await r(frag);
    assert.ok(m.rms > 0.003, `${frag}: too quiet (rms ${m.rms})`);
    assert.ok(m.peak < 0.99, `${frag}: clips (peak ${m.peak})`);
  }
  const bellsOnly = await r("len=1&mood=none&noise=none&bin=0", 6);
  assert.ok(bellsOnly.rms > 0.001, "the start bell rings");
  assert.ok(bellsOnly.lr < 1e-6, "bells alone are the same in both ears");
  const binaural = await r("len=1&mood=none&noise=none&bin=6&bells=0", 6);
  assert.ok(binaural.lr > 0.001, "the binaural tone differs between ears");
  const silentStart = await r("len=1&mood=none&noise=none&bin=0&bells=0", 3);
  assert.ok(silentStart.peak < 1e-6, "nothing plays when everything is off");
});

await step("practice pages start sessions with their practice", async () => {
  await page.goto(base + "practices/body-scan/", { wait: "main" });
  const hrefs = await page.eval("[...document.querySelectorAll('.card .btn')].map(a => a.getAttribute('href'))");
  assert.ok(hrefs.length >= 3 && hrefs.every((h) => /#len=\d+&p=body$/.test(h)), JSON.stringify(hrefs));
  await page.goto(base + hrefs[0].slice(hrefs[0].indexOf("#")));
  await page.waitFor("document.querySelector('input[name=p][value=body]').checked", "the practice selected");
});

await step("every page: canonical, no console errors, no requests to other sites", async () => {
  const robots = await (await fetch(base + "robots.txt")).text();
  const site = robots.match(/Sitemap: (\S+)\/sitemap\.xml/)[1];
  const urls = [...(await (await fetch(base + "sitemap.xml")).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(urls.length >= 12, "sitemap lists the pages");
  for (const u of urls) {
    await page.goto(base + u.slice(site.length + 1), { wait: "main" });
    assert.equal(await page.eval("document.querySelector('link[rel=canonical]').href"), u);
  }
  const foreign = page.requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
  assert.deepEqual(foreign, [], "requests to other sites");
  assert.deepEqual(page.errors, [], "console errors");
});

await step("phone width: no page scrolls sideways, including during a session", async () => {
  const phone = await browser.newPage();
  await phone.viewport(390, 844, true);
  const wide = [];
  for (const t of ["", "practices/", "practices/loving-kindness/", "meditation-timer/", "binaural-beats/", "about/"]) {
    await phone.goto(base + t, { wait: "main" });
    await sleep(150);
    const w = await phone.eval("document.documentElement.scrollWidth");
    if (w > 391) wide.push(`${t || "home"}: ${w}px`);
    if (screens && t === "") await phone.screenshot(path.join(ROOT, "docs", "screens", "home-phone.png"), { fullPage: true });
  }
  await phone.goto(base + "#len=1&p=body&g=full&seed=phone1");
  await phone.click("#builder button[type=submit]");
  await phone.waitFor("document.body.dataset.session === 'playing'", "the session");
  await phone.waitFor("document.querySelector('#caption').textContent.length > 0", "a caption", 15000);
  const w = await phone.eval("document.documentElement.scrollWidth");
  if (w > 391) wide.push(`session: ${w}px`);
  if (screens) await phone.screenshot(path.join(ROOT, "docs", "screens", "session-phone.png"));
  await phone.click("#end");
  assert.deepEqual(wide, []);
  assert.deepEqual(phone.errors, []);
});

await browser.close();
if (server) await server.close();
if (failures.length) {
  log(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
log(`\nall end-to-end checks passed on ${base}`);
