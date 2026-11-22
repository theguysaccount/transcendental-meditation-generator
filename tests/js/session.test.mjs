// Unit tests for session settings, plans and the guidance library. Run: node --test tests/js/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULTS, TONES, MOODS, NOISES, BINAURAL, DENSITY, LENGTHS, parseSettings, settingsFragment, newSeed, rng, makePlan,
  dailySettings, speakSeconds, fmtClock,
} from "../../site/assets/session.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const G = JSON.parse(fs.readFileSync(path.join(ROOT, "site/data/guidance.json"), "utf8"));
const practices = Object.keys(G.practices);

test("the guidance library makes no health, medical or outcome claims and doesn't use trademarked names", () => {
  // Words that would turn an instruction into a claim, or a description of a clinical condition.
  const banned = /\b(heal|healing|cure|cures|treat|treatment|therap\w*|anxiety|depress\w*|insomnia|blood pressure|stress relief|reduce stress|lower stress|immune|clinical|medical|symptom\w*|disorder|guarantee\w*|proven|scientifically|brain ?waves?|alpha waves|theta|transcendental|tm\b|maharishi|chakra|enlighten\w*)\b/i;
  const all = [...Object.values(G.lines).flat(), ...Object.values(G.practices).flatMap((p) => [p.name, p.title, p.summary])];
  const hits = all.filter((l) => banned.test(l));
  assert.deepEqual(hits, []);
  // Every line is a reasonable length to speak, and none is duplicated.
  for (const l of Object.values(G.lines).flat()) assert.ok(l.length >= 8 && l.length <= 220, l);
  const seen = new Set();
  for (const l of Object.values(G.lines).flat()) {
    assert.ok(!seen.has(l), `duplicate line: ${l}`);
    seen.add(l);
  }
});

test("every practice points at lists that exist, and the library is deep enough to stay fresh", () => {
  for (const [id, p] of Object.entries(G.practices)) {
    if (!p.main) continue;
    assert.ok(Array.isArray(G.lines[p.main]) && G.lines[p.main].length >= 10, `${id} main`);
    assert.ok(Array.isArray(G.lines[p.late]) && G.lines[p.late].length >= 4, `${id} late`);
  }
  for (const k of ["arrive", "settle", "wander", "silence", "close"]) assert.ok(G.lines[k].length >= 6, k);
  assert.ok(Object.values(G.lines).flat().length >= 200);
});

test("settings come from links safely, with defaults for anything odd", () => {
  assert.deepEqual(parseSettings("", G.practices), { ...DEFAULTS });
  const s = parseSettings("#len=20&p=body&g=full&tone=d&mood=open&bin=6&noise=rain&ib=5&bells=0&seed=abc123", G.practices);
  assert.deepEqual(s, { len: 20, p: "body", g: "full", tone: "d", mood: "open", bin: 6, noise: "rain", ib: 5, bells: 0, seed: "abc123" });
  const odd = parseSettings("len=9999&p=<script>&g=loud&tone=z&mood=x&bin=7&noise=jet&ib=-3&seed=a%20b<c>", G.practices);
  assert.equal(odd.len, 120);
  assert.equal(odd.p, DEFAULTS.p);
  assert.equal(odd.g, DEFAULTS.g);
  assert.equal(odd.tone, DEFAULTS.tone);
  assert.equal(odd.bin, 0);
  assert.equal(odd.noise, "none");
  assert.equal(odd.ib, 0);
  assert.equal(odd.seed, "abc");
  assert.equal(parseSettings("p=silent&g=full", G.practices).g, "none", "a silent sitting has no voice");
  assert.deepEqual(parseSettings(settingsFragment(s), G.practices), s, "round trip");
  assert.equal(settingsFragment(DEFAULTS), "", "defaults make a clean link");
});

test("the same settings and seed always give the same session; a new seed gives a different one", () => {
  const s = { ...DEFAULTS, len: 20, p: "breath", seed: "k3j9x2ab" };
  assert.deepEqual(makePlan(s, G), makePlan(s, G));
  const other = makePlan({ ...s, seed: "zzzz2222" }, G);
  assert.notDeepEqual(makePlan(s, G).cues.map((c) => c.text), other.cues.map((c) => c.text));
  const r = rng("x");
  const v = Array.from({ length: 1000 }, r);
  assert.ok(v.every((x) => x >= 0 && x < 1));
  assert.match(newSeed(rng("y")), /^[a-z2-9]{8}$/);
});

