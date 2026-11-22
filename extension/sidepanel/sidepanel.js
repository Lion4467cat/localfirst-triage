import {
  buildSanitizedHandoffUrl,
  runExtensionNanoScan,
  TEXT_ONLY_OPTIONS,
} from "./firewall-core.js";

const CAPTURE_STORAGE_KEY = "pendingCapture";
const THEME_STORAGE_KEY = "localfirst-theme";
const SFX_STORAGE_KEY = "cordon_sfx_enabled";
const SETUP_STATE_KEY = "cordon_ext_setup_state";
const SHIELD_ENABLED_KEY = "shieldEnabled";
const SHIELD_STATS_KEY = "shieldStats";
const PROTECTION_LEVEL_KEY = "protectionLevel";
const WORKBENCH_TARGET_KEY = "workbenchTarget";
const WORKBENCH_URLS = {
  production: "https://para-1-2e22b.web.app/",
  local: "http://localhost:4173/",
};

const PROTECTED_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "github.com",
  "app.slack.com",
  "localhost",
  "127.0.0.1",
]);

const LEVEL_CAPABILITIES = {
  low: {
    tag: "Secrets Only",
    text: "API Keys · JWTs · Private Keys · DB URIs · Gov IDs · Credit Cards · Strict Entropy (>= 3.8) · Paste Guard Only",
  },
  medium: {
    tag: "Balanced · Default",
    text: "+ Phones · Emails · Multi-Segment Addresses/PINs · Names · Employers · Labeled Secrets (>= 3.25) · Paste + Send-Button/Enter Guard",
  },
  high: {
    tag: "Strict Zero-Trust",
    text: "+ On-Device Gemini Nano 4 Semantic Check on Send (unstructured medical, family, M&A PII) · Tight Entropy (>= 2.9) · Strict Lockdown",
  },
};

const nanoBadge = document.getElementById("nano-badge");
const setupGate = document.getElementById("setup-gate");
const setupModelStatus = document.getElementById("setup-model-status");
const setupReadyView = document.getElementById("setup-ready-view");
const setupNeedsAiView = document.getElementById("setup-needs-ai-view");
const setupEnterBtn = document.getElementById("btn-setup-enter");
const setupModelFeedback = document.getElementById("setup-model-feedback");
const setupVerifyBtn = document.getElementById("btn-setup-verify");
const setupSkipBtn = document.getElementById("btn-setup-skip");
const setupDetWarning = document.getElementById("setup-deterministic-warning");
const setupConfirmDetBtn = document.getElementById("btn-setup-confirm-det");
const openSetupBtn = document.getElementById("btn-open-setup");
const setupOpenButtons = Array.from(document.querySelectorAll("[data-open-url]"));
const sfxToggleBtn = document.getElementById("btn-sfx-toggle");
const sfxToggleLabel = document.getElementById("sfx-toggle-label");
const shieldToggleBtn = document.getElementById("btn-shield-toggle");
const shieldToggleLabel = document.getElementById("shield-toggle-label");
const tabStatusPill = document.getElementById("tab-status-pill");
const tabStatusText = document.getElementById("tab-status-text");
const tabStatusHint = document.getElementById("tab-status-hint");
const armTabBtn = document.getElementById("btn-arm-tab");
const statBlockedPastes = document.getElementById("stat-blocked-pastes");
const statSecretsBlocked = document.getElementById("stat-secrets-blocked");
const resetStatsBtn = document.getElementById("btn-reset-stats");
const workbenchTargetSelect = document.getElementById("workbench-target");
const levelButtons = Array.from(document.querySelectorAll("[data-level-choice]"));
const levelModeTag = document.getElementById("level-mode-tag");
const levelCapabilityText = document.getElementById("level-capability-text");
const manualDrawer = document.getElementById("manual-drawer");
const titleInput = document.getElementById("ticket-title");
const rawInput = document.getElementById("raw-input");
const scanStats = document.getElementById("scan-stats");
const sanitizedOutput = document.getElementById("sanitized-output");
const captureBtn = document.getElementById("btn-capture-tab");
const scanBtn = document.getElementById("btn-run-firewall");
const copyBtn = document.getElementById("btn-copy");
const handoffBtn = document.getElementById("btn-handoff");
const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));

