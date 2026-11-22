const SFX_STORAGE_KEY = "cordon_sfx_enabled";

let audioCtx: AudioContext | null = null;
let sfxEnabledCache: boolean | null = null;
let lastHoverTickAt = 0;

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function readStoredSfxEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(SFX_STORAGE_KEY);
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function isSfxEnabled(): boolean {
  if (sfxEnabledCache === null) {
    sfxEnabledCache = readStoredSfxEnabled();
  }
  return sfxEnabledCache;
}

export function setSfxEnabled(enabled: boolean): void {
  sfxEnabledCache = enabled;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SFX_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage failures in restricted contexts
  }
}

function ensureUnlockedAudioContext(): AudioContext | null {
  if (!isSfxEnabled()) return null;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }

  if (audioCtx.state === "suspended") {
    try {
      void audioCtx.resume();
    } catch {
      return null;
    }
  }

  return audioCtx;
}

/**
 * Ultra-crisp 18ms high-passed mechanical tick (~1800Hz -> 900Hz).
 */
export function playClick(): void {
  const ctx = ensureUnlockedAudioContext();
  if (!ctx || ctx.state !== "running") return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.018);

  filter.type = "highpass";
  filter.frequency.setValueAtTime(750, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.045, now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.02);
}

/**
 * Feather-light 8ms micro-tick (gain 0.025, throttled >= 90ms).
 */
export function playHoverTick(): void {
  const perfNow = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (perfNow - lastHoverTickAt < 90) return;
  lastHoverTickAt = perfNow;

  const ctx = ensureUnlockedAudioContext();
  if (!ctx || ctx.state !== "running") return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(2200, now);
  osc.frequency.exponentialRampToValueAtTime(1400, now + 0.008);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.025, now + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.008);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.01);
}

/**
 * Clean 2-step muted harmonic lock chime (520Hz -> 780Hz, 110ms total).
 */
export function playAirgapLock(): void {
  const ctx = ensureUnlockedAudioContext();
  if (!ctx || ctx.state !== "running") return;

  const now = ctx.currentTime;

  const playNote = (freq: number, startOffset: number, duration: number, peakGain: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + startOffset);

    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.linearRampToValueAtTime(peakGain, now + startOffset + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.005);
  };

  playNote(520, 0, 0.055, 0.055);
  playNote(780, 0.042, 0.068, 0.06);
}

/**
 * Installs a single delegated capture-phase pointerdown listener and keydown unlocker.
 */
export function installGlobalClickSfx(): () => void {
  if (typeof document === "undefined") return () => {};

  const onPointerDown = (ev: PointerEvent) => {
    ensureUnlockedAudioContext();
    const target = ev.target as Element | null;
    if (!target) return;
    const clickable = target.closest('button, a, [role="tab"], [role="button"]');
    if (clickable && !(clickable as HTMLButtonElement).disabled) {
      playClick();
    }
  };

  const onKeyDown = () => {
    ensureUnlockedAudioContext();
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