test("every practice, length and density gives a well-formed session", () => {
  for (const p of practices) {
    for (const len of [1, ...LENGTHS, 90, 120]) {
      for (const g of Object.keys(DENSITY)) {
        const plan = makePlan({ ...DEFAULTS, p, len, g, seed: `t${len}${g}`, ib: len >= 10 ? 5 : 0 }, G);
        const where = `${p} ${len} min ${g}`;
        assert.equal(plan.duration, len * 60, where);
        // Bells: start and end, inside the session, intervals before the closing.
        assert.ok(plan.bells.length >= 2, where);
        for (const b of plan.bells) assert.ok(b.t > 0 && b.t < plan.duration, where);
        // Cues: inside the session, in order, and never talking over each other.
        for (let i = 0; i < plan.cues.length; i++) {
          const c = plan.cues[i];
          assert.ok(c.t >= 5 && c.t + speakSeconds(c.text) <= plan.duration - 2, `${where}: cue at ${c.t} runs past the end`);
          if (i + 1 < plan.cues.length) assert.ok(c.t + speakSeconds(c.text) <= plan.cues[i + 1].t + 0.01, `${where}: overlap at ${c.t}`);
        }
        if (g === "none" || p === "silent") assert.equal(plan.cues.length, 0, where);
        else {
          assert.equal(plan.cues[0].kind, "arrive", where);
          assert.equal(plan.cues[plan.cues.length - 1].kind, "close", where);
        }
        assert.match(plan.title, new RegExp(`^${len}-minute `));
      }
    }
  }
});

test("ordered practices say their whole sequence when there's time", () => {
  for (const p of ["body", "kindness"]) {
    for (const len of [10, 20, 45]) {
      const plan = makePlan({ ...DEFAULTS, p, len, g: "medium", seed: "order" }, G);
      const said = plan.cues.filter((c) => c.kind === "main").map((c) => c.text);
      const list = G.lines[G.practices[p].main];
      assert.deepEqual(said.slice(0, list.length), list, `${p} ${len}`);
    }
  }
});

test("more guidance means more spoken lines, and long sessions leave real silence", () => {
  const count = (g) => makePlan({ ...DEFAULTS, len: 30, p: "breath", g, seed: "d" }, G).cues.length;
  assert.ok(count("light") < count("medium") && count("medium") < count("full"));
  const light = makePlan({ ...DEFAULTS, len: 30, p: "open", g: "light", seed: "s" }, G);
  assert.ok(light.cues.some((c) => c.kind === "silence"));
});

test("drone, binaural and noise options map to sound settings", () => {
  for (const [tone, f] of Object.entries(TONES)) {
    const plan = makePlan({ ...DEFAULTS, tone, mood: "warm" }, G);
    assert.equal(plan.drone.root, f);
    assert.deepEqual(plan.drone.freqs, MOODS.warm.ratios.map((r) => Math.round(f * r * 100) / 100));
  }
  assert.deepEqual(makePlan({ ...DEFAULTS, mood: "none" }, G).drone.freqs, []);
  for (const b of BINAURAL) assert.equal(makePlan({ ...DEFAULTS, bin: b }, G).bin, b);
  for (const n of Object.keys(NOISES)) assert.equal(makePlan({ ...DEFAULTS, noise: n }, G).noise, n);
});

test("today's session changes daily, is the same for everyone that day, and never uses the silent timer", () => {
  const a = dailySettings(new Date(Date.UTC(2026, 10, 22, 1)), G);
  const b = dailySettings(new Date(Date.UTC(2026, 10, 22, 23)), G);
  const c = dailySettings(new Date(Date.UTC(2026, 10, 23, 1)), G);
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, c.seed);
  assert.equal(a.seed, "day-2026-11-22");
  for (let d = 0; d < 30; d++) assert.notEqual(dailySettings(new Date(Date.UTC(2026, 0, 1 + d)), G).p, "silent");
  assert.equal(fmtClock(605), "10:05");
});
