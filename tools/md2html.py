#!/usr/bin/env python3
"""Minimal Markdown -> HTML converter for this repo's reports.

Supports the subset we write: ATX headings, paragraphs, blockquotes,
pipe tables, unordered/ordered lists, **bold**, `code`, [links](url).
Usage: md2html.py input.md > body.html
"""
import html
import re
import sys


def inline(s: str) -> str:
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    return s


def slug(text: str, used: set) -> str:
    base = re.sub(r"[^\w一-鿿]+", "-", text).strip("-") or "s"
    s, i = base, 2
    while s in used:
        s, i = f"{base}-{i}", i + 1
    used.add(s)
    return s


def convert(md: str):
    lines = md.splitlines()
    out, toc, used = [], [], set()
    i, n = 0, len(lines)
    para = []

    def flush_para():
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()

    while i < n:
        line = lines[i]
        if not line.strip():
            flush_para(); i += 1; continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush_para()
            level, text = len(m.group(1)), m.group(2).strip()
            sid = slug(text, used)
            out.append(f'<h{level} id="{sid}">{inline(text)}</h{level}>')
            if level in (2, 3):
                toc.append((level, sid, text))
            i += 1; continue
        if line.startswith(">"):
            flush_para()
            q = []
            while i < n and lines[i].startswith(">"):
                q.append(lines[i][1:].strip()); i += 1
            out.append(f"<blockquote><p>{inline(' '.join(q))}</p></blockquote>")
            continue
        if line.startswith("|"):
            flush_para()
            rows = []
            while i < n and lines[i].startswith("|"):
                rows.append(lines[i]); i += 1
            cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
            if len(cells) >= 2 and all(re.fullmatch(r":?-+:?", c) for c in cells[1]):
                head, body = cells[0], cells[2:]
            else:
                head, body = None, cells
            t = ['<div class="table-wrap"><table>']
            if head:
                t.append("<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>")
            t.append("<tbody>")
            for r in body:
                t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table></div>")
            out.append("".join(t))
            continue
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if m:
            flush_para()
            ordered = m.group(2)[0].isdigit()
            tag = "ol" if ordered else "ul"
            items = []
            while i < n:
                m2 = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[i])
                if not m2:
                    break
                items.append(m2.group(3)); i += 1
                # continuation lines (indented, non-list)
                while i < n and lines[i].startswith("   ") and not re.match(r"^\s*([-*]|\d+\.)\s", lines[i]):
                    items[-1] += " " + lines[i].strip(); i += 1
            out.append(f"<{tag}>" + "".join(f"<li>{inline(it)}</li>" for it in items) + f"</{tag}>")
            continue
        para.append(line.strip()); i += 1
    flush_para()
    return "\n".join(out), toc


if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf-8").read()
    body, toc = convert(src)
    if len(sys.argv) > 2 and sys.argv[2] == "--toc":
        print("\n".join(f'<a class="toc-{l}" href="#{s}">{html.escape(t)}</a>' for l, s, t in toc))
    else:
        print(body)