let activeProtectionLevel = "medium";
let activeTabId = null;
let lastSanitizedText = "";
let sfxAudioCtx = null;
let sfxEnabled = true;

try {
  sfxEnabled = window.localStorage.getItem(SFX_STORAGE_KEY) !== "false";
} catch {
  sfxEnabled = true;
}

function getSfxCtx() {
  if (!sfxEnabled || typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sfxAudioCtx) {
    try { sfxAudioCtx = new Ctor(); } catch { return null; }
  }
  if (sfxAudioCtx.state === "suspended") {
    try { void sfxAudioCtx.resume(); } catch { return null; }
  }
  return sfxAudioCtx;
}

function playPanelClick() {
  const ctx = getSfxCtx();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(950, now);
  osc.frequency.exponentialRampToValueAtTime(320, now + 0.028);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.032);
}

function playPanelLock() {
  const ctx = getSfxCtx();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (const [freq, offset, dur] of [[540, 0, 0.055], [810, 0.045, 0.07]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.linearRampToValueAtTime(0.08, now + offset + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + dur + 0.005);
  }
}

function renderSfxState(enabled) {
  sfxEnabled = enabled;
  if (!sfxToggleBtn || !sfxToggleLabel) return;
  sfxToggleBtn.setAttribute("aria-pressed", String(enabled));
  sfxToggleBtn.title = enabled ? "UI sound effects: On" : "UI sound effects: Off";
  sfxToggleLabel.textContent = enabled ? "SFX" : "MUTE";
}

document.addEventListener("pointerdown", (ev) => {
  const target = ev.target instanceof Element ? ev.target.closest("button, summary, select") : null;
  if (target && !target.disabled) playPanelClick();
}, { capture: true, passive: true });

function readThemePreference() {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    return "system";
  }
  return "system";
}

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(pref, persist = true) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", pref);
  root.style.colorScheme = resolved;
  root.classList.toggle("dark", resolved === "dark");

  for (const btn of themeButtons) {
    btn.setAttribute("aria-pressed", String(btn.getAttribute("data-theme-choice") === pref));
  }

  if (persist) {
    try {
      if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch { /* ignore */ }
  }
}

function setupThemeSwitcher() {
  applyTheme(readThemePreference(), false);
  for (const btn of themeButtons) {
    btn.addEventListener("click", () => applyTheme(btn.getAttribute("data-theme-choice") || "system", true));
  }
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (readThemePreference() === "system") applyTheme("system", false);
  });
}

function syncSetupModeView(avail) {
  const ready = avail === "readily" || avail === "available";
  if (setupReadyView) setupReadyView.hidden = !ready;
  if (setupNeedsAiView) setupNeedsAiView.hidden = ready;
}

async function refreshNanoStatus() {
  if (!globalThis.LanguageModel?.availability) {
    nanoBadge.textContent = "Deterministic Mode";
    if (setupModelStatus) setupModelStatus.textContent = "Not Enabled";
    syncSetupModeView("unavailable");
    return "unavailable";
  }
  try {
    const avail = await globalThis.LanguageModel.availability(TEXT_ONLY_OPTIONS);
    if (avail === "readily" || avail === "available") {
      nanoBadge.textContent = "Nano 4 Ready";
      if (setupModelStatus) setupModelStatus.textContent = "Ready";
    } else if (avail === "downloadable" || avail === "downloading" || avail === "after-download") {
      nanoBadge.textContent = "Nano 4 Downloadable";
      if (setupModelStatus) setupModelStatus.textContent = "Downloadable";
    } else {
      nanoBadge.textContent = "Deterministic Mode";
      if (setupModelStatus) setupModelStatus.textContent = "Not Enabled";
    }
    syncSetupModeView(avail);
    return avail;
  } catch {
    nanoBadge.textContent = "Deterministic Mode";
    if (setupModelStatus) setupModelStatus.textContent = "Not Enabled";
    syncSetupModeView("unavailable");
    return "unavailable";
  }
}

