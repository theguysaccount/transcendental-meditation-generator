// The session builder and player. Everything is generated in this browser: no recordings, no
// accounts, no network. Settings live in the page address, so any session can be shared.
import { DEFAULTS, LENGTHS, TONES, MOODS, NOISES, DENSITY, parseSettings, settingsFragment, newSeed, makePlan, dailySettings, fmtClock, speakSeconds } from "./session.js";
import { buildSession, render } from "./audio.js";
import { $, h, track, copyText } from "./common.js";

const G = JSON.parse(document.getElementById("guidance").textContent);
const FAV_KEY = "humandbell.favourites.v1";
const VOICE_KEY = "humandbell.voice.v1";

let settings = parseSettings(location.hash, G.practices);
let session = null; // { ctx, sound, plan, t0, next, timer, paused, wake }

// ---------- the builder ----------

function radios(name, options, value, label) {
  return h("fieldset", { class: "choices" }, h("legend", {}, label), ...options.map(([v, text]) =>
    h("label", { class: "choice" }, h("input", { type: "radio", name, value: String(v), checked: String(v) === String(value) }), h("span", {}, text))));
}

function select(id, options, value, label, note) {
  return h("label", { class: "field", for: id }, h("span", {}, label),
    h("select", { id, name: id }, ...options.map(([v, text]) => h("option", { value: String(v), selected: String(v) === String(value) }, text))),
    note ? h("span", { class: "small" }, note) : null);
}

function renderBuilder() {
  const s = settings;
  const lengths = LENGTHS.includes(s.len) ? LENGTHS : [...LENGTHS, s.len].sort((a, b) => a - b);
  $("#builder-fields").replaceChildren(
    radios("len", lengths.map((m) => [m, `${m} min`]), s.len, "Length"),
    h("fieldset", { class: "choices practices" }, h("legend", {}, "Practice"),
      ...Object.entries(G.practices).map(([id, p]) => h("label", { class: "choice card-choice" },
        h("input", { type: "radio", name: "p", value: id, checked: id === s.p }),
        h("span", {}, h("b", {}, p.name), h("span", { class: "small" }, p.summary))))),
    radios("g", Object.entries(DENSITY), s.g, "Voice guidance"),
    h("details", { class: "quiet-box", open: s.mood !== DEFAULTS.mood || s.noise !== DEFAULTS.noise || s.bin || s.ib ? true : null },
      h("summary", {}, "Sound"),
      h("div", { class: "grid2" },
        select("mood", Object.entries(MOODS).map(([k, m]) => [k, m.name]), s.mood, "Drone"),
        select("tone", Object.keys(TONES).map((k) => [k, k.toUpperCase()]), s.tone, "Key"),
        select("noise", Object.entries(NOISES), s.noise, "Background"),
        select("bin", [[0, "Off"], [4, "4 Hz beat"], [6, "6 Hz beat"], [10, "10 Hz beat"]], s.bin, "Binaural tone", "Needs headphones."),
        select("ib", [[0, "None"], [1, "Every minute"], [2, "Every 2 min"], [5, "Every 5 min"], [10, "Every 10 min"], [15, "Every 15 min"]], s.ib, "Interval bells"),
        select("bells", [[1, "On"], [0, "Off"]], s.bells, "Start and end bells"))),
  );
  $("#builder-fields").onchange = readBuilder;
  updateSummary();
}

function readBuilder() {
  const f = new FormData($("#builder"));
  const next = { ...settings };
  for (const k of ["len", "bin", "ib", "bells"]) if (f.has(k)) next[k] = Number(f.get(k));
  for (const k of ["p", "g", "mood", "tone", "noise"]) if (f.has(k)) next[k] = f.get(k);
  next.seed = ""; // changed settings make a new session
  settings = parseSettings(settingsFragment(next), G.practices);
  if (settings.p === "silent") $("#builder").querySelectorAll('input[name="g"]').forEach((i) => { i.checked = i.value === "none"; });
  history.replaceState(null, "", location.pathname + location.search + (settingsFragment(settings) ? "#" + settingsFragment(settings) : ""));
  updateSummary();
}

