const MENU_ID = "localfirst-triage-selection";

// Zero-PII: the raw selection lives in service-worker memory only and is handed
// to the side panel exactly once. Nothing raw is ever written to chrome.storage.
let pendingCapture = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Sanitize & Triage with Cordon",
    contexts: ["selection"],
  });

  // Auto-inject content shield into already-open protected tabs on install/reload
  const protectedUrlPatterns = [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://github.com/*",
    "https://app.slack.com/*",
    "https://discord.com/*",
    "https://www.perplexity.ai/*",
    "https://perplexity.ai/*",
    "http://localhost/*",
  ];
  try {
    const tabs = await chrome.tabs.query({ url: protectedUrlPatterns });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["firewall-core.js", "content-shield.js"],
        });
      } catch {
        // Ignore tabs that disallow script injection
      }
    }
  } catch {
    // Ignore if tabs query is restricted
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  let sourceHost = "Selected Page";
  try {
    if (tab?.url) {
      sourceHost = new URL(tab.url).hostname;
    }
  } catch {
    // Fallback to generic label
  }

  pendingCapture = {
    title: tab?.title ? `Capture (${sourceHost}): ${tab.title.slice(0, 60)}` : `Capture (${sourceHost})`,
    rawText: info.selectionText,
    capturedAt: Date.now(),
  };

  await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
  await chrome.action.setBadgeText({ text: "1" });

  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }

  // Nudge an already-open side panel to pull the in-memory capture.
  try {
    await chrome.runtime.sendMessage({ type: "CAPTURE_READY" });
  } catch {
    // No open side panel listening; it will pull on next open.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_CAPTURE") {
    const capture = pendingCapture;
    pendingCapture = null;
    sendResponse({ capture });
    return false;
  }
  if (message?.type === "CLEAR_BADGE") {
    (async () => {
      await chrome.action.setBadgeText({ text: "" });
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});
