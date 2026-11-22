# State (2026-11-22)

- **Source material:** two lines in a long October 2024 essay: "Music niche's are underexplored; Transcendental meditation generator." No code, name or domain existed.
- **What works:** v1 live on GitHub Pages as "Hum & Bell". Builder (length 1–120 min, 8 practices + silent timer, guidance density, drone mood and key, background, binaural tone, interval bells), today's session (same for everyone each UTC day), player with captions, browser speech (local voices first), pause/resume, wake lock, end screen with an exact-replay link and favourites. 8 practice pages, a bell timer page, an honest binaural page, about/privacy.
- **Tests:** 9 unit tests (planner across every practice × length × density; guidance claim-free), 8 build tests, an 8-step end-to-end run with a real session and offline audio measurements, on every deploy and weekly against the live site.
- **Not built:** recorded music, AI voices, accounts, streaks, a native app, YouTube uploads (the brief's distribution idea needs an account and posting).
- **Worth reusing:** `audio.js` (bells, drones, noise), the seeded planner pattern.
