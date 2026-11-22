const MENU_ID = "localfirst-triage-selection";
const CAPTURE_STORAGE_KEY = "pendingCapture";

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

  await chrome.storage.session.set({
    [CAPTURE_STORAGE_KEY]: {
      title: tab?.title ? `Capture (${sourceHost}): ${tab.title.slice(0, 60)}` : `Capture (${sourceHost})`,
      rawText: info.selectionText,
      capturedAt: Date.now(),
    },
  });

  await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
  await chrome.action.setBadgeText({ text: "1" });

  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CLEAR_BADGE") {
    (async () => {
      await chrome.action.setBadgeText({ text: "" });
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});
