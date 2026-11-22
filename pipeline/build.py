"""Build the Hum & Bell static site into dist/. Standard library only (Python 3.9+).

    python3 pipeline/build.py [--out dist]

Pages are HTML fragments in site/pages/ that start with a JSON block in an HTML comment (path, title,
description, ...). This script wraps each in the shared layout and writes the sitemap, robots.txt,
the IndexNow key file, 404.html, build.json and urls.txt.

Optional environment (GitHub repository variables in CI; see OPERATIONS.md):
    SITE_URL          canonical origin + path, no trailing slash (default: the GitHub Pages URL)
    GOATCOUNTER_URL   e.g. https://humandbell.goatcounter.com/count -> cookieless page counts on
    SUPPORT_URL       link to a sponsorship page or a paid app on other hosting -> money slot shown
    SUPPORT_LABEL     its button text (default "Support Hum & Bell")
    BUILD_DATE        YYYY-MM-DD, to reproduce a build
    GITHUB_SHA        recorded in build.json so health checks can tell which commit is live
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SITE_URL = "https://theguysaccount.github.io/transcendental-meditation-generator"
REPO_URL = "https://github.com/theguysaccount/transcendental-meditation-generator"
BRAND = "Hum & Bell"
THEME = "#3d4a7a"
INDEXNOW_KEY = (ROOT / "site" / "indexnow-key.txt").read_text().strip()
NAV = [("", "Session"), ("practices/", "Practices"), ("meditation-timer/", "Timer"), ("about/", "About")]
FOOT = [("", "Make a session"), ("practices/", "Practices"), ("meditation-timer/", "Meditation timer"),
        ("binaural-beats/", "Binaural beats"), ("about/", "About and privacy")]
e = html.escape


def attr(s):
    return html.escape(str(s), quote=True)


def read_page(path):
    """Split a page file into its JSON front matter and its HTML body."""
    text = path.read_text(encoding="utf-8")
    m = re.match(r"\s*<!--\s*(\{.*?\})\s*-->\s*", text, re.S)
    if not m:
        raise SystemExit(f"{path}: missing the JSON block at the top")
    meta = json.loads(m.group(1))
    meta["source"] = path.name
    return meta, text[m.end():]


class Site:
    def __init__(self, out, today):
        self.out, self.today = Path(out), today
        self.site_url = os.environ.get("SITE_URL", "").strip().rstrip("/") or DEFAULT_SITE_URL
        self.goatcounter = os.environ.get("GOATCOUNTER_URL", "").strip()
        self.support = os.environ.get("SUPPORT_URL", "").strip()
        self.support_label = os.environ.get("SUPPORT_LABEL", "").strip() or "Support Hum & Bell"
        self.guidance = json.loads((ROOT / "site" / "data" / "guidance.json").read_text(encoding="utf-8"))
        self.commit = os.environ.get("GITHUB_SHA", "").strip() or "local"
        h = hashlib.sha1()
        for p in sorted((ROOT / "site").rglob("*")):
            if p.is_file():
                h.update(p.relative_to(ROOT).as_posix().encode() + b"\0" + p.read_bytes())
        self.ver = h.hexdigest()[:10]
        self.pages = [read_page(p) for p in sorted((ROOT / "site" / "pages").glob("*.html"))]
        self.indexable = []

    # ----- helpers -----
    def url(self, path):
        return f"{self.site_url}/{path}"

    def write(self, path, text):
        f = self.out / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")

    def csp(self):
        """Pages may load their own files and nothing else, and may not send data anywhere."""
        script, connect, img = "'self'", "'none'", "'self' data:"
        if self.goatcounter:
            origin = "{0.scheme}://{0.netloc}".format(urlparse(self.goatcounter))
            script += " https://gc.zgo.at"
            connect = origin
            img += " " + origin
        return (f"default-src 'none'; script-src {script}; style-src 'self' 'unsafe-inline'; img-src {img}; "
                f"connect-src {connect}; form-action 'none'; base-uri 'none'")

    def privacy_line(self):
        if self.goatcounter:
            return "Page visits are counted with GoatCounter (no cookies, no personal data). Sessions are generated in your browser."
        return "No accounts, no cookies, no analytics. Every session is generated in your browser."

    def fill(self, text, root, extra=None):
        values = {"root": root, "site_url": self.site_url, "repo_url": REPO_URL, "brand": BRAND,
                  "privacy_line": self.privacy_line(), "csp": e(self.csp()),
                  "line_count": str(sum(len(v) for v in self.guidance["lines"].values()))}
        values.update(extra or {})
        out = re.sub(r"\{\{(\w+)\}\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)
        left = re.findall(r"\{\{\w+\}\}", out)
        if left:
            raise SystemExit(f"unfilled placeholders: {sorted(set(left))}")
        return out

    def layout(self, meta, body):
        path = meta["path"]
        if path == "404.html":
            after = self.site_url.split("://", 1)[1]
            root = "/" + after.split("/", 1)[1] + "/" if "/" in after else "/"
        else:
            root = "../" * path.count("/") or "./"
        here = ' aria-current="page"'
        current = meta.get("nav")
        nav = "".join(f'<a href="{root}{p}"{here if p == current else ""}>{e(t)}</a>' for p, t in NAV)
        foot = "".join(f'<a href="{root}{p}">{e(t)}</a>' for p, t in FOOT)
        extra = {}
        faq = meta.get("faq")
        if faq:
            extra["faq_html"] = '<div class="faq">' + "".join(
                f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in faq) + "</div>"
        extra["money_slot"] = (
            f'<section class="card money"><p>Hum & Bell is free and has no ads. <a class="btn small" href="{attr(self.support)}" rel="noopener">{e(self.support_label)}</a></p></section>'
            if self.support else "")
        body = self.fill(body, root, extra)
        ld = ""
        for block in meta.get("jsonld", []):
            if faq and block.get("@type") == "FAQPage":
                block = dict(block, mainEntity=[{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                                                for q, a in faq])
            text = self.fill(json.dumps(block, ensure_ascii=False), root, {"date": self.today.isoformat()})
            ld += '<script type="application/ld+json">%s</script>\n' % text.replace("</", "<\\/")
        cfg = json.dumps({"root": root, "siteUrl": self.site_url})
        guidance = ""
        if "app.js" in meta.get("scripts", []):
            guidance = '<script type="application/json" id="guidance">%s</script>\n' % json.dumps(self.guidance, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        scripts = f'<script type="application/json" id="site-config">{cfg}</script>\n' + guidance + "".join(
            f'<script type="module" src="{root}assets/{name}?v={self.ver}"></script>\n' for name in meta.get("scripts", []))
        gc = (f'<script data-goatcounter="{attr(self.goatcounter)}" async src="https://gc.zgo.at/count.js"></script>\n'
              if self.goatcounter else "")
        title, description = meta["title"], meta["description"]
        canonical = self.url("" if path == "404.html" else path)
        robots = '<meta name="robots" content="noindex">\n' if meta.get("noindex") else ""
        return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{attr(self.csp())}">
<meta name="referrer" content="no-referrer">
<title>{e(title)}</title>
<meta name="description" content="{attr(description)}">
<link rel="canonical" href="{canonical}">
{robots}<meta property="og:type" content="website">
<meta property="og:site_name" content="{attr(BRAND)}">
<meta property="og:title" content="{attr(title)}">
<meta property="og:description" content="{attr(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{self.site_url}/assets/og/{meta.get('og', 'home')}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="{THEME}">
<link rel="icon" href="{root}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{root}assets/site.css?v={self.ver}">
{ld}{scripts}{gc}</head>
<body class="{attr(meta.get('body_class', 'doc'))}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
<a class="logo" href="{root}"><span class="mark" aria-hidden="true"></span>{e(BRAND)}</a>
<nav class="nav" aria-label="Main">{nav}</nav>
</div></header>
<main id="main" class="wrap">
{body}
</main>
<footer class="site-foot"><div class="wrap">
<nav aria-label="Footer">{foot}<a href="{REPO_URL}">Source code</a></nav>
<p>For quiet and reflection. Not medical advice, and not a treatment for anything.</p>
<p>{e(self.privacy_line())}</p>
</div></footer>
</body>
</html>
"""

    # ----- outputs -----
    def assets(self):
        shutil.copytree(ROOT / "site" / "assets", self.out / "assets")
        shutil.copy(ROOT / "site" / "favicon.svg", self.out / "favicon.svg")

        # Every import carries the build version, so a returning visitor never mixes old and new files.
        for f in (self.out / "assets").glob("*.js"):
            src = f.read_text(encoding="utf-8")
            src = re.sub(r'(from\s+"\./[\w.-]+\.js)"', rf'\1?v={self.ver}"', src)
            src = re.sub(r'(import\(\s*"\./[\w.-]+\.js)"', rf'\1?v={self.ver}"', src)
            f.write_text(src, encoding="utf-8")

    def practice_pages(self):
        """One page per practice, from site/data/practices.json, plus the practices index."""
        content = json.loads((ROOT / "site" / "data" / "practices.json").read_text(encoding="utf-8"))
        items = []
        for pid, c in content.items():
            g = self.guidance["practices"][pid]
            lines = self.guidance["lines"][g["main"]]
            sample = lines[:3] if g.get("ordered") else lines[1:4]
            starts = "".join(f'<a class="btn{"" if i == 1 else " secondary"}" href="{{{{root}}}}#len={m}&amp;p={pid}">{m} minutes</a>'
                             for i, m in enumerate(c["lengths"]))
            steps = "".join(f"<li>{e(x)}</li>" for x in c["steps"])
            notes = "".join(f"<h3>{e(q)}</h3><p>{e(a)}</p>" for q, a in c["notes"])
            others = "".join(f'<li><a href="../{o["slug"]}/">{e(self.guidance["practices"][k]["title"])}</a></li>'
                             for k, o in content.items() if k != pid)
            body = f"""<p class="eyebrow">Practice</p>
<h1>{e(c["h1"])}</h1>
<p class="lede">{e(c["intro"])}</p>
<div class="card"><h2>Start a guided session</h2><div class="btn-row">{starts}</div>
<p class="small">Each session is generated fresh: a slow drone, bells, and spoken guidance you can turn down or off. <a href="{{{{root}}}}#p={pid}">Choose another length or sound</a>.</p></div>
<h2>How to do it</h2>
<ol class="steps">{steps}</ol>
<h2>If it's not going smoothly</h2>
{notes}
<h2>What the guidance sounds like</h2>
<ul class="quotes">{"".join(f"<li>{e(x)}</li>" for x in sample)}</ul>
<p class="small">The session draws on {len(lines)} lines for this practice, plus lines for arriving, settling, wandering and closing, arranged differently each time.</p>
<h2>Other practices</h2>
<ul>{others}</ul>
"""
            jsonld = [{"@context": "https://schema.org", "@type": "HowTo", "name": c["h1"], "url": "{{site_url}}/practices/" + c["slug"] + "/",
                       "description": c["description"], "step": [{"@type": "HowToStep", "text": x} for x in c["steps"]]}]
            meta = {"path": f"practices/{c['slug']}/", "title": c["title"] + " | Hum & Bell", "description": c["description"],
                    "og": "home", "nav": "practices/", "jsonld": jsonld, "source": "practices.json"}
            self.pages.append((meta, body))
            items.append(f'<li><a href="{c["slug"]}/"><b>{e(g["title"])}</b></a><br>{e(g["summary"])}</li>')
        silent = self.guidance["practices"]["silent"]
        items.append(f'<li><a href="../meditation-timer/"><b>{e(silent["title"])}</b></a><br>{e(silent["summary"])}</li>')
        index = f"""<h1>Practices</h1>
<p class="lede">Eight simple, widely taught ways to sit, and a silent timer. Each page explains the practice; each session is generated fresh when you start it.</p>
<ul class="guide-list">{"".join(items)}</ul>
<p>New to meditation? Start with <a href="breath/">the breath</a> for five or ten minutes. Consistency matters more than length.</p>
"""
        self.pages.append(({"path": "practices/", "title": "Meditation practices, explained simply | Hum & Bell",
                            "description": "Breath, counting, body scan, listening, kindness, word repetition, open awareness and gratitude: how to do each, and a free guided session for each.",
                            "og": "home", "nav": "practices/", "source": "practices.json"}, index))

    def build(self):
        if self.out.exists():
            shutil.rmtree(self.out)
        self.out.mkdir(parents=True)
        self.assets()
        self.practice_pages()
        for meta, body in self.pages:
            path = meta["path"]
            target = path if path.endswith(".html") else path + "index.html"
            self.write(target, self.layout(meta, body))
            if not meta.get("noindex") and path != "404.html":
                self.indexable.append(path)
        lastmod = self.today.isoformat()
        urls = "".join(f"<url><loc>{self.url(p)}</loc><lastmod>{lastmod}</lastmod></url>\n" for p in self.indexable)
        self.write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
                   f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
        self.write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {self.site_url}/sitemap.xml\n")
        self.write(f"{INDEXNOW_KEY}.txt", INDEXNOW_KEY)
        self.write(".nojekyll", "")
        self.write("urls.txt", "".join(self.url(p) + "\n" for p in self.indexable))
        self.write("build.json", json.dumps({"commit": self.commit, "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                             "version": self.ver}) + "\n")
        return self


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    args = ap.parse_args()
    today = dt.date.fromisoformat(os.environ["BUILD_DATE"]) if os.environ.get("BUILD_DATE") else dt.datetime.now(dt.timezone.utc).date()
    site = Site(args.out, today).build()
    print(f"built {len(site.pages)} pages ({len(site.indexable)} in the sitemap) into {args.out}, version {site.ver}")


if __name__ == "__main__":
    main()
