// The sound of a session, synthesized live with the Web Audio API: a slowly breathing drone, an
// optional binaural tone, optional noise (rain, ocean, a soft hush) and singing-bowl bells. Nothing
// is downloaded. buildSession() wires everything to a context and schedules the bells; render()
// does the same offline so tests can measure the sound.
import { rng } from "./session.js";

// A singing bowl's partials are inharmonic: these ratios, levels and decay times (seconds) give a
// warm bowl-like strike. The fundamental has a slightly detuned twin for a gentle shimmer.
const BELL = [
  { r: 1, a: 1, d: 9 },
  { r: 1.0021, a: 0.5, d: 8 },
  { r: 2.76, a: 0.55, d: 6.5 },
  { r: 5.4, a: 0.32, d: 3.6 },
  { r: 8.93, a: 0.16, d: 2.2 },
  { r: 13.34, a: 0.07, d: 1.3 },
];

function noiseBuffer(ctx, kind, rand, seconds = 6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = rand() * 2 - 1;
      if (kind === "rain") {
        // Pink noise (Paul Kellet's refined filter).
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        // Brown noise: integrated white noise, kept from drifting.
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
    // Fade the loop seam.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      d[i] *= g;
      d[len - 1 - i] *= g;
    }
  }
  return buf;
}

function lfo(ctx, rate, depth, target, t0) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start(t0);
  return o;
}

/** Strike a bell at time t (context seconds) into `bus`. */
export function bell(ctx, bus, t, freq, strength = 1) {
  for (const p of BELL) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq * p.r;
    const peak = 0.16 * p.a * strength;
    const decay = p.d * (0.6 + 0.4 * strength);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

/**
 * Build a session's sound on `ctx`, starting at context time t0. Returns controls:
 * { duck(on), stop(fadeSeconds), endsAt }. Everything is scheduled up front, so pausing the
 * context (ctx.suspend) pauses the whole session, bells included.
 */
export function buildSession(ctx, plan, t0 = ctx.currentTime + 0.1) {
  const rand = rng(`sound|${plan.settings.seed || "x"}`);
  const end = t0 + plan.duration;
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -14;
  out.ratio.value = 3;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  out.connect(master).connect(ctx.destination);

  // The bed (drone, binaural, noise) fades in and out; bells sit on top and ring past the fade.
  const bed = ctx.createGain();
  bed.gain.setValueAtTime(0, t0);
  bed.gain.linearRampToValueAtTime(1, t0 + 6);
  bed.gain.setValueAtTime(1, Math.max(t0 + 6, end - 8));
  bed.gain.linearRampToValueAtTime(0, end);
  bed.connect(out);
  const voiceDuck = ctx.createGain();
  voiceDuck.connect(bed);
  const nodes = [];

  // Drone: each note is three slightly detuned oscillators through a breathing low-pass filter.
  const drone = ctx.createGain();
  drone.gain.value = plan.drone.freqs.length ? 0.9 / Math.sqrt(plan.drone.freqs.length) : 0;
  drone.connect(voiceDuck);
  plan.drone.freqs.forEach((f, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700 + 200 * i;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.11 / (1 + i * 0.55);
    filter.connect(g).connect(drone);
    for (const [type, detune] of [["sine", 0], ["triangle", 4 + rand() * 3], ["sine", -(4 + rand() * 3)]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(filter);
      o.start(t0);
      o.stop(end + 0.5);
      nodes.push(o);
    }
    nodes.push(lfo(ctx, 0.03 + rand() * 0.05, 250, filter.frequency, t0));
    nodes.push(lfo(ctx, 0.05 + rand() * 0.08, 0.04 / (1 + i * 0.55), g.gain, t0));
  });

  // Binaural tone: a slightly different pitch in each ear (headphones needed to hear the beat).
  if (plan.bin > 0) {
    const carrier = plan.drone.root * 2;
    const merger = ctx.createChannelMerger(2);
    const level = ctx.createGain();
    level.gain.value = 0.07;
    merger.connect(level).connect(voiceDuck);
    [carrier, carrier + plan.bin].forEach((f, ch) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(merger, 0, ch);
      o.start(t0);
      o.stop(end + 0.5);
      nodes.push(o);
    });
  }

  // Noise beds.
  if (plan.noise !== "none") {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, plan.noise === "rain" ? "rain" : "brown", rand);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (plan.noise === "rain") {
      filter.type = "bandpass";
      filter.frequency.value = 2500;
      filter.Q.value = 0.4;
      g.gain.value = 0.32;
    } else if (plan.noise === "ocean") {
      filter.type = "lowpass";
      filter.frequency.value = 900;
      g.gain.value = 0.16;
      nodes.push(lfo(ctx, 0.075 + rand() * 0.02, 0.13, g.gain, t0)); // waves
    } else {
      filter.type = "lowpass";
      filter.frequency.value = 520;
      g.gain.value = 0.22;
    }
    src.connect(filter).connect(g).connect(voiceDuck);
    src.start(t0);
    src.stop(end + 0.5);
    nodes.push(src);
  }

  // Bells.
  const bells = ctx.createGain();
  bells.gain.value = 1;
  bells.connect(out);
  const bellFreq = plan.drone.root * 3;
  for (const b of plan.bells) bell(ctx, bells, t0 + b.t, bellFreq, b.strength);

  return {
    endsAt: end,
    duck(on) {
      voiceDuck.gain.setTargetAtTime(on ? 0.55 : 1, ctx.currentTime, 0.25);
    },
    stop(fade = 1.5) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + fade);
    },
  };
}

/** Render the first `seconds` of a session offline and measure it: { rms, peak, lr }. */
export async function render(plan, seconds = 10, sampleRate = 22050) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  buildSession(ctx, plan, 0);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let sum = 0, peak = 0, diff = 0;
  for (let i = 0; i < L.length; i++) {
    sum += L[i] * L[i] + R[i] * R[i];
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    diff += Math.abs(L[i] - R[i]);
  }
  return { rms: Math.sqrt(sum / (2 * L.length)), peak, lr: diff / L.length };
}
