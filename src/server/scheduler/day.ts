/** "今天"的边界按 Asia/Shanghai 算（容器/系统时区不可信）。 */
export const TZ = "Asia/Shanghai";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export interface DayBounds { date: string; start: Date; end: Date }

export function dayBounds(now: Date): DayBounds {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const h = Number(p.hour === "24" ? 0 : p.hour), m = Number(p.minute), s = Number(p.second);
  const start = new Date(now.getTime() - ((h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds()));
  return { date: `${p.year}-${p.month}-${p.day}`, start, end: new Date(start.getTime() + 86_400_000) };
}

export function localDate(now: Date): string {
  return dayBounds(now).date;
}

/** 两个 YYYY-MM-DD 之间的天数（b - a）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 本周（周一到周日）的日期范围，输入 YYYY-MM-DD。 */
export function weekBounds(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 周一 = 0
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(d.getTime() - dow * 86_400_000), to: iso(d.getTime() + (6 - dow) * 86_400_000) };
}
