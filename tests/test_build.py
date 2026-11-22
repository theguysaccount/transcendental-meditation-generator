"""Build tests: python3 -m unittest discover -s tests -v

Builds the site into temporary folders (with today's date) and checks the output: every page and
link resolves, the security policy is on every page, the optional settings switch what they should.
Nothing here depends on launch-day content or counts.
"""
import importlib.util
import json
import os
import re
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build", ROOT / "pipeline" / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.ld, self._in_ld, self.csp, self.canonical = [], [], False, None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for key in ("href", "src"):
            if a.get(key):
                self.refs.append(a[key])
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld = True
        if tag == "meta" and a.get("http-equiv") == "Content-Security-Policy":
            self.csp = a.get("content")
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")

    def handle_endtag(self, tag):
        self._in_ld = False

    def handle_data(self, data):
        if self._in_ld:
            self.ld.append(data)


def make(env=None):
    out = Path(tempfile.mkdtemp())
    with mock.patch.dict(os.environ, env or {}, clear=False):
        for k in ("SITE_URL", "MOVE_NOTICE_URL", "GOATCOUNTER_URL", "SUPPORT_URL", "SUPPORT_LABEL"):
            if k not in (env or {}):
                os.environ.pop(k, None)
        site = build.Site(out, build.dt.date.today()).build()
    return site, out


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site, cls.out = make()

    def pages(self):
        return sorted(self.out.rglob("*.html"))

    def test_every_page_is_built_and_in_the_sitemap(self):
        sitemap = (self.out / "sitemap.xml").read_text()
        locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)
        self.assertEqual(len(locs), len(self.site.indexable))
        for path in self.site.indexable:
            self.assertTrue((self.out / (path + "index.html")).exists(), path)
            self.assertIn(f"{build.DEFAULT_SITE_URL}/{path}", locs)
        self.assertNotIn("404", sitemap)
        self.assertIn(f"Sitemap: {build.DEFAULT_SITE_URL}/sitemap.xml", (self.out / "robots.txt").read_text())
        self.assertEqual((self.out / f"{build.INDEXNOW_KEY}.txt").read_text(), build.INDEXNOW_KEY)
        self.assertEqual((self.out / "urls.txt").read_text().split(), [f"{build.DEFAULT_SITE_URL}/{p}" for p in self.site.indexable])

    def test_every_local_link_and_file_resolves(self):
        for page in self.pages():
            refs = Refs()
            refs.feed(page.read_text())
            for ref in refs.refs:
                if re.match(r"^(https?:|mailto:|#|data:)", ref) or ref.startswith("/transcendental-meditation-generator/"):
                    continue
                clean = ref.split("#")[0].split("?")[0]
                target = (page.parent / clean).resolve() if clean else page
                if clean.endswith("/") or target.is_dir():
                    target = target / "index.html"
                self.assertTrue(target.exists(), f"{page.relative_to(self.out)} links to missing {ref}")

    def test_every_page_has_the_security_policy_metadata_and_no_placeholders(self):
        for page in self.pages():
            html = page.read_text()
            refs = Refs()
            refs.feed(html)
            self.assertIn("connect-src 'none'", refs.csp, page)
            self.assertIn("script-src 'self';", refs.csp, page)
            self.assertNotIn("{{", html, page)
            self.assertIn('<meta name="description"', html, page)
            self.assertIn('property="og:image"', html, page)
            for block in refs.ld:
                json.loads(block)
            rel = page.relative_to(self.out).as_posix()
            if rel != "404.html":
                self.assertEqual(refs.canonical, f"{build.DEFAULT_SITE_URL}/{rel[:-len('index.html')]}", page)

    def test_every_practice_has_a_page_that_starts_its_sessions(self):
        content = json.loads((ROOT / "site" / "data" / "practices.json").read_text())
        guidance = json.loads((ROOT / "site" / "data" / "guidance.json").read_text())
        self.assertEqual(set(content), {k for k, v in guidance["practices"].items() if v["main"]})
        index = (self.out / "practices" / "index.html").read_text()
        for pid, c in content.items():
            html = (self.out / "practices" / c["slug"] / "index.html").read_text()
            for m in c["lengths"]:
                self.assertIn(f"#len={m}&amp;p={pid}", html, pid)
            self.assertIn(f'href="{c["slug"]}/"', index)
            self.assertIn('"@type": "HowTo"', html)

    def test_practice_text_makes_no_health_claims(self):
        banned = re.compile(r"\b(heal|cure|treat|therap\w*|anxiety|depress\w*|insomnia|blood pressure|stress relief|reduce stress|proven|brain ?waves?)\b", re.I)
        text = (ROOT / "site" / "data" / "practices.json").read_text()
        self.assertEqual(banned.findall(text), [])

    def test_the_guidance_library_is_only_embedded_where_sessions_run(self):
        self.assertIn('id="guidance"', (self.out / "index.html").read_text())
        self.assertNotIn('id="guidance"', (self.out / "about" / "index.html").read_text())

    def test_imports_carry_the_build_version(self):
        for js in (self.out / "assets").glob("*.js"):
            for m in re.findall(r'from\s+"(\./[^"]+)"', js.read_text()):
                self.assertIn(f"?v={self.site.ver}", m, js.name)

    def test_optional_keys_switch_what_they_should(self):
        site, out = make({"GOATCOUNTER_URL": "https://example.goatcounter.com/count", "SUPPORT_URL": "https://example.org/support",
                          "SITE_URL": "https://sit.example.org"})
        home = (out / "index.html").read_text()
        self.assertIn("https://gc.zgo.at", home)
        self.assertIn("connect-src https://example.goatcounter.com", home)
        self.assertIn("GoatCounter", home)
        self.assertIn("https://example.org/support", home)
        self.assertIn("Support Hum &amp; Bell", home)
        self.assertIn('<link rel="canonical" href="https://sit.example.org/">', home)
        self.assertIn("Sitemap: https://sit.example.org/sitemap.xml", (out / "robots.txt").read_text())
        self.assertIn('href="/assets/site.css', (out / "404.html").read_text())
        # Off by default: no analytics script, no money slot.
        default_home = (self.out / "index.html").read_text()
        self.assertNotIn("gc.zgo.at", default_home)
        self.assertNotIn("Support Hum", default_home)
        self.assertIn('href="/transcendental-meditation-generator/assets/site.css', (self.out / "404.html").read_text())

    def test_a_move_notice_appears_only_when_set(self):
        self.assertNotIn("move-notice", (self.out / "index.html").read_text())
        site, out = make({"MOVE_NOTICE_URL": "https://new.example.org/"})
        for page in (out / "index.html", out / "about" / "index.html"):
            html = page.read_text()
            self.assertIn('class="move-notice"', html)
            self.assertIn('href="https://new.example.org/"', html)
        with self.assertRaises(SystemExit):
            make({"MOVE_NOTICE_URL": "javascript:alert(1)"})


if __name__ == "__main__":
    unittest.main()