function updateSummary() {
  const p = G.practices[settings.p];
  $("#summary").textContent = `${settings.len} minute${settings.len === 1 ? "" : "s"} · ${p.name} · ${DENSITY[settings.g].toLowerCase()} · ${MOODS[settings.mood].name.toLowerCase()} drone${settings.noise !== "none" ? " · " + NOISES[settings.noise].toLowerCase() : ""}${settings.bin ? ` · ${settings.bin} Hz binaural` : ""}`;
  $("#seed-note").hidden = !settings.seed;
}

// ---------- voices ----------

function voices() {
  const all = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
  const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return (en.length ? en : all).sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
}

function renderVoices() {
  const list = voices();
  const sel = $("#voice");
  const saved = (() => { try { return localStorage.getItem(VOICE_KEY); } catch { return null; } })();
  sel.replaceChildren(...list.map((v) => h("option", { value: v.name, selected: v.name === saved }, `${v.name}${v.localService ? "" : " (online voice)"}`)));
  $("#voice-row").hidden = list.length === 0;
  $("#no-voice").hidden = list.length > 0;
}

function chosenVoice() {
  return voices().find((v) => v.name === $("#voice").value) || voices()[0] || null;
}

// ---------- the player ----------

function show(id) {
  for (const s of ["#build", "#player", "#done"]) $(s).hidden = s !== id;
  window.scrollTo(0, 0);
}

function say(text, sound) {
  $("#caption").textContent = text;
  const v = chosenVoice();
  if (!v || !("speechSynthesis" in window) || $("#mute").getAttribute("aria-pressed") === "true") return;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v;
  u.lang = v.lang;
  u.rate = 0.82;
  u.pitch = 0.95;
  u.volume = 0.9;
  u.onstart = () => sound.duck(true);
  u.onend = u.onerror = () => sound.duck(false);
  speechSynthesis.speak(u);
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") session.wake = await navigator.wakeLock.request("screen");
  } catch { /* not allowed: the session still runs */ }
}

function tick() {
  if (!session || session.paused) return;
  const elapsed = session.ctx.currentTime - session.t0;
  const left = session.plan.duration - elapsed;
  $("#clock").textContent = fmtClock(Math.max(0, left));
  $("#bar").style.width = `${Math.min(100, (elapsed / session.plan.duration) * 100)}%`;
  while (session.next < session.plan.cues.length && session.plan.cues[session.next].t <= elapsed) {
    const cue = session.plan.cues[session.next++];
    // A cue that's long overdue (the tab was asleep) is shown but not spoken over the next one.
    if (elapsed - cue.t < speakSeconds(cue.text)) say(cue.text, session.sound);
    else $("#caption").textContent = cue.text;
  }
  if (elapsed >= session.plan.duration + 2) finish(true);
}

async function start(fromSettings = settings) {
  if (session) stop();
  if (!fromSettings.seed) fromSettings = { ...fromSettings, seed: newSeed() };
  settings = fromSettings;
  const plan = makePlan(settings, G);
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    $("#err").textContent = "This browser can't play generated sound. Try a current version of Chrome, Edge, Firefox or Safari.";
    $("#err").hidden = false;
    return;
  }
  const ctx = new AC({ latencyHint: "playback" });
  if (ctx.state === "suspended") await ctx.resume();
  const t0 = ctx.currentTime + 0.15;
  const sound = buildSession(ctx, plan, t0);
  session = { ctx, sound, plan, t0, next: 0, paused: false, timer: setInterval(tick, 250), wake: null };
  history.replaceState(null, "", location.pathname + location.search + "#" + settingsFragment(settings));
  $("#p-title").textContent = plan.title[0].toUpperCase() + plan.title.slice(1);
  $("#caption").textContent = plan.cues.length ? "" : "No voice in this session. The bells mark the start and the end.";
  $("#pause").textContent = "Pause";
  $("#pause").setAttribute("aria-pressed", "false");
  show("#player");
  keepAwake();
  tick();
  document.body.dataset.session = "playing";
  track(`session_start/${settings.p}/${settings.len}`);
}

function pause() {
  if (!session) return;
  if (session.paused) {
    session.ctx.resume();
    session.paused = false;
    if ("speechSynthesis" in window) speechSynthesis.resume();
    $("#pause").textContent = "Pause";
    $("#pause").setAttribute("aria-pressed", "false");
    document.body.dataset.session = "playing";
    keepAwake();
  } else {
    session.ctx.suspend();
    session.paused = true;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    $("#pause").textContent = "Resume";
    $("#pause").setAttribute("aria-pressed", "true");
    document.body.dataset.session = "paused";
  }
}