async function initSetupGate() {
  let state = null;
  try {
    state = window.localStorage.getItem(SETUP_STATE_KEY);
  } catch { /* ignore */ }
  if (!state && typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const res = await chrome.storage.local.get([SETUP_STATE_KEY]);
      state = res?.[SETUP_STATE_KEY] || null;
    } catch { /* ignore */ }
  }
  if (setupGate) {
    setupGate.hidden = Boolean(state);
  }
}

async function persistSetupState(nextState) {
  try { window.localStorage.setItem(SETUP_STATE_KEY, nextState); } catch { /* ignore */ }
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [SETUP_STATE_KEY]: nextState });
    }
  } catch { /* ignore */ }
  if (setupGate) setupGate.hidden = true;
  if (setupDetWarning) setupDetWarning.hidden = true;
}

openSetupBtn?.addEventListener("click", () => {
  if (!setupGate) return;
  setupGate.hidden = !setupGate.hidden;
  if (!setupGate.hidden) {
    if (setupDetWarning) setupDetWarning.hidden = true;
    void refreshNanoStatus();
  }
});

setupEnterBtn?.addEventListener("click", async () => {
  playPanelLock();
  await persistSetupState("completed");
});

setupVerifyBtn?.addEventListener("click", async () => {
  if (setupModelFeedback) {
    setupModelFeedback.hidden = false;
    setupModelFeedback.textContent = "Checking on-device model…";
  }
  let avail = await refreshNanoStatus();
  if ((avail === "downloadable" || avail === "after-download") && globalThis.LanguageModel?.create) {
    if (setupModelFeedback) setupModelFeedback.textContent = "Downloading on-device model…";
    try {
      const session = await globalThis.LanguageModel.create(TEXT_ONLY_OPTIONS);
      session?.destroy?.();
      avail = await refreshNanoStatus();
    } catch {
      avail = await refreshNanoStatus();
    }
  }
  if (avail === "readily" || avail === "available") {
    playPanelLock();
    await persistSetupState("completed");
    return;
  }
  if (setupModelFeedback) {
    setupModelFeedback.hidden = false;
    setupModelFeedback.textContent =
      "Model not enabled yet — set both flags above & relaunch Chrome, or Skip below.";
  }
});

for (const btn of setupOpenButtons) {
  btn.addEventListener("click", async (ev) => {
    const url = btn.getAttribute("data-open-url");
    if (!url) return;
    ev.preventDefault();

    let opened = false;
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      try {
        await chrome.tabs.create({ url, active: true });
        opened = true;
      } catch {
        opened = false;
      }
    }

    if (!opened && url.startsWith("chrome://")) {
      try {
        await navigator.clipboard.writeText(url);
      } catch { /* ignore */ }
      if (setupModelFeedback) {
        setupModelFeedback.hidden = false;
        setupModelFeedback.textContent = `Copied ${url} — paste in Chrome address bar.`;
      }
    }
  });
}

setupSkipBtn?.addEventListener("click", () => {
  if (setupDetWarning) setupDetWarning.hidden = false;
});

setupConfirmDetBtn?.addEventListener("click", async () => {
  await persistSetupState("deterministic");
});

function setTabPillState(kind, label, showArm = false, showHint = false) {
  tabStatusPill.className = `tab-pill ${kind}`;
  tabStatusText.textContent = label;
  armTabBtn.hidden = !showArm;
  tabStatusHint.hidden = !showHint;
}

