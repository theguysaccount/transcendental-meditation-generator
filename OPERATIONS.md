# Operations

Hum & Bell is a static site on GitHub Pages. Sessions are planned, synthesized and spoken in the visitor's browser; the pages make no network requests at all. GitHub Actions deploys and checks it. Nothing needs a person.

- **Live:** https://theguysaccount.github.io/transcendental-meditation-generator/
- **Repo:** https://github.com/theguysaccount/transcendental-meditation-generator
- **Base URL setting:** repository variable `SITE_URL` (unset = the github.io URL above)

## Automated jobs

| Job | Workflow | When | What it does | How it fails safe |
|---|---|---|---|---|
| Deploy | `pages.yml` | every push to `main`; on demand; when the self-test finds the live site behind `main` | Unit tests (the planner for every practice × length × density: cues inside the session, never overlapping, ordered practices complete, determinism per seed; the guidance library's no-health-claims and no-trademark check), build tests, build, the end-to-end run in headless Chrome against the build, deploy, wait until the commit is live, the end-to-end run against the live site, IndexNow | Any failed test stops before deploy; the last good site stays live. IndexNow never fails the run. |
| Weekly self-test | `selftest.yml` | Fridays 09:17 UTC | Unit tests; the end-to-end run against the **live** site (plays a real 1-minute session: captions on cue, pause holds the clock, resume, end, the shared link replays the same session, favourites; renders sessions offline and checks they're audible, never clip, and the binaural tone differs between ears; no console errors, no network requests, no phone overflow); every page, file and cited link; **staleness**: redeploys when the live build is older than `main` | Read-only. A failure opens or comments on one `ops-alert` issue (GitHub emails the owner); the next pass closes it. Safe to re-run any time. |
| Keep-alive | `selftest.yml` → `scripts/keepalive.sh` | with every self-test | Re-enables the scheduled workflow; an empty `[skip ci]` commit after 45 quiet days | Without it GitHub disables the schedule after 60 days with no commits. |

**The schedule trigger is proven:** the first schedule-triggered self-test ran and passed on 22 Nov 2026 ([run 45063687001](https://github.com/theguysaccount/transcendental-meditation-generator/actions/runs/45063687001)), through a temporary cron line that was removed afterwards.

## What to watch

- Open `ops-alert` issues and red runs.
- **Guidance stays claim-free.** `tests/js/session.test.mjs` fails on health, medical or outcome words (and on "Transcendental", "TM", "Maharishi") in the guidance library; `tests/test_build.py` does the same for the practice pages' content. Keep it that way when adding lines.
- **Shared links must keep replaying.** A link is settings plus a seed; the plan depends on the guidance lists. Adding lines to a list changes sessions made from old links (they still play, just differently). If exact replay ever matters, version the library instead of editing it.
- **Speech voices vary by browser.** Some devices have none (captions are shown instead). "Online" voices send the guidance text to the browser maker; the page lists local voices first.

## Run anything by hand

```bash
node --test tests/js/*.test.mjs && python3 -m unittest discover -s tests
python3 pipeline/build.py && node scripts/e2e.mjs
node scripts/e2e.mjs https://theguysaccount.github.io/transcendental-meditation-generator/
python3 scripts/check_live.py https://theguysaccount.github.io/transcendental-meditation-generator
node scripts/e2e.mjs --screens && python3 scripts/og.py
~/.local/bin/gh workflow run pages.yml -R theguysaccount/transcendental-meditation-generator
~/.local/bin/gh workflow run selftest.yml -R theguysaccount/transcendental-meditation-generator
```

## Keys Jack can turn later

### 1. Custom domain (recommended soon)

The launch URL contains the repository's working name, `transcendental-meditation-generator`, which uses a trademarked phrase; the site itself never does. A custom domain removes it from the public address. Candidates (RDAP, 22 Nov 2026): `humandbell.com` is unregistered; `stillroom.com/.org/.app` are taken. Handled by the domain rollout session.

**First, warn anyone using the old address.** Browser storage belongs to a web address, and once the custom domain is set the github.io address redirects to it, so what visitors saved there can't be opened at the new one. Set `MOVE_NOTICE_URL` to the new address and redeploy: every page then tells visitors how to keep their favourites (each is a link to save again). `~/.local/bin/gh variable set MOVE_NOTICE_URL -R theguysaccount/transcendental-meditation-generator --body https://D/` then `~/.local/bin/gh workflow run pages.yml -R theguysaccount/transcendental-meditation-generator`. Leave it a couple of weeks if the site has users (analytics, issues), then switch, and afterwards `~/.local/bin/gh variable delete MOVE_NOTICE_URL -R theguysaccount/transcendental-meditation-generator` and redeploy.

Steps for a domain `D` (apex):
1. DNS: `A @` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; `AAAA @` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `CNAME www` → `theguysaccount.github.io`. (Subdomain: one `CNAME` → `theguysaccount.github.io`.)
2. `~/.local/bin/gh api -X PUT repos/theguysaccount/transcendental-meditation-generator/pages -f cname=D`, wait for the certificate, then `~/.local/bin/gh api -X PUT repos/theguysaccount/transcendental-meditation-generator/pages -F https_enforced=true`.
3. `~/.local/bin/gh variable set SITE_URL -R theguysaccount/transcendental-meditation-generator --body https://D`, then `~/.local/bin/gh workflow run pages.yml -R theguysaccount/transcendental-meditation-generator`.
4. Shared session links keep working (github.io redirects with the `#…` part). Favourites saved at the github.io address stay there (browser storage is per address); they're just links, so nothing of value is lost.
5. Optional, later: renaming the repository (for example to `hum-and-bell`) also changes the github.io path; GitHub redirects the old repo URL but **not** the old Pages URL, so do it only after the custom domain is live.

### 2. Money

Free and ad-free by design; Pages is non-commercial. Slot: a small "Support Hum & Bell" box on the home page, hidden until `SUPPORT_URL` is set (GitHub Sponsors needs the account owner's bank and tax details; or a paid native app with offline packs and more voices, on other hosting). `~/.local/bin/gh variable set SUPPORT_URL -R theguysaccount/transcendental-meditation-generator --body https://…` (and optionally `SUPPORT_LABEL`), then redeploy.

### 3. Analytics (activation metric)

Off by default. Activation = `event/session_complete/<practice>/<minutes>`; also `session_start/…`, `share_copy`. Set `GOATCOUNTER_URL` (`https://<code>.goatcounter.com/count`) and redeploy; the build adds that one origin to the security policy.

### 4. Search Console

Verify the domain once one is live and submit `/sitemap.xml`. IndexNow runs on every deploy; the account-root robots.txt lists this sitemap.

### 5. New practices and lines (content routine)

A monthly Claude routine can add depth: "In ~/code/transcendental-meditation-generator, add 10 to 20 new guidance lines to site/data/guidance.json, or a new practice (lines + practices.json entry), in the same plain, secular voice, with no health or outcome claims. Run `node --test tests/js/*.test.mjs`, `python3 -m unittest discover -s tests` and `node scripts/e2e.mjs`; commit; push."
