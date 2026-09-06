#!/usr/bin/env python3
"""Build an HTML page from a Markdown report (single source of truth).

Default: docs/研究报告-app方案.md -> docs/研究报告-app方案.html.
Usage: build_report.py [--src in.md] [--out out.html] [--title T] [--eyebrow E] [--meta M] [--footer F]
"""
import argparse
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from md2html import convert  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--src", default=str(ROOT / "docs" / "研究报告-app方案.md"))
ap.add_argument("--out", default=None)
ap.add_argument("--title", default="初一学习 App 方案")
ap.add_argument("--eyebrow", default="研究报告 · 2026-09-01")
ap.add_argument("--meta", default="给一位厦门家长：孩子今天开学上初一，目标是三年后中考效率优先、每天有时间做自己喜欢的事。所有建议标注依据；\"判断\"为经验推断，\"待核实\"为未找到官方来源。")
ap.add_argument("--footer", default="依据文件：docs/research/01–05 · docs/data/exam_summary.md · docs/experiments/2026-09-01-dualrun · 由 Claude 撰写，Codex 独立审阅（见末节）。")
args = ap.parse_args()
SRC = Path(args.src)
OUT = Path(args.out) if args.out else SRC.with_suffix(".html")
TITLE, EYEBROW, META, FOOTER = (html.escape(x, quote=False) for x in (args.title, args.eyebrow, args.meta, args.footer))

md = SRC.read_text(encoding="utf-8")
body, toc = convert(md)

# Pull the H1 out; wrap the first H2 section (一页结论) as the summary block.
body = re.sub(r"^<h1[^>]*>.*?</h1>\n?", "", body, count=1)
parts = re.split(r"(?=<h2 )", body)
lead, first, rest = parts[0], parts[1], "".join(parts[2:])
body = lead + '<section class="summary">' + first + "</section>" + rest

toc_html = "\n".join(
    f'<a class="toc-{l}" href="#{s}">{html.escape(t)}</a>' for l, s, t in toc if l == 2
)

