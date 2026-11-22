// Session settings and the session plan: which lines are spoken when, when the bells ring, and what
// the drone plays. Pure functions, no audio and no DOM, so the same code runs in the page and in tests.
// A plan depends only on the settings and the seed, so a shared link replays the same session.

export const TONES = Object.freeze({ c: 130.81, d: 146.83, e: 164.81, f: 174.61, g: 196.0, a: 110.0, b: 123.47 });
export const MOODS = Object.freeze({
  warm: { name: "Warm", ratios: [1, 1.5, 2, 2.5] }, // root, fifth, octave, major tenth
  open: { name: "Open", ratios: [1, 1.5, 2.25, 3] }, // root, fifth, ninth, twelfth
  deep: { name: "Deep", ratios: [0.5, 1, 1.5, 2] }, // low octave, root, fifth, octave
  bright: { name: "Bright", ratios: [1, 2, 2.5, 3, 4] },
  none: { name: "No drone", ratios: [] },
});
export const NOISES = Object.freeze({ none: "None", rain: "Rain", ocean: "Ocean", brown: "Soft hush" });
export const BINAURAL = Object.freeze([0, 4, 6, 10]);
export const DENSITY = Object.freeze({ none: "No voice", light: "A little", medium: "Some", full: "Lots" });
export const LENGTHS = Object.freeze([3, 5, 10, 15, 20, 30, 45, 60]);

export const DEFAULTS = Object.freeze({
  len: 10, p: "breath", g: "medium", tone: "a", mood: "warm", bin: 0, noise: "none", ib: 0, bells: 1, seed: "",
});

const clampInt = (v, lo, hi, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);