function stop() {
  if (!session) return;
  clearInterval(session.timer);
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  session.sound.stop(1.2);
  const ctx = session.ctx;
  setTimeout(() => ctx.close().catch(() => {}), 1500);
  try { session.wake?.release(); } catch { /* already released */ }
  session = null;
}

function finish(completed) {
  const plan = session?.plan;
  stop();
  document.body.dataset.session = completed ? "complete" : "ended";
  $("#done-title").textContent = completed ? "Session complete" : "Session ended";
  $("#done-what").textContent = plan ? plan.title[0].toUpperCase() + plan.title.slice(1) + "." : "";
  $("#done-link").value = `${location.origin}${location.pathname}#${settingsFragment(settings)}`;
  show("#done");
  $("#done h2").focus();
  if (completed) track(`session_complete/${settings.p}/${settings.len}`);
}

// ---------- favourites and today's session ----------

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return Array.isArray(v) ? v.filter((f) => f && typeof f.frag === "string" && typeof f.name === "string") : [];
  } catch {
    return [];
  }
}

function renderFavs() {
  const favs = loadFavs();
  $("#favs-wrap").hidden = favs.length === 0;
  $("#favs").replaceChildren(...favs.map((f, i) => h("li", {},
    h("a", { href: "#" + f.frag, onclick: (e) => { e.preventDefault(); settings = parseSettings(f.frag, G.practices); renderBuilder(); start(settings); } }, f.name),
    " ",
    h("button", { type: "button", class: "btn small quiet", onclick: () => {
      const all = loadFavs();
      all.splice(i, 1);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(all)); } catch { /* storage off */ }
      renderFavs();
    } }, "Remove"))));
}

function saveFav() {
  const plan = makePlan(settings, G);
  const favs = loadFavs().filter((f) => f.frag !== settingsFragment(settings));
  favs.unshift({ name: plan.title[0].toUpperCase() + plan.title.slice(1), frag: settingsFragment(settings) });
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs.slice(0, 30)));
    $("#fav").textContent = "Saved";
  } catch {
    $("#fav").textContent = "This browser can't save favourites";
  }
  renderFavs();
}

function renderDaily() {
  const d = dailySettings(new Date(), G);
  const plan = makePlan(d, G);
  $("#daily-what").textContent = `${plan.title[0].toUpperCase() + plan.title.slice(1)}, ${MOODS[d.mood].name.toLowerCase()} drone in ${d.tone.toUpperCase()}.`;
  $("#daily").onclick = () => {
    settings = d;
    renderBuilder();
    start(d);
  };
}

// ---------- wiring ----------

$("#builder").addEventListener("submit", (e) => {
  e.preventDefault();
  start(settings);
});
$("#pause").addEventListener("click", pause);
$("#end").addEventListener("click", () => finish(false));
$("#mute").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  e.currentTarget.textContent = on ? "Unmute voice" : "Mute voice";
  if (on && "speechSynthesis" in window) speechSynthesis.cancel();
});
$("#again").addEventListener("click", () => start(settings));
$("#new").addEventListener("click", () => {
  settings = { ...settings, seed: "" };
  start(settings);
});
$("#edit").addEventListener("click", () => {
  renderBuilder();
  show("#build");
});
$("#copy").addEventListener("click", (e) => {
  copyText($("#done-link").value, e.currentTarget, $("#done-link"));
  track("share_copy");
});
$("#fav").addEventListener("click", saveFav);
$("#voice").addEventListener("change", (e) => {
  try { localStorage.setItem(VOICE_KEY, e.target.value); } catch { /* storage off */ }
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && session && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName || "")) {
    e.preventDefault();
    pause();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && session && !session.paused) keepAwake();
});
window.addEventListener("hashchange", () => {
  if (!session) {
    settings = parseSettings(location.hash, G.practices);
    renderBuilder();
  }
});
if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", renderVoices);

renderBuilder();
renderVoices();
renderFavs();
renderDaily();
show("#build");
document.body.dataset.ready = "1";

// For the automated tests: the current plan, and an offline render of any settings.
window.__humbell = {
  plan: () => session?.plan || null,
  elapsed: () => (session ? session.ctx.currentTime - session.t0 : null),
  render: async (fragment, seconds) => render(makePlan(parseSettings(fragment, G.practices), G), seconds),
};
