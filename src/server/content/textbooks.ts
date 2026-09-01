/** 教材文本（textbook/txt/*.txt）与内容池文件的读取。只有 CLI 与入库脚本用，纯逻辑不依赖它。 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Subject } from "../../shared/types.ts";
import { TextbookText } from "./verify.ts";
import type { PoolFile } from "./pools.ts";

export const ROOT = new URL("../../../", import.meta.url).pathname;
export const POOLS_DIR = join(ROOT, "content/pools");
export const AUDIO_DIR = join(ROOT, "content/audio");
export const TEXT_DIR = join(ROOT, "textbook/txt");

/** 一科可有多份文本（PDF 文字层 + OCR），核对时取并集：文字层分栏会把注释拆散，OCR 按版面读行。 */
const TEXT_FILE: Record<Subject, string | string[]> = {
  语文: ["语文七上.txt", "语文七上-ocr.txt"],
  数学: "数学七上.txt",
  英语: "英语七上.txt",
  历史: "历史七上.txt",
  地理: "地理七上.txt",
  生物: "生物七上.txt",
  道法: "道法七上.txt",
};

const cache = new Map<Subject, TextbookText>();
export function textbookOf(subject: Subject): TextbookText {
  let t = cache.get(subject);
  if (!t) {
    const files = [TEXT_FILE[subject]].flat().map((f) => join(TEXT_DIR, f));
    const present = files.filter((f) => existsSync(f));
    if (present.length === 0) throw new Error(`缺教材文本：${files[0]}（用 tools/ocr.swift 或 pdftotext 生成）`);
    t = new TextbookText(present.map((f) => readFileSync(f, "utf8")).join("\n"), {
      stripNoteMarks: subject === "语文",
      dropPageRefs: subject === "英语",
    });
    cache.set(subject, t);
  }
  return t;
}

export function audioWords(): Set<string> {
  if (!existsSync(AUDIO_DIR)) return new Set();
  return new Set(readdirSync(AUDIO_DIR).filter((f) => f.endsWith(".ogg")).map((f) => f.slice(0, -4).toLowerCase()));
}

/** 读内容池；不传 names 时读全部（含草稿与附属文件，parsePool 自己会跳过）。 */
export function readPools(names?: string[]): PoolFile[] {
  const audio = audioWords();
  const files = names ?? readdirSync(POOLS_DIR).filter((f) => f.endsWith(".json")).map((f) => basename(f, ".json")).sort();
  return files.map((name) => ({
    name: basename(name, ".json"),
    json: JSON.parse(readFileSync(join(POOLS_DIR, `${basename(name, ".json")}.json`), "utf8")),
    audioWords: audio,
  }));
}
