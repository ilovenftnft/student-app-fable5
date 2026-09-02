import { useEffect, useState } from "react";
import { api } from "./api.ts";

/**
 * 英语单词的读音（家长 2026-09-02 加，参考 vocabulary-building 项目）：
 * 有真人录音（content/audio，维基词典母语者）放录音；没有就用系统本机语音合成，不用网络（硬约束 1）。
 * 词组和整句只走语音合成。点一下读一遍，不自动播。
 */
export type Pron = { ipa: string; audio: string | null; chunks?: string[]; rule?: string };
let cache: Promise<Record<string, Pron>> | null = null;
export function usePronunciation(): Record<string, Pron> {
  const [m, setM] = useState<Record<string, Pron>>({});
  useEffect(() => { cache ??= api.pronunciation().catch(() => ({})); void cache.then(setM); }, []);
  return m;
}
export function pronOf(m: Record<string, Pron>, word: string): Pron | undefined {
  return m[word.trim().toLowerCase()];
}

function tts(text: string) {
  try {
    const ss = window.speechSynthesis;
    if (!ss) return;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const vs = ss.getVoices().filter((v) => v.lang.replace("_", "-").startsWith("en"));
    const v = vs.find((x) => /Samantha/i.test(x.name)) ?? vs.find((x) => x.lang.replace("_", "-") === "en-US") ?? vs[0];
    if (v) u.voice = v;
    u.lang = "en-US";
    u.rate = 0.85;
    ss.speak(u);
  } catch { /* 没有语音合成就安静 */ }
}
let playing: HTMLAudioElement | null = null;
export function speak(text: string, audio: string | null): void {
  if (playing) playing.pause();
  if (!audio) { tts(text); return; }
  const a = new Audio(audio);
  playing = a;
  let fell = false;
  const fall = () => { if (fell) return; fell = true; tts(text); };
  a.onerror = fall;
  a.play().catch(fall);
}

/** 喇叭按钮：36px 圆形线框，和讲解的 ? 按钮同一规格。 */
export function Speaker({ text, audio }: { text: string; audio: string | null }) {
  return (
    <button type="button" className="speak" aria-label={`读 ${text}`} title="读一遍" onClick={(e) => { e.stopPropagation(); speak(text, audio); }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  );
}