page = f"""<title>{TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap">
<style>
:root {{
  --bg: #F6F7F5; --surface: #FFFFFF; --ink: #1B2028; --muted: #5C6570;
  --accent: #3A55B4; --accent-ink: #FFFFFF; --rule: #E1E4DE; --rule-strong: #C9CEC6;
  --summary-bg: #EEF1FA; --code-bg: #EEF0EC; --ok: #2E7D5B; --warn: #A66A1B;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --bg: #14171B; --surface: #1B1F25; --ink: #E7E9EC; --muted: #9AA3AE;
    --accent: #8FA3F0; --accent-ink: #0F1320; --rule: #2A3038; --rule-strong: #3A424C;
    --summary-bg: #1E2536; --code-bg: #232830; --ok: #6CC4A1; --warn: #E0A85A;
  }}
}}
:root[data-theme="dark"] {{
  --bg: #14171B; --surface: #1B1F25; --ink: #E7E9EC; --muted: #9AA3AE;
  --accent: #8FA3F0; --accent-ink: #0F1320; --rule: #2A3038; --rule-strong: #3A424C;
  --summary-bg: #1E2536; --code-bg: #232830; --ok: #6CC4A1; --warn: #E0A85A;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: "Noto Sans SC", -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 16px; line-height: 1.75; -webkit-font-smoothing: antialiased;
}}
a {{ color: var(--accent); text-decoration: none; }}
a:hover, a:focus-visible {{ text-decoration: underline; outline: none; }}
a:focus-visible, button:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
.shell {{ display: grid; grid-template-columns: 1fr; gap: 0; max-width: 1080px; margin: 0 auto; padding: 0 20px 96px; }}
@media (min-width: 1000px) {{ .shell {{ grid-template-columns: 232px minmax(0, 720px); gap: 48px; }} }}
header.masthead {{ grid-column: 1 / -1; padding: 56px 0 24px; border-bottom: 1px solid var(--rule-strong); margin-bottom: 40px; }}
.eyebrow {{ font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 500; }}
h1 {{
  font-family: "Noto Serif SC", "Songti SC", "STSong", serif; font-weight: 700;
  font-size: clamp(30px, 4vw, 42px); line-height: 1.2; margin: 10px 0 12px; text-wrap: balance; letter-spacing: 0.01em;
}}
.meta {{ color: var(--muted); font-size: 14px; max-width: 720px; }}
nav.toc {{ display: none; }}
@media (min-width: 1000px) {{
  nav.toc {{ display: flex; flex-direction: column; gap: 2px; position: sticky; top: 24px; align-self: start; font-size: 13.5px; }}
  nav.toc .label {{ font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }}
  nav.toc a {{ color: var(--muted); padding: 4px 0 4px 10px; border-left: 2px solid transparent; line-height: 1.4; }}
  nav.toc a:hover {{ color: var(--ink); text-decoration: none; }}
  nav.toc a.active {{ color: var(--ink); border-left-color: var(--accent); }}
}}
main {{ min-width: 0; }}
h2 {{
  font-family: "Noto Serif SC", "Songti SC", serif; font-weight: 700; font-size: 24px; line-height: 1.3;
  margin: 56px 0 16px; padding-top: 16px; border-top: 1px solid var(--rule-strong); text-wrap: balance;
}}
h3 {{ font-size: 17px; font-weight: 700; margin: 32px 0 10px; }}
p {{ margin: 0 0 14px; max-width: 68ch; }}
strong {{ font-weight: 700; }}
blockquote {{ margin: 0 0 20px; padding: 12px 16px; border-left: 3px solid var(--accent); background: var(--surface); color: var(--muted); font-size: 14px; }}
blockquote p {{ margin: 0; max-width: none; }}
code {{ font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }}
ul, ol {{ margin: 0 0 16px; padding-left: 1.4em; max-width: 70ch; }}
li {{ margin: 4px 0; }}
li::marker {{ color: var(--muted); }}
.summary {{ background: var(--summary-bg); border: 1px solid var(--rule); border-radius: 10px; padding: 8px 28px 20px; margin-bottom: 8px; }}
.summary h2 {{ border-top: 0; margin-top: 16px; padding-top: 0; }}
.summary p, .summary ol {{ max-width: none; }}
.table-wrap {{ overflow-x: auto; margin: 0 0 22px; border: 1px solid var(--rule); border-radius: 8px; background: var(--surface); }}
table {{ border-collapse: collapse; width: 100%; font-size: 14px; line-height: 1.5; font-variant-numeric: tabular-nums; }}
th, td {{ padding: 9px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); }}
th {{ font-weight: 700; font-size: 12.5px; letter-spacing: 0.04em; color: var(--muted); background: var(--bg); white-space: nowrap; }}
tr:last-child td {{ border-bottom: 0; }}
td:first-child {{ font-weight: 500; }}
footer {{ grid-column: 1 / -1; margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--rule-strong); color: var(--muted); font-size: 13px; }}
@media (prefers-reduced-motion: no-preference) {{ html {{ scroll-behavior: smooth; }} }}
</style>
<div class="shell">
  <header class="masthead">
    <div class="eyebrow">{EYEBROW}</div>
    <h1>{TITLE}</h1>
    <div class="meta">{META}</div>
  </header>
  <nav class="toc" aria-label="目录"><div class="label">目录</div>
{toc_html}
  </nav>
  <main>
{body}
  </main>
  <footer>{FOOTER}</footer>
</div>
<script>
(function(){{
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  if (!links.length || !('IntersectionObserver' in window)) return;
  var map = {{}};
  links.forEach(function(a){{ map[a.getAttribute('href').slice(1)] = a; }});
  var obs = new IntersectionObserver(function(entries){{
    entries.forEach(function(e){{
      if (e.isIntersecting) {{
        links.forEach(function(a){{ a.classList.remove('active'); }});
        var a = map[e.target.id]; if (a) a.classList.add('active');
      }}
    }});
  }}, {{ rootMargin: '-10% 0px -80% 0px' }});
  document.querySelectorAll('main h2[id]').forEach(function(h){{ obs.observe(h); }});
}})();
</script>
"""
OUT.write_text(page, encoding="utf-8")
print(f"wrote {OUT} ({len(page)} bytes), {len(toc)} toc entries")
