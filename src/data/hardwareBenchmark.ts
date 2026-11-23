export interface HardwareBenchmarkRow {
  device: string;
  detail: string;
  recall: string;
  recallRatio: string;
  falsePositives: string;
  fpRatio: string;
  p50: string;
  p95: string;
  max: string;
  leaks: string;
  note: string;
}

export const HARDWARE_BENCHMARK_ROWS: HardwareBenchmarkRow[] = [
  {
    device: "Galaxy S26 Ultra",
    detail: "SM-S948B · API 37 · arm64-v8a",
    recall: "100.0%",
    recallRatio: "81/81",
    falsePositives: "0.0%",
    fpRatio: "0/46",
    p50: "0.44 ms",
    p95: "0.63 ms",
    max: "0.91 ms",
    leaks: "0",
    note: "Gemini Nano hybrid pass 2,513 ms offline",
  },
  {
    device: "Moto G82 5G",
    detail: "API 33 · fail-closed fallback",
    recall: "100.0%",
    recallRatio: "81/81",
    falsePositives: "0.0%",
    fpRatio: "0/46",
    p50: "1.42 ms",
    p95: "4.01 ms",
    max: "6.94 ms",
    leaks: "0",
    note: "No AICore — deterministic rules only",
  },
  {
    device: "Chrome Extension",
    detail: "MV3 · Chromium E2E",
    recall: "100.0%",
    recallRatio: "80/80",
    falsePositives: "0.0%",
    fpRatio: "0/48",
    p50: "—",
    p95: "—",
    max: "—",
    leaks: "0",
    note: "0 composition interruptions · 0 raw secrets in handoff",
  },
];

export interface AppLockLatency {
  app: string;
  package: string;
  lockMs: number;
}

export const APP_LOCK_LATENCIES: AppLockLatency[] = [
  { app: "WhatsApp", package: "com.whatsapp", lockMs: 7 },
  { app: "ChatGPT", package: "com.openai.chatgpt", lockMs: 10 },
  { app: "Gemini", package: "com.google.android.apps.bard", lockMs: 11 },
  { app: "Chrome", package: "com.android.chrome", lockMs: 16 },
  { app: "Google", package: "com.google.android.googlequicksearchbox", lockMs: 31 },
  { app: "Perplexity", package: "ai.perplexity.app.android", lockMs: 44 },
];

export const MULTI_TURN_RELOCK_RANGE = "7 – 17 ms";
