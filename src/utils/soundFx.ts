const SFX_STORAGE_KEY = "cordon_sfx_enabled";
const CONTROL_SELECTOR =
  'button, a, [role="button"], [role="tab"], input, textarea, select, label, [data-interactive], #localfirst-paste-shield-host';

let audioCtx: AudioContext | null = null;
let sfxEnabledCache: boolean | null = null;
let lastHoverTickAt = 0;
let lastSurfaceTapAt = 0;

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

function ensureUnlockedAudioContext(onUnlocked?: (ctx: AudioContext) => void): AudioContext | null {
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
      const p = audioCtx.resume();
      if (onUnlocked && p && typeof p.then === "function") {
        void p.then(() => {
          if (audioCtx && audioCtx.state === "running") {
            onUnlocked(audioCtx);
          }
        });
      }
    } catch {
      return null;
    }
  }

  return audioCtx;
}

function triggerControlClickOnCtx(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(950, now);
  osc.frequency.exponentialRampToValueAtTime(320, now + 0.032);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1100, now);
  filter.Q.setValueAtTime(1.1, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.036);
}

function triggerSurfaceTapOnCtx(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(230, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.03);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(420, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.055, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.034);
}

/**
 * Crisp ~32ms mechanical switch click (950Hz -> 320Hz, 0.12 peak gain).
 */
export function playClick(): void {
  const ctx = ensureUnlockedAudioContext((unlocked) => triggerControlClickOnCtx(unlocked));
  if (!ctx || ctx.state !== "running") return;
  triggerControlClickOnCtx(ctx);
}

/**
 * Softer, muted low-end surface tap (~230Hz -> 110Hz through ~420Hz low-pass, 0.055 gain, >= 75ms throttle).
 */
export function playSurfaceTap(): void {
  const perfNow = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (perfNow - lastSurfaceTapAt < 75) return;
  lastSurfaceTapAt = perfNow;

  const ctx = ensureUnlockedAudioContext((unlocked) => triggerSurfaceTapOnCtx(unlocked));
  if (!ctx || ctx.state !== "running") return;
  triggerSurfaceTapOnCtx(ctx);
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
 * Clean 120ms two-tone confirmation chime (540Hz -> 810Hz, 0.11 gain).
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

  playNote(540, 0, 0.06, 0.1);
  playNote(810, 0.048, 0.072, 0.11);
}

/**
 * Installs delegated capture-phase gesture listeners for unlocking AudioContext
 * and playing control clicks vs. non-control surface taps.
 */
export function installGlobalClickSfx(): () => void {
  if (typeof document === "undefined") return () => {};

  let lastDownAt = 0;

  const dispatchSoundForTarget = (target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    const control = el?.closest(CONTROL_SELECTOR);
    if (control) {
      if (!(control as HTMLButtonElement).disabled) {
        playClick();
      }
      return;
    }
    playSurfaceTap();
  };

  const onPointerDown = (ev: PointerEvent) => {
    lastDownAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    ensureUnlockedAudioContext();
    dispatchSoundForTarget(ev.target);
  };

  const onMouseDown = () => {
    ensureUnlockedAudioContext();
  };

  const onClickFallback = (ev: MouseEvent) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Only act as a fallback when pointerdown wasn't just processed or ctx wasn't running yet
    if (audioCtx && audioCtx.state !== "running") {
      ensureUnlockedAudioContext(() => dispatchSoundForTarget(ev.target));
      return;
    }
    if (now - lastDownAt > 250) {
      dispatchSoundForTarget(ev.target);
    }
  };

  const onKeyDown = () => {
    ensureUnlockedAudioContext();
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
  document.addEventListener("click", onClickFallback, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("mousedown", onMouseDown, { capture: true });
    document.removeEventListener("click", onClickFallback, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
