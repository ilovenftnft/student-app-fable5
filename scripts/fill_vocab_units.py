#!/usr/bin/env python3
"""
英语七上：给词汇池的「本册新词」补「单元」字段，并给章节树的叶子写要点。

只改两个文件（不碰数据库）：
  content/pools/英语-七上-词汇.json      词[] 中 组=本册新词 的 单元
  content/chapters/英语-七上.json        每个叶子的 要点

数据来源：教材书末 "Vocabulary in Each Unit"（PDF p115–121，印刷页 106–112）。
  textbook/txt/英语七上.txt 第 7249 行起也是这一节，但它是纯文本抽取：双栏排版下页码引用与词条脱开、
  左右栏交错（如 Unit 2 的 son / hike 在文本里排在 "Unit 3" 标题之后），按标题顺序分配会错。
  所以这里用 pdftohtml -xml 的字符坐标（与词汇池本身的抽取方式一致，见词汇池「说明」）：
  按页 → 栏（左/右）→ 行 还原阅读顺序，词条归属其上方最近的 "Unit N" 标题，
  再用词条自带的页码（p.N，印刷页）按单元页码范围交叉核对，不一致的列出来，不猜。

用法：
  python3 scripts/fill_vocab_units.py            # 写两个文件
  python3 scripts/fill_vocab_units.py --check    # 只报告，不写
可重复运行：结果只由教材决定，第二次运行输出不变。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "textbook" / "2024人教版·英语七年级上册.pdf"
VOCAB = ROOT / "content" / "pools" / "英语-七上-词汇.json"
CHAPTERS = ROOT / "content" / "chapters" / "英语-七上.json"
PDF_FIRST, PDF_LAST = 115, 121  # "Vocabulary in Each Unit"
COLUMN_SPLIT = 375  # 页宽 782，左栏页码引用最右到 369，右栏词条最左 383
LINE_TOL = 6
NEW_WORD_GROUP = "本册新词"

# 各单元的印刷页范围（Starter 6 页一单元，Unit 8 页一单元）
UNIT_PAGES: "OrderedDict[str, tuple[int, int]]" = OrderedDict(
    [("Starter Unit 1", (1, 6)), ("Starter Unit 2", (7, 12)), ("Starter Unit 3", (13, 18))]
    + [(f"Unit {i}", (19 + 8 * (i - 1), 26 + 8 * (i - 1))) for i in range(1, 8)]
)
# Section B = 单元最后 3 页（Grammar Focus 在倒数第 4 页；由 txt 里 Grammar Focus 的 PDF 页 32/40/…/80 推得）
SECTION_B_PAGES = {u: (last - 2, last) for u, (_, last) in UNIT_PAGES.items() if u.startswith("Unit")}

# Section A 的要点 = 本单元 Grammar Focus 3a 的句子（教材原句，整句核对）。
# 问答相邻的合成一条；Unit 3 的 3a 问句与答句分列两栏、Unit 6 的 3a 问句挖了空，只取完整的单句。
GRAMMAR_FOCUS: dict[str, list[str]] = {
    "Unit 1": [
        "Are you Peter? Yes, I am. / No, I’m not.",
        "Are Meimei and Peter in the same class? Yes, they are. / No, they aren’t.",
        "Where is Mr Smith from? He’s from the US.",
        "What class are you in? I’m in Class 1, Grade 7.",
        "Who’s your class teacher? It’s Ms Gao.",
    ],
    "Unit 2": [
        "Teng Fei and his grandpa play ping-pong every week.",
        "Teng Fei’s father has a fishing rod.",
        "Do you play the piano? Yes, I do. / No, I don’t.",
        "Does your father spend a lot of time fishing? Yes, he does. / No, he doesn’t.",
        "Whose piano is this? It’s my mother’s.",
    ],
    "Unit 3": [
        "It is behind the classroom building.",
        "Is there a whiteboard in your classroom?",
        "There is a teachers’ building across from the school hall.",
        "There is a student centre between the library and the gym.",
        "There are some trees in front of the sports field.",
    ],
    "Unit 4": [
        "I have art and geography today.",
        "English is important, and my English teacher is really nice.",
        "Biology is difficult but important.",
        "History is my favourite subject, but my sister doesn’t like it.",
        "I like Chinese because it’s fun.",
    ],
    "Unit 5": [
        "Can you play ping-pong? Yes, I can. / No, I can’t.",
        "Can he play the violin? Yes, he can. / No, he can’t.",
        "Can they play chess? Yes, they can. / No, they can’t.",
        "I can run fast, but I can’t swim.",
        "Emma can sing well, but she can’t play any musical instruments.",
    ],
    "Unit 6": [
        "I usually get up at 6:30 a.m.",
        "He usually goes to bed at 9:30 p.m.",
        "They go on Monday afternoons.",
        "He brushes his teeth and takes a shower.",
        "Sometimes I read books or do my homework.",
    ],
    "Unit 7": [
        "When is your birthday? It’s on 2nd August.",
        "How old are you? I’m 12.",
        "What do you want to do on her birthday? I want to sing a song for her.",
        "How much are those oranges? Six yuan a kilo.",
        "How many kilos do you want? I want five kilos.",
    ],
}
POINTS_PER_LEAF = 5

# ---------- 解析教材 ----------

TEXT_RE = re.compile(r'<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="\d+">(.*?)</text>')
REF_RE = re.compile(r"^p\.\s*(\d+)$")
HEADER_RE = re.compile(r"^(Starter Unit \d|Unit \d)$")
CJK_RE = re.compile(r"[　-鿿＀-￯]")


def unescape(s: str) -> str:
    return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "’")


def plain(html: str) -> str:
    return unescape(re.sub(r"<[^>]+>", "", html))


def render_xml(pdf: Path) -> str:
    if not shutil.which("pdftohtml"):
        sys.exit("需要 pdftohtml（poppler）来读教材坐标：brew install poppler")
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "vocab"
        subprocess.run(
            ["pdftohtml", "-xml", "-i", "-f", str(PDF_FIRST), "-l", str(PDF_LAST), str(pdf), str(out)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return out.with_suffix(".xml").read_text(encoding="utf-8")


def word_of(entry_html: str) -> str:
    """词条 HTML → 词/词组：去斜体词性、去音标 /…/、去括注、截到第一个汉字之前。"""
    s = re.sub(r"<i>.*?</i>", " ", entry_html)
    s = plain(s)
    s = re.sub(r"/[^/]*?/", " ", s)
    s = re.sub(r"\([^)]*\)|（[^）]*）", " ", s)
    s = re.split(r"[(（]", s, maxsplit=1)[0]  # 未闭合的括注（"(= kilogram," 折到下一行）
    s = CJK_RE.split(s, 1)[0]
    s = re.sub(r"\b(n|v|adj|adv|prep|pron|conj|interj|num|art|det|aux|modal|pl)\.", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def key_of(word: str) -> str:
    """匹配键：大小写不敏感，去标点，空格合并为一个（"every day" 与 "everyday" 不同词）。"""
    return " ".join(re.sub(r"[^a-z0-9 ]", "", word.lower()).split())


class Entry:
    def __init__(self, unit: str, html: str, page: int | None, pdf_page: int):
        self.unit, self.html, self.page, self.pdf_page = unit, html, page, pdf_page
        self.word = word_of(html)
        self.key = key_of(self.word)


def parse_entries(xml: str) -> list[Entry]:
    entries: list[Entry] = []
    unit = ""  # 阅读顺序：页 → 左栏 → 右栏；单元标题沿阅读顺序延续
    for pm in re.finditer(r'<page number="(\d+)"[^>]*>(.*?)</page>', xml, re.S):
        pdf_page = int(pm.group(1))
        els = [(int(m[1]), int(m[2]), m[5]) for m in TEXT_RE.finditer(pm.group(2))]
        # 去页眉页脚：标题、页码、注
        els = [e for e in els if not re.match(r"^(Vocabulary in Each Unit|\d{3}|注：.*)$", plain(e[2]).strip())]
        for col in (0, 1):
            col_els = sorted([e for e in els if (e[1] >= COLUMN_SPLIT) == bool(col)], key=lambda e: (e[0], e[1]))
            if not col_els:
                continue
            # 栏的左边界 = 出现最多的 left（词条起始行都顶格；零星页码/竖排页号会更靠左）
            col_start = Counter(e[1] for e in col_els if plain(e[2]).strip()).most_common(1)[0][0]
            lines: list[list[tuple[int, int, str]]] = []
            for e in col_els:
                if lines and abs(e[0] - lines[-1][0][0]) <= LINE_TOL:
                    lines[-1].append(e)
                else:
                    lines.append([e])
            cur: list[list[tuple[int, int, str]]] | None = None  # 当前词条的各行（行内已按 left 排好）

            def flush() -> None:
                if cur:
                    flat = [e for line in cur for e in line]
                    refs = [REF_RE.match(plain(h).strip()) for _, _, h in flat]
                    page = next((int(m.group(1)) for m in refs if m), None)
                    html = "".join(h for _, _, h in flat if not REF_RE.match(plain(h).strip()))
                    if word_of(html):
                        entries.append(Entry(unit, html, page, pdf_page))

            for line in lines:
                line.sort(key=lambda e: e[1])
                text = plain("".join(h for _, _, h in line)).strip()
                first = next((e for e in line if plain(e[2]).strip()), None)
                if HEADER_RE.match(text):
                    flush(); cur = None
                    unit = text
                    continue
                if first and first[1] <= col_start + 3 and not REF_RE.match(text):
                    flush(); cur = [line]
                elif cur is not None:
                    cur.append(line)
            flush()
    return entries


def unit_by_page(page: int | None) -> str | None:
    if page is None:
        return None
    return next((u for u, (a, b) in UNIT_PAGES.items() if a <= page <= b), None)


# ---------- 任务 A ----------

def fill_units(vocab: dict, entries: list[Entry]) -> dict:
    by_key: dict[str, list[Entry]] = {}
    for e in entries:
        by_key.setdefault(e.key, []).append(e)
    filled, unmatched, conflicts, dupes = 0, [], [], []
    for w in vocab["词"]:
        if w.get("组") != NEW_WORD_GROUP:
            continue
        hits = by_key.get(key_of(w["词"]), [])
        if not hits:
            unmatched.append(w["词"])
            continue
        e = hits[0]
        units = sorted({h.unit for h in hits}, key=list(UNIT_PAGES).index)
        if len(units) > 1:
            dupes.append((w["词"], units))
        by_page = unit_by_page(e.page)
        if by_page and by_page != e.unit:
            conflicts.append((w["词"], e.unit, e.page))
            continue
        if w.get("单元") != e.unit:
            w["单元"] = e.unit
        filled += 1
    return {"filled": filled, "unmatched": unmatched, "conflicts": conflicts, "dupes": dupes}


# ---------- 任务 B ----------

def pick_words(vocab: dict, entries: list[Entry], unit: str) -> list[dict]:
    """本单元的本册新词：课标重点优先；Section B 页范围内优先；缩写与两字母词（AM / as / re）靠后；再按教材出现页序。"""
    page_of = {e.key: e.page for e in reversed(entries)}  # 首次出现优先
    ws = [w for w in vocab["词"] if w.get("组") == NEW_WORD_GROUP and w.get("单元") == unit]
    b_lo, b_hi = SECTION_B_PAGES.get(unit, (0, 0))

    def rank(w: dict) -> tuple:
        p = page_of.get(key_of(w["词"])) or 0
        return (not w.get("课标重点"), not (b_lo <= p <= b_hi), len(w["词"]) < 3, p)

    return sorted(ws, key=rank)[:POINTS_PER_LEAF]


def word_points(words: list[dict]) -> list[dict]:
    return [OrderedDict([("文", f"{w['词']} {w['释义']}"), ("出处", w["词"])]) for w in words]


def sentence_points(sentences: list[str]) -> list[dict]:
    return [OrderedDict([("文", s), ("出处", s)]) for s in sentences]


def fill_chapters(ch: dict, vocab: dict, entries: list[Entry]) -> list[tuple[str, int, str]]:
    report = []
    for node in ch["节点"]:
        title_unit = re.match(r"^(Starter Unit \d|Unit \d)", node["标题"]).group(1)
        if not node.get("子"):
            words = pick_words(vocab, entries, title_unit)
            node["要点"] = word_points(words)
            report.append((node["标题"], len(words), "词"))
            continue
        for leaf in node["子"]:
            if leaf["标题"] == "Section A":
                leaf["要点"] = sentence_points(GRAMMAR_FOCUS[title_unit])
                report.append((f"{node['标题']} / Section A", len(leaf["要点"]), "Grammar Focus"))
            elif leaf["标题"] == "Section B":
                words = pick_words(vocab, entries, title_unit)
                leaf["要点"] = word_points(words)
                report.append((f"{node['标题']} / Section B", len(words), "词"))
    ch["说明"] = (
        "单元 → Section A/B。Section A 要点 = 本单元 Grammar Focus 3a 的句子（整句核对）；"
        "Section B 与 Starter Unit 要点 = 本单元课标重点新词 5 个（词 + 释义，按词核对）。由 scripts/fill_vocab_units.py 生成。"
    )
    return report


# ---------- 读写 ----------

def load(path: Path) -> tuple[dict, int, bool]:
    s = path.read_text(encoding="utf-8")
    second = s.split("\n", 2)[1] if "\n" in s else ""
    indent = len(second) - len(second.lstrip(" ")) or 2
    return json.loads(s, object_pairs_hook=OrderedDict), indent, s.endswith("\n")


def dump(path: Path, obj: dict, indent: int, trailing_nl: bool) -> None:
    s = json.dumps(obj, ensure_ascii=False, indent=indent)
    path.write_text(s + ("\n" if trailing_nl else ""), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="只报告，不写文件")
    ap.add_argument("--pdf", type=Path, default=PDF)
    args = ap.parse_args()

    entries = parse_entries(render_xml(args.pdf))
    vocab, v_indent, v_nl = load(VOCAB)
    chapters, c_indent, c_nl = load(CHAPTERS)

    a = fill_units(vocab, entries)
    print(f"[A] 教材词条 {len(entries)}；本册新词填单元 {a['filled']}，未匹配 {len(a['unmatched'])}，页码与标题不一致 {len(a['conflicts'])}")
    for w in a["unmatched"]:
        print(f"    未匹配：{w}")
    for w, u, p in a["conflicts"]:
        print(f"    不一致（未填）：{w} 标题下属 {u}，页码 p.{p}")
    for w, units in a["dupes"]:
        print(f"    多单元（取首次）：{w} {units}")

    b = fill_chapters(chapters, vocab, entries)
    for title, n, kind in b:
        flag = "" if n >= 3 else "  ← 不足 3 条"
        print(f"[B] {title}: {n} 条（{kind}）{flag}")

    if args.check:
        print("--check：未写文件")
        return
    dump(VOCAB, vocab, v_indent, v_nl)
    dump(CHAPTERS, chapters, c_indent, c_nl)
    print(f"已写 {VOCAB.relative_to(ROOT)}、{CHAPTERS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
