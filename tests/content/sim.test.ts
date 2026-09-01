import { describe, expect, it } from "vitest";
import { simulate, rng, secondsFor, DEFAULT_SIM } from "../../src/server/content/sim.ts";
import type { Item } from "../../src/shared/types.ts";

function concept(n: number, span = 50): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `concept:生物:x:${i}`, subject: "生物", kind: "concept", subtype: "fill", front: "?", back: "!",
    sourceQuote: "", sourceRef: "", pool: "standard", introDay: Math.floor((i * span) / n), meta: {},
  }));
}
function recitation(n: number): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < n; i++) {
    const fill = `recitation:p:${i}:fill`;
    out.push({ id: fill, subject: "语文", kind: "recitation", subtype: "fill", front: "", back: "", sourceQuote: "", sourceRef: "", pool: "standard", introDay: 0, meta: {} });
    out.push({ id: `recitation:p:${i}:context`, subject: "语文", kind: "recitation", subtype: "context", front: "", back: "", sourceQuote: "", sourceRef: "", pool: "standard", introDay: 0, parentId: fill, meta: {} });
  }
  return out;
}

describe("simulate", () => {
  it("同一种子结果完全相同，不同种子不同", () => {
    const a = simulate(concept(100), { days: 60, seed: 7 });
    const b = simulate(concept(100), { days: 60, seed: 7 });
    const c = simulate(concept(100), { days: 60, seed: 8 });
    expect(a).toEqual(b);
    expect(a.days.map((d) => d.minutes)).not.toEqual(c.days.map((d) => d.minutes));
  });
  it("按 introDay 引入，天数与引入数对得上", () => {
    const r = simulate(concept(100, 50), { days: 60 });
    expect(r.days).toHaveLength(60);
    expect(r.introduced).toBe(100);
    expect(r.days[0]!.newCards).toBe(2);
    expect(r.days[59]!.newCards).toBe(0);
    expect(r.byKind).toEqual({ concept: 100 });
  });
  it("内容翻倍，总负荷明显上升", () => {
    const one = simulate(concept(100), { days: 90 }).days.reduce((a, d) => a + d.minutes, 0);
    const two = simulate(concept(200), { days: 90 }).days.reduce((a, d) => a + d.minutes, 0);
    expect(two).toBeGreaterThan(one * 1.6);
  });
  it("情境卡等接句卡成熟后才引入", () => {
    const items = recitation(10);
    const short = simulate(items, { days: 5 });
    expect(short.introduced).toBe(10);
    const long = simulate(items, { days: 150 });
    expect(long.introduced).toBeGreaterThan(10);
    expect(long.introduced).toBeLessThanOrEqual(20);
  });
  it("prestudy 不参与", () => {
    const r = simulate([{ ...concept(1)[0]!, id: "p", kind: "prestudy", subtype: "definition" }], { days: 10 });
    expect(r.totalItems).toBe(0);
    expect(r.medianMinutes).toBe(0);
  });
  it("通过标准：中位 ≤ 12 且超 20 分钟天数 ≤ 10%", () => {
    expect(simulate(concept(50), { days: 60 }).pass).toBe(true);
    const heavy = simulate(concept(3000, 10), { days: 60 });
    expect(heavy.medianMinutes).toBeGreaterThan(12);
    expect(heavy.pass).toBe(false);
  });
  it("耗时按种类:子型查表，缺省回落到种类", () => {
    const it0 = concept(1)[0]!;
    expect(secondsFor(it0, DEFAULT_SIM)).toBe(15);
    expect(secondsFor({ ...it0, kind: "wrong", subtype: "x" }, DEFAULT_SIM)).toBe(90);
  });
  it("rng 可复现且落在 [0,1)", () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 5; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});
