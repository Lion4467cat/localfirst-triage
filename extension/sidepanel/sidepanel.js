import {
  buildSanitizedHandoffUrl,
  runExtensionNanoScan,
  TEXT_ONLY_OPTIONS,
} from "./firewall-core.js";

const CAPTURE_STORAGE_KEY = "pendingCapture";
const THEME_STORAGE_KEY = "localfirst-theme";
const SHIELD_ENABLED_KEY = "shieldEnabled";
const SHIELD_STATS_KEY = "shieldStats";

const nanoBadge = document.getElementById("nano-badge");
const shieldToggleBtn = document.getElementById("btn-shield-toggle");
const shieldToggleLabel = document.getElementById("shield-toggle-label");
const statBlockedPastes = document.getElementById("stat-blocked-pastes");
const statSecretsBlocked = document.getElementById("stat-secrets-blocked");
const titleInput = document.getElementById("ticket-title");
const rawInput = document.getElementById("raw-input");
const scanStats = document.getElementById("scan-stats");
const sanitizedOutput = document.getElementById("sanitized-output");
const captureBtn = document.getElementById("btn-capture-tab");
const scanBtn = document.getElementById("btn-run-firewall");
const copyBtn = document.getElementById("btn-copy");
const handoffBtn = document.getElementById("btn-handoff");
const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));

let lastSanitizedText = "";

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
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
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
    const choice = btn.getAttribute("data-theme-choice");
    btn.setAttribute("aria-pressed", String(choice === pref));
  }

  if (persist) {
    try {
      if (pref === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, pref);
      }
    } catch {
      // Ignore storage access errors
    }
  }
}

function setupThemeSwitcher() {
  applyTheme(readThemePreference(), false);

  for (const btn of themeButtons) {
    btn.addEventListener("click", () => {
      const choice = btn.getAttribute("data-theme-choice") || "system";
      applyTheme(choice, true);
    });
  }

  if (typeof window.matchMedia === "function") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener?.("change", () => {
      if (readThemePreference() === "system") {
        applyTheme("system", false);
      }
    });
  }
}

async function refreshNanoStatus() {
  if (!globalThis.LanguageModel?.availability) {
    nanoBadge.textContent = "Local Privacy Guard Active";
    return;
  }
  try {
    const avail = await globalThis.LanguageModel.availability(TEXT_ONLY_OPTIONS);
    if (avail === "readily" || avail === "available") {
      nanoBadge.textContent = "On-Device Nano 4 Ready";
    } else if (avail === "downloadable" || avail === "downloading" || avail === "after-download") {
      nanoBadge.textContent = "Nano 4 Downloadable (Local Guard Active)";
    } else {
      nanoBadge.textContent = "Local Privacy Guard Active";
    }
  } catch {
    nanoBadge.textContent = "Local Privacy Guard Active";
  }
}

async function runFirewall() {
  const raw = rawInput.value;
  if (!raw.trim()) return;
  scanStats.textContent = "Checking for secrets on your device...";
  const res = await runExtensionNanoScan(raw);
  lastSanitizedText = res.sanitizedText;
  sanitizedOutput.textContent = res.sanitizedText;
  const count = res.mergedSpans.length;
  const engine = res.nanoActive ? "On-Device Nano 4" : "Local Pattern Firewall";
  scanStats.textContent =
    count === 0
      ? `Protected (${engine}) · No secrets detected`
      : `Protected (${engine}) · ${count} secret(s) hidden from AI`;
  copyBtn.disabled = false;
  handoffBtn.disabled = false;
}

async function loadPendingCapture() {
  if (typeof chrome === "undefined" || !chrome.storage?.session) return;
  const stored = await chrome.storage.session.get(CAPTURE_STORAGE_KEY);
  const capture = stored?.[CAPTURE_STORAGE_KEY];
  if (capture?.rawText) {
    titleInput.value = capture.title || "Captured Selection";
    rawInput.value = capture.rawText;
    await chrome.storage.session.remove(CAPTURE_STORAGE_KEY);
    await chrome.runtime?.sendMessage?.({ type: "CLEAR_BADGE" });
    await runFirewall();
  }
}

captureBtn.addEventListener("click", async () => {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    scanStats.textContent = "Paste any ticket text above and click Mask Secrets Locally.";
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll("script, style, nav, footer").forEach((el) => el.remove());
        return clone.innerText.slice(0, 6000);
      },
    });
    titleInput.value = tab.title || "Active Tab Ticket";
    rawInput.value = result || "";
    await runFirewall();
  } catch {
    scanStats.textContent =
      "Tab capture is limited to supported issue trackers. Right-click selected text to import from any page.";
  }
});

scanBtn.addEventListener("click", () => {
  void runFirewall();
});

copyBtn.addEventListener("click", async () => {
  if (!lastSanitizedText) return;
  try {
    await navigator.clipboard.writeText(lastSanitizedText);
    copyBtn.textContent = "Copied Safe Text!";
    setTimeout(() => {
      copyBtn.textContent = "Copy Safe Text";
    }, 1500);
  } catch {
    // Ignore clipboard error
  }
});

handoffBtn.addEventListener("click", async () => {
  if (!lastSanitizedText) return;
  // Strictly transmit sanitized payload ONLY — raw PII never crosses to the web workbench
  const url = buildSanitizedHandoffUrl(titleInput.value || "Extension Capture", lastSanitizedText);
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && changes[CAPTURE_STORAGE_KEY]?.newValue) {
      void loadPendingCapture();
    }
    if (areaName === "local") {
      if (changes[SHIELD_ENABLED_KEY]) {
        renderShieldState(changes[SHIELD_ENABLED_KEY].newValue !== false);
      }
      if (changes[SHIELD_STATS_KEY]) {
        renderShieldStats(changes[SHIELD_STATS_KEY].newValue);
      }
    }
  });
}

function renderShieldState(enabled) {
  if (!shieldToggleBtn || !shieldToggleLabel) return;
  shieldToggleBtn.setAttribute("aria-checked", String(enabled));
  shieldToggleLabel.textContent = `Live Paste Protection: ${enabled ? "ON" : "OFF"}`;
}

function renderShieldStats(stats) {
  if (statBlockedPastes) {
    statBlockedPastes.textContent = String(stats?.totalBlockedPastes ?? 0);
  }
  if (statSecretsBlocked) {
    statSecretsBlocked.textContent = String(stats?.totalSecretsIntercepted ?? 0);
  }
}

async function initPasteShieldControls() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const res = await chrome.storage.local.get([SHIELD_ENABLED_KEY, SHIELD_STATS_KEY]);
  const enabled = typeof res?.[SHIELD_ENABLED_KEY] === "boolean" ? res[SHIELD_ENABLED_KEY] : true;
  renderShieldState(enabled);
  renderShieldStats(res?.[SHIELD_STATS_KEY]);

  shieldToggleBtn?.addEventListener("click", async () => {
    const current = shieldToggleBtn.getAttribute("aria-checked") !== "false";
    const next = !current;
    renderShieldState(next);
    await chrome.storage.local.set({ [SHIELD_ENABLED_KEY]: next });
  });
}

setupThemeSwitcher();
void initPasteShieldControls();
void refreshNanoStatus();
void loadPendingCapture();
