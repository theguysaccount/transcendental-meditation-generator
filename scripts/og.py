"""Render the 1200x630 share cards in site/assets/og/ with headless Chrome: python3 scripts/og.py"""
import html
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "assets" / "og"
CHROME = os.environ.get("CHROME") or next(
    (c for c in [shutil.which("google-chrome"), shutil.which("chromium"),
                 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] if c and Path(c).exists()), None)
CARD = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;overflow:hidden}}
body{{background:#1d1f2e;color:#e8e8f2;font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
 display:flex;flex-direction:column;justify-content:space-between;padding:64px 76px;box-sizing:border-box}}
.top{{font:700 34px/1 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;gap:14px}}
.dot{{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#e6c34a,#8a6d12);display:inline-block}}
h1{{font-size:84px;line-height:1.04;margin:0;max-width:1000px;letter-spacing:-.01em}}
.typed{{font-size:36px;color:#a4a7bd;margin:24px 0 0}}
.typed s{{color:#a39a8a}} .typed b{{background:#ffe2a8;color:#5a3b00;font-weight:400;padding:0 6px}}
.caret{{display:none}}
p.sub{{font:30px/1.3 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#aab6f0;margin:0}}
</style></head><body>
<div class="top"><span class="dot"></span>Hum &amp; Bell</div>
<div><h1>{title}</h1><div class="typed">{typed}<span class="caret"></span></div></div>
<p class="sub">{sub}</p>
</body></html>"""


def render(name, title, typed, sub, work):
    page = work / f"{name}.html"
    page.write_text(CARD.format(title=html.escape(title), typed=typed, sub=html.escape(sub)), encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", f"--user-data-dir={work / 'p'}",
                    "--window-size=1200,630", "--virtual-time-budget=2000", f"--screenshot={OUT / (name + '.png')}", page.as_uri()],
                   check=True, capture_output=True)
    print(OUT / f"{name}.png")


if __name__ == "__main__":
    if not CHROME:
        raise SystemExit("Chrome not found; set CHROME")
    OUT.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp())
    try:
        render("home", "A meditation session, made fresh for you.", "drone · bells · gentle guidance · timer",
               "Free, in your browser. No app, no account.", work)
        render("timer", "Meditation timer with bells.", "start bell · interval bells · end bell",
               "Free. Optional drone or rain. No app needed.", work)
        render("binaural", "Binaural beats, in your browser.", "220 Hz left · 226 Hz right · headphones",
               "A sound you might enjoy. No health claims.", work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