async function refreshActiveTabStatus() {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    setTabPillState("is-manual", "Manual Mode · preview", false, true);
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
    let host = "browser";
    try {
      if (tab?.url) host = new URL(tab.url).hostname || "browser";
    } catch { /* ignore */ }

    if (tab?.id !== undefined) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: "LOCALFIRST_PING" });
        if (res?.armed) {
          setTabPillState("is-armed", `Protected · ${res.host || host}`, false, false);
          return;
        }
      } catch { /* tab not armed yet */ }
    }

    if (PROTECTED_HOSTS.has(host)) {
      setTabPillState("is-standby", `Standby · ${host}`, true, false);
    } else {
      setTabPillState("is-manual", `Manual Mode · ${host}`, false, true);
    }
  } catch {
    setTabPillState("is-manual", "Manual Mode · browser", false, true);
  }
}

armTabBtn?.addEventListener("click", async () => {
  if (activeTabId === null || typeof chrome === "undefined" || !chrome.scripting?.executeScript) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ["firewall-core.js", "content-shield.js"],
    });
    await refreshActiveTabStatus();
  } catch { /* ignore restricted pages */ }
});

async function runFirewall() {
  const raw = rawInput.value;
  if (!raw.trim()) return;
  scanStats.textContent = "Scrubbing locally on your device…";
  const res = await runExtensionNanoScan(raw);
  lastSanitizedText = res.sanitizedText;
  sanitizedOutput.textContent = res.sanitizedText;
  const count = res.mergedSpans.length;
  const engine = res.nanoActive ? "Nano 4 + Firewall" : "Deterministic Firewall";
  scanStats.textContent =
    count === 0
      ? `Safe (${engine}) · No secrets detected`
      : `Protected (${engine}) · ${count} secret(s) scrubbed`;
  copyBtn.disabled = false;
  handoffBtn.disabled = false;
  if (count > 0) playPanelLock();
}

async function loadPendingCapture() {
  if (typeof chrome === "undefined" || !chrome.storage?.session) return;
  const stored = await chrome.storage.session.get(CAPTURE_STORAGE_KEY);
  const capture = stored?.[CAPTURE_STORAGE_KEY];
  if (capture?.rawText) {
    if (manualDrawer) manualDrawer.open = true;
    titleInput.value = capture.title || "Captured Selection";
    rawInput.value = capture.rawText;
    await chrome.storage.session.remove(CAPTURE_STORAGE_KEY);
    await chrome.runtime?.sendMessage?.({ type: "CLEAR_BADGE" });
    await runFirewall();
  }
}

captureBtn?.addEventListener("click", async () => {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    scanStats.textContent = "Paste any text above and click Scrub Locally.";
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const active = document.activeElement;
        if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
          return active.value || "";
        }
        if (active?.isContentEditable) {
          return active.innerText || active.textContent || "";
        }
        const ed = document.querySelector('[contenteditable="true"], [role="textbox"], textarea');
        if (ed) return ed.value || ed.innerText || ed.textContent || "";
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll("script, style, nav, footer").forEach((el) => el.remove());
        return clone.innerText.slice(0, 6000);
      },
    });
    titleInput.value = tab.title || "Active Editor Capture";
    rawInput.value = result || "";
    await runFirewall();
  } catch {
    scanStats.textContent = "Tab capture unavailable on this page. Paste text above to scrub locally.";
  }
});

scanBtn?.addEventListener("click", () => { void runFirewall(); });

copyBtn?.addEventListener("click", async () => {
  if (!lastSanitizedText) return;
  try {
    await navigator.clipboard.writeText(lastSanitizedText);
    copyBtn.textContent = "Copied Safe Text!";
    setTimeout(() => { copyBtn.textContent = "Copy Safe Text"; }, 1500);
  } catch { /* ignore */ }
});

