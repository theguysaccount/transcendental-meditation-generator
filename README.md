# Hum & Bell

**A meditation session, made fresh for you.** Pick a length (1 to 120 minutes) and a practice; the browser composes the session: a slowly breathing synthesized drone, singing-bowl bells, optional binaural tone and rain/ocean/hush background, gentle guidance spoken by the browser's own text-to-speech voice (with captions), and a timer. Every session has a link that replays it exactly. Free, no app, no account, no audio files, no network requests.

Live: https://theguysaccount.github.io/transcendental-meditation-generator/

Hum & Bell makes no health claims and is not affiliated with Transcendental Meditation; "Transcendental Meditation" and "TM" are trademarks of their owners. (The repository keeps its original working name.)

## What's here

- `site/data/guidance.json`: the guidance library (229 short, secular lines across eight practices); `practices.json`: the practice pages' content.
- `site/assets/session.js`: settings, links, the seeded session planner, today's session. Pure; tested in Node.
- `site/assets/audio.js`: the Web Audio engine (drone, binaural, noise, bells) and an offline renderer for tests.
- `site/assets/app.js`: the builder, player (captions, voice, pause, wake lock), favourites.
- `pipeline/build.py`: builds `dist/` (Python stdlib), generating the practice pages.
- `scripts/e2e.mjs` + `cdp.mjs`: end-to-end test in headless Chrome (a real session, offline sound checks). `check_live.py`: live pages and staleness.

## Run, test, deploy

```bash
python3 pipeline/build.py && python3 -m http.server -d dist 8000   # http://127.0.0.1:8000/
node --test tests/js/*.test.mjs            # planner and guidance-library tests (Node 22+)
python3 -m unittest discover -s tests      # build tests
node scripts/e2e.mjs                       # end-to-end against dist/ (Chrome)
```

Deploys run from GitHub Actions on every push to `main`. See [OPERATIONS.md](OPERATIONS.md).

## License

MIT. See [LICENSE](LICENSE).