/** Read settings from a link's fragment (or any URLSearchParams-like string), with safe defaults. */
export function parseSettings(fragment, practices) {
  const q = new URLSearchParams(String(fragment || "").replace(/^#/, ""));
  const s = { ...DEFAULTS };
  if (q.has("len")) s.len = clampInt(q.get("len"), 1, 120, DEFAULTS.len);
  if (q.has("p")) s.p = pick(q.get("p"), Object.keys(practices), DEFAULTS.p);
  if (q.has("g")) s.g = pick(q.get("g"), Object.keys(DENSITY), DEFAULTS.g);
  if (q.has("tone")) s.tone = pick(q.get("tone"), Object.keys(TONES), DEFAULTS.tone);
  if (q.has("mood")) s.mood = pick(q.get("mood"), Object.keys(MOODS), DEFAULTS.mood);
  if (q.has("bin")) s.bin = BINAURAL.includes(Number(q.get("bin"))) ? Number(q.get("bin")) : 0;
  if (q.has("noise")) s.noise = pick(q.get("noise"), Object.keys(NOISES), DEFAULTS.noise);
  if (q.has("ib")) s.ib = clampInt(q.get("ib"), 0, 30, 0);
  if (q.has("bells")) s.bells = q.get("bells") === "0" ? 0 : 1;
  if (q.has("seed")) s.seed = String(q.get("seed")).replace(/[^a-z0-9-]/gi, "").slice(0, 24);
  if (s.p === "silent") s.g = "none";
  return s;
}

/** The fragment for a link that replays these settings (and, with a seed, the same session). */
export function settingsFragment(s) {
  const q = new URLSearchParams();
  for (const k of ["len", "p", "g", "tone", "mood", "bin", "noise", "ib", "bells", "seed"]) {
    if (s[k] !== undefined && s[k] !== "" && String(s[k]) !== String(DEFAULTS[k])) q.set(k, String(s[k]));
  }
  return q.toString();
}

export function newSeed(rand = Math.random) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

/** A small, fast, seeded generator (mulberry32) fed by a string hash. */
export function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw lines from a list without repeats until it runs out. */
function drawer(list, rand) {
  let bag = [];
  return () => {
    if (!bag.length) {
      bag = list.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  };
}

// Roughly how long a line takes to say at the voice's slow rate, in seconds.
export const speakSeconds = (text) => 1.2 + text.split(/\s+/).length * 0.42;

/**
 * Build a session plan. Returns { duration, cues: [{ t, text, kind }], bells: [{ t, strength }],
 * drone: { freqs }, bin, noise, practice, title }. Times are seconds from the start.
 */
export function makePlan(settings, guidance) {
  const s = { ...DEFAULTS, ...settings };
  const practice = guidance.practices[s.p] || guidance.practices.breath;
  const rand = rng(`${s.seed || "x"}|${s.p}|${s.len}|${s.g}`);
  const duration = s.len * 60;
  const L = guidance.lines;
  const cues = [];
  const bells = [];

  if (s.bells) {
    bells.push({ t: 1.5, strength: 1 });
    bells.push({ t: duration - 4, strength: 1 }, { t: duration - 1.5, strength: 0.7 });
  }
  if (s.ib > 0) {
    for (let t = s.ib * 60; t < duration - 45; t += s.ib * 60) bells.push({ t, strength: 0.45 });
  }

  if (s.g !== "none" && practice.main) {
    const say = (t, text, kind) => cues.push({ t: Math.round(t * 10) / 10, text, kind });
    const from = (name) => drawer(L[name], rand);
    const arrive = from("arrive");
    const settle = from("settle");
    const wander = from("wander");
    const close = from("close");
    const late = practice.late ? from(practice.late) : null;
    const mainList = L[practice.main];
    const main = practice.ordered ? (() => { let i = 0; return () => mainList[Math.min(i++, mainList.length - 1)]; })() : drawer(mainList, rand);

    // Opening: arrive and settle in the first stretch.
    let t = 7;
    say(t, arrive(), "arrive");
    t += speakSeconds(cues[cues.length - 1].text) + 8 + rand() * 6;
    const settleCount = duration >= 600 ? 2 : duration >= 300 ? 1 : 0;
    for (let i = 0; i < settleCount; i++) {
      say(t, settle(), "settle");
      t += speakSeconds(cues[cues.length - 1].text) + 12 + rand() * 10;
    }

    // Closing: begins about a minute and a half before the end (less for short sessions).
    const closeStart = duration - Math.min(95, Math.max(35, duration * 0.12));
    const closeCount = duration >= 300 ? 3 : 2;

    // The middle: practice lines spaced by density; the later half draws on "late" lines and
    // the occasional reminder about wandering; the longest gap gets a "silence" line before it.
    const gap = { light: 180, medium: 80, full: 40 }[s.g];
    const middleEnd = closeStart - 20;
    const orderedCount = practice.ordered ? mainList.length : 0;
    // Ordered practices (body scan, kindness) need their whole sequence: fit it to the time available,
    // spreading what's left after the speaking evenly between the steps.
    const speaking = orderedCount ? mainList.reduce((a, l) => a + speakSeconds(l), 0) : 0;
    const step = orderedCount ? Math.max(6, Math.min(gap * 1.5, ((middleEnd - t - speaking) * 0.9) / orderedCount)) : gap;
    let n = 0;
    let lastWander = t;
    while (t < middleEnd) {
      const progress = (t - 7) / Math.max(1, middleEnd - 7);
      let text;
      let kind = "main";
      if (orderedCount && n < orderedCount) {
        text = main();
      } else if (progress > 0.45 && late && rand() < 0.5) {
        text = late();
        kind = "late";
      } else if (t - lastWander > Math.max(gap * 2.5, 150) && rand() < 0.6) {
        text = wander();
        kind = "wander";
        lastWander = t;
      } else {
        text = orderedCount ? late?.() || main() : main();
      }
      say(t, text, kind);
      n++;
      t += speakSeconds(text) + (orderedCount && n < orderedCount ? step : gap * (0.75 + rand() * 0.5));
    }
    // Drop anything that would run into the closing.
    while (cues.length > 1 && cues[cues.length - 1].t + speakSeconds(cues[cues.length - 1].text) > closeStart - 8) cues.pop();

    // A silence line before the longest gap in the middle, if it is long.
    let longest = -1;
    let longestGap = 0;
    for (let i = 0; i < cues.length; i++) {
      const next = i + 1 < cues.length ? cues[i + 1].t : closeStart;
      const g = next - cues[i].t;
      if (g > longestGap && cues[i].kind !== "arrive") {
        longest = i;
        longestGap = g;
      }
    }
    if (longest >= 0 && longestGap > 150) {
      const c = cues[longest];
      cues.splice(longest + 1, 0, { t: Math.round((c.t + speakSeconds(c.text) + 4) * 10) / 10, text: drawer(L.silence, rand)(), kind: "silence" });
    }

    // Closing lines.
    let ct = closeStart;
    for (let i = 0; i < closeCount; i++) {
      say(ct, close(), "close");
      ct += speakSeconds(cues[cues.length - 1].text) + Math.max(6, (duration - 12 - closeStart) / closeCount - 6);
    }
  }

  cues.sort((a, b) => a.t - b.t);
  bells.sort((a, b) => a.t - b.t);
  const root = TONES[s.tone];
  return {
    duration,
    cues,
    bells,
    drone: { root, freqs: MOODS[s.mood].ratios.map((r) => Math.round(root * r * 100) / 100) },
    bin: s.bin,
    noise: s.noise,
    practice: s.p,
    title: `${s.len}-minute ${practice.title.toLowerCase()}`,
    settings: s,
  };
}

/** Today's session: the same for everyone on a given UTC day, rotating through the practices. */
export function dailySettings(date, guidance) {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const ids = Object.keys(guidance.practices).filter((k) => k !== "silent");
  const tones = Object.keys(TONES);
  const moods = ["warm", "open", "deep"];
  const iso = new Date(day * 86_400_000).toISOString().slice(0, 10);
  return { ...DEFAULTS, len: 10, p: ids[day % ids.length], tone: tones[day % tones.length], mood: moods[day % moods.length], seed: `day-${iso}` };
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