handoffBtn?.addEventListener("click", async () => {
  if (!lastSanitizedText) return;
  const targetKey = workbenchTargetSelect?.value === "local" ? "local" : "production";
  const url = buildSanitizedHandoffUrl(titleInput.value || "Extension Capture", lastSanitizedText, WORKBENCH_URLS[targetKey]);
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

function renderShieldState(enabled) {
  if (!shieldToggleBtn || !shieldToggleLabel) return;
  shieldToggleBtn.setAttribute("aria-checked", String(enabled));
  shieldToggleLabel.textContent = enabled ? "ON" : "OFF";
}

function renderShieldStats(stats) {
  if (statBlockedPastes) statBlockedPastes.textContent = String(stats?.totalBlockedPastes ?? 0);
  if (statSecretsBlocked) statSecretsBlocked.textContent = String(stats?.totalSecretsIntercepted ?? 0);
}

function renderProtectionLevel(level) {
  activeProtectionLevel = level === "low" || level === "high" ? level : "medium";
  for (const btn of levelButtons) {
    btn.setAttribute("aria-pressed", String(btn.getAttribute("data-level-choice") === activeProtectionLevel));
  }
  const meta = LEVEL_CAPABILITIES[activeProtectionLevel];
  if (levelModeTag) levelModeTag.textContent = meta.tag;
  if (levelCapabilityText) levelCapabilityText.textContent = meta.text;
}

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && changes[CAPTURE_STORAGE_KEY]?.newValue) {
      void loadPendingCapture();
    }
    if (areaName === "local") {
      if (changes[SHIELD_ENABLED_KEY]) renderShieldState(changes[SHIELD_ENABLED_KEY].newValue !== false);
      if (changes[SHIELD_STATS_KEY]) renderShieldStats(changes[SHIELD_STATS_KEY].newValue);
      if (changes[PROTECTION_LEVEL_KEY]) renderProtectionLevel(changes[PROTECTION_LEVEL_KEY].newValue);
    }
  });
}

async function initPasteShieldControls() {
  renderProtectionLevel("medium");
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const res = await chrome.storage.local.get([
    SHIELD_ENABLED_KEY,
    SHIELD_STATS_KEY,
    PROTECTION_LEVEL_KEY,
    WORKBENCH_TARGET_KEY,
  ]);
  renderShieldState(typeof res?.[SHIELD_ENABLED_KEY] === "boolean" ? res[SHIELD_ENABLED_KEY] : true);
  renderShieldStats(res?.[SHIELD_STATS_KEY]);
  renderProtectionLevel(res?.[PROTECTION_LEVEL_KEY] || "medium");
  if (workbenchTargetSelect && (res?.[WORKBENCH_TARGET_KEY] === "local" || res?.[WORKBENCH_TARGET_KEY] === "production")) {
    workbenchTargetSelect.value = res[WORKBENCH_TARGET_KEY];
  }

  shieldToggleBtn?.addEventListener("click", async () => {
    const next = !(shieldToggleBtn.getAttribute("aria-checked") !== "false");
    renderShieldState(next);
    await chrome.storage.local.set({ [SHIELD_ENABLED_KEY]: next });
  });

  for (const btn of levelButtons) {
    btn.addEventListener("click", async () => {
      renderProtectionLevel(btn.getAttribute("data-level-choice") || "medium");
      await chrome.storage.local.set({ [PROTECTION_LEVEL_KEY]: activeProtectionLevel });
    });
  }

  resetStatsBtn?.addEventListener("click", async () => {
    const emptyStats = { totalBlockedPastes: 0, totalSecretsIntercepted: 0 };
    renderShieldStats(emptyStats);
    await chrome.storage.local.set({ [SHIELD_STATS_KEY]: emptyStats });
  });

  workbenchTargetSelect?.addEventListener("change", async () => {
    const val = workbenchTargetSelect.value === "local" ? "local" : "production";
    await chrome.storage.local.set({ [WORKBENCH_TARGET_KEY]: val });
  });
}

renderSfxState(sfxEnabled);
sfxToggleBtn?.addEventListener("click", async () => {
  const next = !sfxEnabled;
  renderSfxState(next);
  try { window.localStorage.setItem(SFX_STORAGE_KEY, String(next)); } catch { /* ignore */ }
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [SFX_STORAGE_KEY]: next });
    }
  } catch { /* ignore */ }
  if (next) playPanelClick();
});

setupThemeSwitcher();
void initSetupGate();
void initPasteShieldControls();
void refreshActiveTabStatus();
void refreshNanoStatus();
void loadPendingCapture();
