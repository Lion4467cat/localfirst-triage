import {
  buildSanitizedHandoffUrl,
  runExtensionNanoScan,
  TEXT_ONLY_OPTIONS,
} from "./firewall-core.js";

const CAPTURE_STORAGE_KEY = "pendingCapture";

const nanoBadge = document.getElementById("nano-badge");
const titleInput = document.getElementById("ticket-title");
const rawInput = document.getElementById("raw-input");
const scanStats = document.getElementById("scan-stats");
const sanitizedOutput = document.getElementById("sanitized-output");
const captureBtn = document.getElementById("btn-capture-tab");
const scanBtn = document.getElementById("btn-run-firewall");
const copyBtn = document.getElementById("btn-copy");
const handoffBtn = document.getElementById("btn-handoff");

let lastSanitizedText = "";

async function refreshNanoStatus() {
  if (!globalThis.LanguageModel?.availability) {
    nanoBadge.textContent = "Nano: Unavailable (Guard Active)";
    return;
  }
  try {
    const avail = await globalThis.LanguageModel.availability(TEXT_ONLY_OPTIONS);
    nanoBadge.textContent = `Nano 4: ${avail}`;
  } catch {
    nanoBadge.textContent = "Nano: Unavailable";
  }
}

async function runFirewall() {
  const raw = rawInput.value;
  if (!raw.trim()) return;
  scanStats.textContent = "Running on-device privacy firewall...";
  const res = await runExtensionNanoScan(raw);
  lastSanitizedText = res.sanitizedText;
  sanitizedOutput.textContent = res.sanitizedText;
  const detectors = [...new Set(res.mergedSpans.map((s) => s.detector))].join(", ") || "Clean";
  scanStats.textContent = `${res.nanoActive ? "ON_DEVICE (Nano 4)" : "REGEX+HEURISTIC"} · ${res.mergedSpans.length} span(s) redacted [${detectors}]`;
  copyBtn.disabled = false;
  handoffBtn.disabled = false;
}

async function loadPendingCapture() {
  const stored = await chrome.storage.session.get(CAPTURE_STORAGE_KEY);
  const capture = stored?.[CAPTURE_STORAGE_KEY];
  if (capture?.rawText) {
    titleInput.value = capture.title || "Captured Selection";
    rawInput.value = capture.rawText;
    await chrome.storage.session.remove(CAPTURE_STORAGE_KEY);
    await chrome.runtime.sendMessage({ type: "CLEAR_BADGE" });
    await runFirewall();
  }
}

captureBtn.addEventListener("click", async () => {
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
      "Tab capture blocked for this origin (only GitHub/Jira/Zendesk/PagerDuty/Linear permitted). Right-click selected text instead.";
  }
});

scanBtn.addEventListener("click", () => {
  void runFirewall();
});

copyBtn.addEventListener("click", async () => {
  if (!lastSanitizedText) return;
  await navigator.clipboard.writeText(lastSanitizedText);
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    copyBtn.textContent = "Copy Sanitized";
  }, 1500);
});

handoffBtn.addEventListener("click", async () => {
  if (!lastSanitizedText) return;
  // Strictly transmit sanitized payload ONLY — raw PII never crosses to the web workbench
  const url = buildSanitizedHandoffUrl(titleInput.value || "Extension Capture", lastSanitizedText);
  await chrome.tabs.create({ url });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[CAPTURE_STORAGE_KEY]?.newValue) {
    void loadPendingCapture();
  }
});

void refreshNanoStatus();
void loadPendingCapture();
