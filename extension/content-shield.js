(function () {
  "use strict";

  // Clean up prior window listeners if re-injected into the same frame/test harness.
  if (typeof globalThis.__cordonShieldCleanup === "function") {
    try {
      globalThis.__cordonShieldCleanup();
    } catch {
      // Ignore stale cleanup failures.
    }
  }

  const ID =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function stampRoot() {
    if (document.documentElement) {
      document.documentElement.dataset.lfShieldId = ID;
      document.documentElement.dataset.localfirstShield = "armed";
    }
  }
  stampRoot();
  if (!document.documentElement) {
    window.addEventListener("DOMContentLoaded", stampRoot, { capture: true, once: true });
  }

  const HOST_ID = "localfirst-paste-shield-host";
  const SEND_SEL = [
    'button[data-testid*="send" i]',
    '[role="button"][data-testid*="send" i]',
    'button[data-testid*="search" i]',
    '[role="button"][data-testid*="search" i]',
    'button[aria-label*="send" i]',
    '[role="button"][aria-label*="send" i]',
    'button[aria-label*="search" i]',
    '[role="button"][aria-label*="search" i]',
    'input[aria-label*="search" i][type="submit"]',
    'button[aria-label*="submit" i]',
    '[role="button"][aria-label*="submit" i]',
    "button.send-button",
    'button[mattooltip*="send" i]',
    'button[data-qa="texty_send_button"]',
    'button[type="submit"]',
    'input[type="submit"]',
    '[role="option"]',
  ].join(", ");

  const EDITOR_QUERY =
    'textarea, input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="reset"]):not([type="range"]):not([type="color"]), [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"], [role="searchbox"]';

  const ALLOWED_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);
  const CHAT_OR_SEARCH_HOSTS = new Set([
    "www.google.com",
    "google.com",
    "www.google.co.in",
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "www.perplexity.ai",
    "perplexity.ai",
    "discord.com",
    "app.slack.com",
  ]);

  // Default shieldEnabled = true synchronously (fail-closed) before async chrome.storage resolves.
  let shieldEnabled = true,
    protectionLevel = "medium",
    mutedUntil = 0,
    mutedTarget = null,
    lastEditor = null;
  let scanEpoch = 0,
    hudHost = null,
    hudShadow = null;
  let composing = false,
    lastSendPointer = null,
    scrubInFlight = false,
    lastShiftEnterAt = 0;
  let recentPaste = { target: null, text: "", at: 0 };
  let lastLiveSnapshot = { target: null, text: "", at: 0 };
  const editorSnapshots = new WeakMap();
  let hudState = {
    mode: "HIDDEN",
    target: null,
    savedSel: null,
    rawText: "",
    scan: null,
    bypassArmed: false,
    sendBtn: null,
    scrubbedText: "",
  };
  let lastCleanNorm = "",
    lastDismissedNorm = "",
    lastBypassedNorm = "";

  // Only long enough to swallow the synthetic input event our own DOM write emits.
  const MUTE_MS = 250;
  // Time for the host framework to reconcile before we trust the editor contents.
  const VERIFY_MS = 120;
  // Captures sub-50ms paste-then-Enter/Send before async rich-text editors commit clipboard text to DOM.
  const RECENT_PASTE_MS = 150;
  // Preserves live typed text when a site script clears `.value = ''` on mousedown/keydown before click/submit.
  const SNAPSHOT_TTL_MS = 1200;

  const isAlive = () => !document.documentElement || document.documentElement.dataset.lfShieldId === ID;
  const isNodeConnected = (el) => Boolean(el && (el.isConnected ?? document.contains(el)));
  const isMuted = (ed) => ed && mutedTarget === ed && Date.now() < mutedUntil;
  const normalize = (s) => (s || "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  const hasExt = () => typeof chrome !== "undefined" && Boolean(chrome.runtime?.id && chrome.storage?.local);
  const isOwnHudEvent = (ev) =>
    Boolean(
      hudHost &&
        (ev.composedPath?.().includes(hudHost) || ev.target === hudHost || ev.target?.id === HOST_ID),
    );

  function blockEventSync(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  }

  function loadSettings() {
    if (!hasExt()) return;
    try {
      chrome.storage.local.get(["shieldEnabled", "protectionLevel"], (r) => {
        if (!isAlive()) return;
        if (typeof r?.shieldEnabled === "boolean") shieldEnabled = r.shieldEnabled;
        if (["low", "medium", "high"].includes(r?.protectionLevel)) protectionLevel = r.protectionLevel;
      });
      chrome.storage.onChanged.addListener((c, area) => {
        if (!isAlive() || area !== "local") return;
        if (typeof c.shieldEnabled?.newValue === "boolean") shieldEnabled = c.shieldEnabled.newValue;
        if (["low", "medium", "high"].includes(c.protectionLevel?.newValue)) {
          protectionLevel = c.protectionLevel.newValue;
        }
      });
    } catch (err) {
      console.warn("[Cordon] settings unavailable, keeping defaults:", err?.message);
    }
  }

  function recordStats(count) {
    if (!hasExt() || !count) return;
    try {
      chrome.storage.local.get(["shieldStats"], (r) => {
        if (!isAlive()) return;
        const p = r?.shieldStats || {};
        chrome.storage.local.set({
          shieldStats: {
            totalBlockedPastes: (p.totalBlockedPastes || 0) + 1,
            totalSecretsIntercepted: (p.totalSecretsIntercepted || 0) + count,
            lastSiteHost: location.hostname || "localhost",
            lastBlockedAt: new Date().toISOString(),
          },
        });
      });
    } catch (err) {
      console.warn("[Cordon] stats write failed:", err?.message);
    }
  }

  function isContentEditableNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const attr = el.getAttribute?.("contenteditable");
    return attr === "" || attr === "true" || attr === "plaintext-only";
  }

  function findEditor(node) {
    const el = node?.nodeType === 3 ? node.parentElement : node;
    if (!el || typeof el.closest !== "function") return null;
    const inp = el.closest("textarea, input");
    if (inp) {
      const t = (inp.getAttribute("type") || "text").toLowerCase();
      if (inp.tagName === "TEXTAREA" || ALLOWED_INPUT_TYPES.has(t)) return inp;
      return null;
    }
    if (isContentEditableNode(el)) {
      let root = el;
      while (root.parentElement && isContentEditableNode(root.parentElement)) {
        root = root.parentElement;
      }
      return root;
    }
    const ce = el.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    if (ce) return ce;
    const ariaBox = el.closest('[role="textbox"], [role="combobox"], [role="searchbox"]');
    if (ariaBox) {
      // Wrapper comboboxes (e.g. Google Search) often wrap a real <textarea> or <input>.
      const inner = ariaBox.querySelector?.("textarea, input, [contenteditable='true'], [contenteditable='plaintext-only']");
      if (inner) {
        const innerResolved = findEditor(inner);
        if (innerResolved) return innerResolved;
      }
      return ariaBox;
    }
    return null;
  }

  function getDeepActiveElement(rootNode = document) {
    let active = rootNode?.activeElement || null;
    const visited = new Set();
    while (active && active.shadowRoot && active.shadowRoot.activeElement && !visited.has(active)) {
      visited.add(active);
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function findEditorInContainer(container) {
    if (!container || typeof container.querySelectorAll !== "function") return null;
    const candidates = Array.from(container.querySelectorAll(EDITOR_QUERY));
    for (const c of candidates) {
      const ed = findEditor(c);
      if (ed && normalize(effectiveEditorText(ed))) return ed;
    }
    for (const c of candidates) {
      const ed = findEditor(c);
      if (ed) return ed;
    }
    return null;
  }

  function resolveEditor(evOrNode) {
    if (evOrNode?.composedPath) {
      const path = evOrNode.composedPath();
      for (const n of path) {
        const ed = findEditor(n);
        if (ed) return ed;
      }
      // Check form / search container or ShadowRoot along composedPath
      for (const n of path) {
        if (n?.tagName === "FORM" || n?.getAttribute?.("role") === "search" || n instanceof ShadowRoot) {
          const inContainer = findEditorInContainer(n);
          if (inContainer) return inContainer;
        }
      }
    }
    const direct = findEditor(evOrNode?.target ?? evOrNode);
    if (direct) return direct;
    const deepActive = findEditor(getDeepActiveElement());
    if (deepActive) return deepActive;
    if (lastEditor && isNodeConnected(lastEditor)) return lastEditor;
    return null;
  }

  const readEditorText = (ed) =>
    !ed
      ? ""
      : ed.tagName === "TEXTAREA" || ed.tagName === "INPUT"
        ? ed.value || ""
        : ed.innerText || ed.textContent || "";

  function snapshotEditor(ed, allowEmptyClear = false) {
    if (!ed) return;
    lastEditor = ed;
    const raw = readEditorText(ed);
    if (raw && raw.trim()) {
      const snap = { text: raw, at: Date.now() };
      editorSnapshots.set(ed, snap);
      lastLiveSnapshot = { target: ed, text: raw, at: snap.at };
    } else if (allowEmptyClear) {
      editorSnapshots.delete(ed);
      if (lastLiveSnapshot.target === ed) {
        lastLiveSnapshot = { target: null, text: "", at: 0 };
      }
    }
  }

  function isSingleLineOrSearchField(ed) {
    if (!ed) return false;
    if (ed.tagName === "INPUT") return true;
    const role = (ed.getAttribute?.("role") || "").toLowerCase();
    if (role === "combobox" || role === "searchbox") return true;
    const typeAttr = (ed.getAttribute?.("type") || "").toLowerCase();
    if (typeAttr === "search") return true;
    const nameAttr = (ed.getAttribute?.("name") || "").toLowerCase();
    if (nameAttr === "q" || nameAttr === "query" || nameAttr === "search_query") return true;
    const hintAttr = (ed.getAttribute?.("enterkeyhint") || "").toLowerCase();
    if (hintAttr === "search") return true;
    const form = ed.closest?.("form");
    if (form) {
      const fRole = (form.getAttribute("role") || "").toLowerCase();
      const fAction = (form.getAttribute("action") || "").toLowerCase();
      if (fRole === "search" || fAction.includes("/search")) return true;
    }
    return false;
  }

  function doesTextareaSubmitOnPlainEnter(ed) {
    if (!ed || ed.tagName !== "TEXTAREA") return false;
    if (isSingleLineOrSearchField(ed)) return true;
    const host = (location.hostname || "").toLowerCase();
    if (CHAT_OR_SEARCH_HOSTS.has(host)) return true;
    if (ed.id === "prompt-textarea" || ed.dataset?.composer !== undefined) return true;
    const hint = (ed.getAttribute("enterkeyhint") || "").toLowerCase();
    if (hint === "send" || hint === "go" || hint === "done") return true;
    const descriptor = `${ed.getAttribute("aria-label") || ""} ${ed.getAttribute("placeholder") || ""}`;
    if (/\b(search|ask|message|prompt|chat)\b/i.test(descriptor) && !/\bissue\b/i.test(descriptor)) {
      return true;
    }
    const container = ed.closest("form") || ed.parentElement?.parentElement || ed.parentElement;
    if (
      container?.querySelector?.(
        'button[data-testid*="send" i], button[aria-label*="send" i], button.send-button, button[data-testid*="search" i], button[aria-label*="search" i]',
      )
    ) {
      return true;
    }
    return false;
  }

  function isExplicitSearchOrOptionTrigger(el) {
    if (!el || typeof el.getAttribute !== "function") return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "option") return true;
    const testId = (el.getAttribute("data-testid") || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    const val = (el.getAttribute("value") || "").toLowerCase();
    const txt = (el.textContent || "").trim().toLowerCase();
    if (testId.includes("search") || aria.includes("search") || name === "btnk") return true;
    const isSubmitType =
      (el.tagName === "BUTTON" && (el.getAttribute("type") || "submit").toLowerCase() === "submit") ||
      (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "submit");
    if (isSubmitType && (txt.includes("search") || val.includes("search"))) return true;
    const form = el.closest?.("form");
    if (form) {
      const fRole = (form.getAttribute("role") || "").toLowerCase();
      const fAction = (form.getAttribute("action") || "").toLowerCase();
      if (fRole === "search" || fAction.includes("/search")) return true;
    }
    return false;
  }

  function findActionTriggerInEvent(ev) {
    if (ev?.composedPath) {
      for (const n of ev.composedPath()) {
        if (n?.nodeType === 1 && typeof n.matches === "function") {
          if (n.matches(SEND_SEL)) return n;
          const anc = n.closest?.(SEND_SEL);
          if (anc) return anc;
        }
      }
    }
    const el = ev?.target?.nodeType === 3 ? ev.target.parentElement : ev?.target;
    return el?.closest?.(SEND_SEL) ?? null;
  }

  function firstNonOptionControl(container) {
    if (!container || typeof container.querySelectorAll !== "function") return null;
    for (const el of container.querySelectorAll(SEND_SEL)) {
      if ((el.getAttribute("role") || "").toLowerCase() !== "option") return el;
    }
    return null;
  }

  function findSubmitControlForEditor(ed) {
    const inForm = firstNonOptionControl(ed?.closest?.("form"));
    if (inForm) return inForm;
    let anc = ed?.parentElement || null;
    let depth = 0;
    while (anc && anc !== document.body && anc !== document.documentElement && depth < 6) {
      const near = firstNonOptionControl(anc);
      if (near) return near;
      anc = anc.parentElement;
      depth++;
    }
    const root = ed?.getRootNode?.();
    if (root && root !== document) {
      const inShadow = firstNonOptionControl(root);
      if (inShadow) return inShadow;
    }
    return firstNonOptionControl(document);
  }

  /**
   * Writes `nextText` into the editor and reports whether the write is trustworthy.
   */
  function replaceEntireEditor(ed, nextText, spans) {
    ed.focus?.();
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const proto = ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(ed, nextText);
      else ed.value = nextText;
      ed.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertReplacementText",
          data: nextText,
        }),
      );
      ed.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const before = readEditorText(ed);
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, nextText);
    } catch {
      ok = false;
    }
    const post = normalize(readEditorText(ed));
    const leaked = (spans || []).some((s) => s.matchedText && post.includes(normalize(s.matchedText)));
    if (ok && !leaked && post) return true;
    if (readEditorText(ed) !== before) {
      ed.textContent = before;
      ed.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertReplacementText",
          data: before,
        }),
      );
    }
    return false;
  }

  function insertAtSel(ed, savedSel, text) {
    ed.focus?.();
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const s = savedSel?.kind === "input" ? savedSel.start : ed.value.length;
      const e = savedSel?.kind === "input" ? savedSel.end : ed.value.length;
      const proto = ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const next = ed.value.slice(0, s) + text + ed.value.slice(e);
      if (setter) setter.call(ed, next);
      else ed.value = next;
      try {
        ed.setSelectionRange?.(s + text.length, s + text.length);
      } catch {
        // Non-selectable input types ignore setSelectionRange.
      }
      ed.dispatchEvent(
        new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }),
      );
      ed.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const sel = window.getSelection();
    if (sel && savedSel?.kind === "editable" && savedSel.range) {
      sel.removeAllRanges();
      sel.addRange(savedSel.range);
    }
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      ed.textContent = (ed.textContent || "") + text;
      ed.dispatchEvent(
        new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }),
      );
    }
  }

  function ensureHost() {
    const rootMount = document.documentElement || document.body;
    if (hudHost && rootMount?.contains(hudHost)) return hudHost;
    document.getElementById(HOST_ID)?.remove();
    hudHost = document.createElement("div");
    hudHost.id = HOST_ID;
    hudHost.dataset.lfState = "HIDDEN";
    hudHost.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;pointer-events:auto;";
    hudShadow = hudHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial }
      @keyframes lf-in { from { opacity: 0; transform: translateY(6px) scale(.985) } to { opacity: 1; transform: none } }
      .box {
        display: none;
        background: #0A0C10;
        color: #F8FAFC;
        border: 1px solid rgba(148, 163, 184, .34);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, .72), 0 0 0 1px rgba(0, 0, 0, .45);
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
      }
      .modal { display: block; width: 404px; max-width: calc(100vw - 32px); animation: lf-in .16s cubic-bezier(.23, 1, .32, 1) }
      .accent { height: 3px; background: linear-gradient(90deg, #FF4D5A, #FF8A3D) }
      .body { padding: 13px 14px 14px }
      .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px }
      .title { font-weight: 700; font-size: 13px; letter-spacing: -.01em; color: #F8FAFC }
      .sub { margin-top: 3px; font-size: 11px; color: #97A3B6 }
      .badge {
        flex: none;
        white-space: nowrap;
        font: 700 9.5px ui-monospace, monospace;
        padding: 3px 7px;
        border-radius: 5px;
        border: 1px solid rgba(255, 77, 90, .38);
        background: rgba(255, 77, 90, .15);
        color: #FF7A84;
        letter-spacing: .06em;
      }
      .label { margin-top: 12px; font: 600 9.5px ui-monospace, monospace; letter-spacing: .09em; text-transform: uppercase; color: #7C8AA0 }
      .prev {
        margin-top: 5px;
        padding: 8px 10px;
        background: #11141B;
        border: 1px solid rgba(255, 255, 255, .09);
        border-radius: 8px;
        font: 11px/1.5 ui-monospace, monospace;
        color: #00E5A3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .acts { display: flex; gap: 8px; margin-top: 13px }
      button {
        cursor: pointer;
        border: 1px solid transparent;
        border-radius: 8px;
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        padding: 8px 12px;
        transition: transform .1s ease, opacity .14s ease;
      }
      button:active { transform: scale(.97) }
      button:focus-visible { outline: 2px solid #00E5A3; outline-offset: 2px }
      .pri { background: #00E5A3; color: #07090D; font-weight: 700; padding-inline: 16px }
      .pri:hover { opacity: .92 }
      .gho { background: rgba(255, 255, 255, .07); border-color: rgba(148, 163, 184, .24); color: #E2E8F0 }
      .gho:hover { background: rgba(255, 255, 255, .12) }
      .foot { display: flex; align-items: center; margin-top: 11px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, .07) }
      .byp { background: none; border: 0; padding: 0; color: #8B97A8; font-size: 10.5px; font-weight: 500; text-decoration: underline; text-underline-offset: 2px }
      .byp:hover { color: #FF9AA2 }
      .hint { margin-top: 10px; font-size: 11px; line-height: 1.5; color: #97A3B6 }
    `;
    const box = document.createElement("div");
    box.className = "box";
    box.id = "lf-box";
    hudShadow.append(style, box);
    rootMount?.appendChild(hudHost);
    return hudHost;
  }

  function effectiveEditorText(ed) {
    const domText = readEditorText(ed);
    const now = Date.now();
    if (
      recentPaste.text &&
      now - recentPaste.at <= RECENT_PASTE_MS &&
      (!recentPaste.target || recentPaste.target === ed)
    ) {
      const domNorm = normalize(domText);
      const pasteNorm = normalize(recentPaste.text);
      if (pasteNorm && !domNorm.includes(pasteNorm)) {
        return domText ? `${domText}\n${recentPaste.text}` : recentPaste.text;
      }
    }
    if (!normalize(domText)) {
      const perEl = ed ? editorSnapshots.get(ed) : null;
      if (perEl && perEl.text && now - perEl.at <= SNAPSHOT_TTL_MS) {
        return perEl.text;
      }
      if (
        lastLiveSnapshot.text &&
        now - lastLiveSnapshot.at <= SNAPSHOT_TTL_MS &&
        (!ed || lastLiveSnapshot.target === ed)
      ) {
        return lastLiveSnapshot.text;
      }
    }
    return domText;
  }

  function triggerCleanSubmit(ed, sendBtn) {
    const btn = sendBtn && isNodeConnected(sendBtn) ? sendBtn : findSubmitControlForEditor(ed);
    if (btn) {
      btn.click();
      return;
    }
    const form = ed?.closest?.("form");
    if (form) {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
    }
  }

  function scrubCurrentDraft(ed, scan) {
    if (scrubInFlight) return;
    scrubInFlight = true;
    const sendBtn = hudState.sendBtn;
    const fw = globalThis.LocalFirstFirewall;
    const liveNow = readEditorText(ed);
    let activeScan = scan;
    if (fw?.scrubSync && liveNow && normalize(liveNow) !== normalize(hudState.rawText)) {
      const rescanned = fw.scrubSync(liveNow, true, protectionLevel);
      if (rescanned.mergedSpans.length >= 1) {
        activeScan = rescanned;
      }
    }
    mutedTarget = ed;
    mutedUntil = Date.now() + MUTE_MS;
    recentPaste = { target: null, text: "", at: 0 };
    if (ed) editorSnapshots.delete(ed);
    lastLiveSnapshot = { target: null, text: "", at: 0 };
    scanEpoch++;
    setHud({ mode: "HIDDEN" });
    // Mark the scrubbed text as clean BEFORE the write so our own synthetic input
    // event cannot clear the mute.
    const clean = normalize(activeScan.sanitizedText);
    lastCleanNorm = clean;
    lastBypassedNorm = clean;
    const trusted = replaceEntireEditor(ed, activeScan.sanitizedText, activeScan.mergedSpans);
    recordStats(activeScan.mergedSpans.length);

    if (!trusted) {
      scrubInFlight = false;
      lastCleanNorm = "";
      lastBypassedNorm = "";
      mutedTarget = null;
      mutedUntil = 0;
      showCopyFallback(activeScan.sanitizedText);
      return;
    }

    setTimeout(() => {
      scrubInFlight = false;
      if (!isAlive()) return;
      const post = normalize(readEditorText(ed));
      const stillLeaky = (activeScan.mergedSpans || []).some(
        (s) => s.matchedText && post.includes(normalize(s.matchedText)),
      );
      const landed = !stillLeaky && post.includes("[REDACTED:");
      if (!landed) {
        lastCleanNorm = "";
        lastBypassedNorm = "";
        mutedTarget = null;
        mutedUntil = 0;
        showCopyFallback(activeScan.sanitizedText);
        return;
      }
      lastCleanNorm = post;
      lastBypassedNorm = post;
      snapshotEditor(ed);
      mutedTarget = null;
      mutedUntil = 0;
      triggerCleanSubmit(ed, sendBtn);
    }, VERIFY_MS);
  }

  async function copyScrubbedText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn("[Cordon] clipboard write refused, trying the legacy path:", err?.message);
    }
    try {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      return ok;
    } catch (err) {
      console.warn("[Cordon] legacy clipboard copy failed:", err?.message);
      return false;
    }
  }

  function showCopyFallback(scrubbedText) {
    setHud({ mode: "COPY_FALLBACK", scrubbedText });
  }

  function setHud(next) {
    if (!isAlive()) return;
    const prev = hudState;
    const nextState = { ...hudState, ...next };
    if (
      prev.mode === "MODAL" &&
      nextState.mode === "MODAL" &&
      prev.target === nextState.target &&
      prev.rawText === nextState.rawText &&
      prev.trigger === nextState.trigger &&
      prev.bypassArmed === nextState.bypassArmed
    ) {
      return;
    }
    hudState = nextState;
    const host = ensureHost();
    host.dataset.lfState = hudState.mode;
    const box = hudShadow.getElementById("lf-box");
    const mk = (tag, cls, id, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (id) el.id = id;
      if (tag === "button") el.type = "button";
      if (text !== undefined) el.textContent = text;
      return el;
    };

    if (hudState.mode === "COPY_FALLBACK") {
      box.className = "box modal";
      const row = mk("div", "row");
      const heading = mk("div");
      heading.append(
        mk("div", "title", "lf-copy-headline", "Editor rejected the scrub"),
        mk("div", "sub", "", "Nothing was sent. Your draft is still in the box."),
      );
      row.append(heading, mk("span", "badge", "", "CORDON · SAFE COPY"));
      const body = mk("div", "body");
      body.append(
        row,
        mk("div", "label", "", "What would have been sent"),
        mk("div", "prev", "lf-copy-preview", (hudState.scrubbedText || "").slice(0, 110)),
      );
      const acts = mk("div", "acts");
      const copyBtn = mk("button", "pri", "lf-copy", "Copy scrubbed text");
      const closeBtn = mk("button", "gho", "lf-copy-close", "Close");
      acts.append(copyBtn, closeBtn);
      body.append(
        acts,
        mk(
          "div",
          "hint",
          "lf-copy-hint",
          "This editor keeps its own copy of the text. Copy the safe version and paste it in yourself.",
        ),
      );
      box.replaceChildren(mk("div", "accent"), body);
      copyBtn.onclick = () => {
        void copyScrubbedText(hudState.scrubbedText || "").then((ok) => {
          copyBtn.textContent = ok ? "Copied" : "Copy failed — select manually";
          copyBtn.disabled = ok;
        });
      };
      closeBtn.onclick = () => setHud({ mode: "HIDDEN" });
      return;
    }

    if (hudState.mode === "HIDDEN" || !hudState.scan) {
      box.className = "box";
      box.replaceChildren();
      return;
    }
    const count = hudState.scan.mergedSpans.length;
    const isSend = hudState.trigger === "SEND";
    const headline = isSend
      ? `Send blocked — ${count} secret${count === 1 ? "" : "s"} detected`
      : `Paste blocked — ${count} secret${count === 1 ? "" : "s"} detected`;
    const priLabel = isSend ? "Use Scrub & Send" : "Paste Safe Version";
    const bypLabel = isSend
      ? "Reject & Send Anyway"
      : hudState.bypassArmed
        ? "Confirm Paste Raw Once?"
        : "Paste Raw Once";
    box.className = "box modal";
    const row = mk("div", "row");
    const heading = mk("div");
    heading.append(
      mk("div", "title", "lf-headline", headline),
      mk("div", "sub", "", isSend ? "Nothing was sent." : "Nothing was pasted."),
    );
    row.append(heading, mk("span", "badge", "", `CORDON · ${protectionLevel.toUpperCase()}`));
    const body = mk("div", "body");
    body.append(row, mk("div", "label", "", isSend ? "Safe version" : "Safe paste"));
    const prevEl = mk("div", "prev", "lf-preview", hudState.scan.sanitizedText.slice(0, 110));
    const acts = mk("div", "acts");
    const priBtn = mk("button", "pri", "lf-primary", priLabel);
    const canBtn = mk("button", "gho", "lf-cancel", "Cancel");
    acts.append(priBtn, canBtn);
    const bypBtn = mk("button", "byp", "lf-bypass", bypLabel);
    const foot = mk("div", "foot");
    foot.append(bypBtn);
    body.append(prevEl, acts, foot);
    box.replaceChildren(mk("div", "accent"), body);
    priBtn.onclick = () => {
      if (isSend) return scrubCurrentDraft(hudState.target, hudState.scan);
      mutedTarget = hudState.target;
      mutedUntil = Date.now() + MUTE_MS;
      scanEpoch++;
      const { target, savedSel, scan } = hudState;
      setHud({ mode: "HIDDEN" });
      insertAtSel(target, savedSel, scan.sanitizedText);
      const post = normalize(readEditorText(target));
      const stillLeaky = (scan.mergedSpans || []).some(
        (s) => s.matchedText && post.includes(normalize(s.matchedText)),
      );
      lastCleanNorm = stillLeaky ? "" : post;
    };
    canBtn.onclick = () => {
      scanEpoch++;
      if (hudState.trigger === "SEND") lastDismissedNorm = normalize(hudState.rawText);
      setHud({ mode: "HIDDEN" });
    };
    bypBtn.onclick = () => {
      if (!isSend && !hudState.bypassArmed) return setHud({ bypassArmed: true });
      scanEpoch++;
      const { target, savedSel, rawText, trigger, sendBtn } = hudState;
      setHud({ mode: "HIDDEN" });
      if (trigger === "SEND") {
        lastBypassedNorm = normalize(rawText);
        setTimeout(() => {
          if (!isAlive()) return;
          triggerCleanSubmit(target, sendBtn);
        }, 0);
      } else {
        insertAtSel(target, savedSel, rawText);
      }
    };
  }

  function onPaste(ev) {
    // Silent while pasting: composition is never interrupted.
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const ed = resolveEditor(ev);
    if (ed) lastEditor = ed;
    const pasted = ev.clipboardData?.getData?.("text/plain") || "";
    if (pasted) {
      recentPaste = { target: ed, text: pasted, at: Date.now() };
      if (ed) {
        const cur = readEditorText(ed);
        const combined = cur ? `${cur}${pasted}` : pasted;
        editorSnapshots.set(ed, { text: combined, at: Date.now() });
        lastLiveSnapshot = { target: ed, text: combined, at: Date.now() };
      }
      if (normalize(pasted) !== lastCleanNorm) {
        mutedTarget = null;
        mutedUntil = 0;
      }
    }
  }

  function onInput(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const ed = resolveEditor(ev);
    if (!ed) return;
    const raw = readEditorText(ed);
    const isUserDelete =
      typeof ev?.inputType === "string" &&
      (ev.inputType.startsWith("delete") || ev.inputType === "historyUndo");
    snapshotEditor(ed, isUserDelete || !raw);
    const norm = normalize(raw);
    if (recentPaste.text && norm.includes(normalize(recentPaste.text))) {
      recentPaste = { target: null, text: "", at: 0 };
    }
    if (norm !== lastDismissedNorm) lastDismissedNorm = "";
    if (norm !== lastBypassedNorm) lastBypassedNorm = "";
    if (norm !== lastCleanNorm && mutedTarget === ed) {
      mutedTarget = null;
      mutedUntil = 0;
    }
  }

  function onCompositionStart() {
    composing = true;
  }

  function onCompositionEnd(ev) {
    composing = false;
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const ed = resolveEditor(ev);
    if (ed) snapshotEditor(ed);
  }

  /**
   * 100% synchronous scan & propagation stop.
   * When `syncDeterministicOnly` is true (used on `pointerdown` / `mousedown`), only blocks
   * when `scrubSync` synchronously detects >= 1 secret so clean pointer interactions never stall.
   */
  function handleSendAttempt(ev, ed, sendBtn = null, syncDeterministicOnly = false) {
    const fw = globalThis.LocalFirstFirewall;
    const text = effectiveEditorText(ed);
    const norm = normalize(text);
    if (!fw?.scrubSync || !norm || norm === lastCleanNorm || norm === lastBypassedNorm) return false;

    const scan = fw.scrubSync(text, true, protectionLevel);
    if (scan.mergedSpans.length >= 1) {
      blockEventSync(ev);
      const effectiveBtn =
        sendBtn && sendBtn.getAttribute?.("role") !== "option"
          ? sendBtn
          : findSubmitControlForEditor(ed);
      setHud({
        mode: "MODAL",
        trigger: "SEND",
        target: ed,
        savedSel: null,
        rawText: text,
        scan,
        bypassArmed: false,
        sendBtn: effectiveBtn,
      });
      return true;
    }

    if (syncDeterministicOnly) return false;

    if (
      protectionLevel !== "low" &&
      text.length >= 20 &&
      !text.includes("[REDACTED:") &&
      fw.runExtensionNanoScan &&
      globalThis.LanguageModel
    ) {
      blockEventSync(ev);
      const myEpoch = ++scanEpoch;
      const effectiveBtn =
        sendBtn && sendBtn.getAttribute?.("role") !== "option"
          ? sendBtn
          : findSubmitControlForEditor(ed);
      const finish = (scanResult) => {
        if (!isAlive() || myEpoch !== scanEpoch || isMuted(ed)) return;
        if (scanResult?.mergedSpans?.length >= 1) {
          setHud({
            mode: "MODAL",
            trigger: "SEND",
            target: ed,
            savedSel: null,
            rawText: text,
            scan: scanResult,
            bypassArmed: false,
            sendBtn: effectiveBtn,
          });
          return;
        }
        lastBypassedNorm = norm;
        try {
          triggerCleanSubmit(ed, effectiveBtn);
        } finally {
          lastBypassedNorm = "";
        }
      };
      void fw
        .runExtensionNanoScan(text, { timeoutMs: 2500, protectionLevel })
        .then(finish)
        .catch((err) => {
          console.warn("[Cordon] Nano pass failed, falling back to local rules:", err?.message);
          try {
            finish(fw.scrubSync(text, true, protectionLevel));
          } catch (fallbackErr) {
            console.warn("[Cordon] Local fallback failed, releasing send:", fallbackErr?.message);
            if (isAlive() && myEpoch === scanEpoch) triggerCleanSubmit(ed, effectiveBtn);
          }
        });
      return true;
    }
    return false;
  }

  function isEnterLikeKey(ev) {
    return (
      ev.key === "Enter" ||
      ev.code === "Enter" ||
      ev.code === "NumpadEnter" ||
      ev.keyCode === 13 ||
      ev.which === 13
    );
  }

  function onKeyDown(ev) {
    if (!isAlive()) return;
    const isEnter = isEnterLikeKey(ev);
    if (hudState.mode === "MODAL") {
      if (ev.key === "Escape") {
        blockEventSync(ev);
        hudShadow?.getElementById("lf-cancel")?.click();
      } else if (isEnter && !isOwnHudEvent(ev)) {
        blockEventSync(ev);
      }
      return;
    }
    if (hudState.mode === "COPY_FALLBACK" && ev.key === "Escape") {
      blockEventSync(ev);
      hudShadow?.getElementById("lf-copy-close")?.click();
      return;
    }
    if (isOwnHudEvent(ev) || !shieldEnabled) return;
    if (composing || ev.isComposing || ev.keyCode === 229) return;

    const ed = resolveEditor(ev);
    if (ed) snapshotEditor(ed);
    if (!ed || isMuted(ed) || !isEnter) return;

    const singleOrSearch = isSingleLineOrSearchField(ed);
    if (ev.shiftKey && !singleOrSearch) {
      lastShiftEnterAt = Date.now();
      return;
    }

    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.shouldInterceptSendKey) return;
    const shouldIntercept = fw.shouldInterceptSendKey({
      key: "Enter",
      code: ev.code,
      keyCode: ev.keyCode,
      isTextarea: ed.tagName === "TEXTAREA",
      isSingleLineInput: singleOrSearch,
      enterSubmitsTextarea: doesTextareaSubmitOnPlainEnter(ed),
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      level: protectionLevel,
    });
    if (shouldIntercept) {
      handleSendAttempt(ev, ed, null, false);
    }
  }

  function onKeyPress(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    if (composing || ev.isComposing || ev.keyCode === 229) return;
    if (!isEnterLikeKey(ev)) return;
    if (hudState.mode === "MODAL") {
      blockEventSync(ev);
      return;
    }
    const ed = resolveEditor(ev);
    if (!ed || isMuted(ed)) return;
    const singleOrSearch = isSingleLineOrSearchField(ed);
    if (ev.shiftKey && !singleOrSearch) return;
    const fw = globalThis.LocalFirstFirewall;
    if (
      fw?.shouldInterceptSendKey?.({
        key: "Enter",
        code: ev.code,
        keyCode: ev.keyCode,
        isTextarea: ed.tagName === "TEXTAREA",
        isSingleLineInput: singleOrSearch,
        enterSubmitsTextarea: doesTextareaSubmitOnPlainEnter(ed),
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        shiftKey: ev.shiftKey,
        altKey: ev.altKey,
        level: protectionLevel,
      })
    ) {
      handleSendAttempt(ev, ed, null, true);
    }
  }

  function onBeforeInput(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    if (composing || ev.isComposing) return;
    const type = ev.inputType || "";
    if (type !== "insertParagraph" && type !== "insertLineBreak") return;
    if (hudState.mode === "MODAL") {
      blockEventSync(ev);
      return;
    }
    const ed = resolveEditor(ev);
    if (ed) snapshotEditor(ed);
    if (!ed || isMuted(ed) || protectionLevel === "low") return;
    const singleOrSearch = isSingleLineOrSearchField(ed);
    // Allow Shift+Enter soft linebreaks inside multiline editors.
    if (type === "insertLineBreak" && !singleOrSearch && Date.now() - lastShiftEnterAt <= 80) {
      return;
    }
    // Multiline document textareas (e.g. GitHub issues) insert newlines on plain Enter.
    if (ed.tagName === "TEXTAREA" && !doesTextareaSubmitOnPlainEnter(ed)) {
      return;
    }
    handleSendAttempt(ev, ed, null, true);
  }

  function onPointerOrMouseDown(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    // Snapshot current active editor BEFORE any site mousedown handler can clear `.value = ''`.
    const activeEd = findEditor(getDeepActiveElement()) || (lastEditor && isNodeConnected(lastEditor) ? lastEditor : null);
    if (activeEd) snapshotEditor(activeEd);

    const triggerEl = findActionTriggerInEvent(ev);
    lastSendPointer = triggerEl;
    if (!triggerEl) return;

    const fw = globalThis.LocalFirstFirewall;
    const label = `${triggerEl.getAttribute("aria-label") || ""} ${triggerEl.getAttribute("value") || ""} ${triggerEl.textContent || ""}`;
    if (!isExplicitSearchOrOptionTrigger(triggerEl) && fw?.isLikelyNonSendButton?.(label)) return;

    if (hudState.mode === "MODAL") {
      blockEventSync(ev);
      return;
    }
    if (protectionLevel === "low") return;

    const ed =
      activeEd ||
      resolveEditor(ev) ||
      findEditorInContainer(triggerEl.closest?.("form") || triggerEl.getRootNode?.() || document);
    if (ed && !isMuted(ed)) {
      handleSendAttempt(ev, ed, triggerEl, true);
    }
  }

  function onSubmit(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    if (hudState.mode === "MODAL") {
      blockEventSync(ev);
      return;
    }
    const form = ev.target;
    const ed =
      findEditorInContainer(form) ||
      resolveEditor(getDeepActiveElement()) ||
      (lastEditor && isNodeConnected(lastEditor) ? lastEditor : null);
    if (!ed || isMuted(ed)) return;
    const submitter =
      ev.submitter ??
      form?.querySelector?.('button[type="submit"], input[type="submit"]') ??
      null;
    handleSendAttempt(ev, ed, submitter, false);
  }

  function onClick(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    const triggerEl =
      findActionTriggerInEvent(ev) ??
      (lastSendPointer && isNodeConnected(lastSendPointer) ? lastSendPointer : null);
    if (!triggerEl) return;

    const fw = globalThis.LocalFirstFirewall;
    const label = `${triggerEl.getAttribute("aria-label") || ""} ${triggerEl.getAttribute("value") || ""} ${triggerEl.textContent || ""}`;
    if (!isExplicitSearchOrOptionTrigger(triggerEl) && fw?.isLikelyNonSendButton?.(label)) return;

    if (hudState.mode === "MODAL") {
      blockEventSync(ev);
      return;
    }
    const ed =
      findEditor(getDeepActiveElement()) ||
      (lastEditor && isNodeConnected(lastEditor) ? lastEditor : null) ||
      findEditorInContainer(triggerEl.closest?.("form") || triggerEl.getRootNode?.() || document);
    if (ed && !isMuted(ed)) {
      handleSendAttempt(ev, ed, triggerEl, false);
    }
  }

  loadSettings();
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!isAlive() || msg?.type !== "LOCALFIRST_PING") return false;
      sendResponse({ armed: true, host: location.hostname, protectionLevel, shieldEnabled });
      return false;
    });
  }

  const CAP = { capture: true };
  window.addEventListener("paste", onPaste, CAP);
  window.addEventListener("input", onInput, CAP);
  window.addEventListener("change", onInput, CAP);
  window.addEventListener("compositionstart", onCompositionStart, CAP);
  window.addEventListener("compositionend", onCompositionEnd, CAP);
  window.addEventListener("keydown", onKeyDown, CAP);
  window.addEventListener("keypress", onKeyPress, CAP);
  window.addEventListener("beforeinput", onBeforeInput, CAP);
  window.addEventListener("pointerdown", onPointerOrMouseDown, CAP);
  window.addEventListener("mousedown", onPointerOrMouseDown, CAP);
  window.addEventListener("click", onClick, CAP);
  window.addEventListener("submit", onSubmit, CAP);

  globalThis.__cordonShieldCleanup = () => {
    window.removeEventListener("paste", onPaste, CAP);
    window.removeEventListener("input", onInput, CAP);
    window.removeEventListener("change", onInput, CAP);
    window.removeEventListener("compositionstart", onCompositionStart, CAP);
    window.removeEventListener("compositionend", onCompositionEnd, CAP);
    window.removeEventListener("keydown", onKeyDown, CAP);
    window.removeEventListener("keypress", onKeyPress, CAP);
    window.removeEventListener("beforeinput", onBeforeInput, CAP);
    window.removeEventListener("pointerdown", onPointerOrMouseDown, CAP);
    window.removeEventListener("mousedown", onPointerOrMouseDown, CAP);
    window.removeEventListener("click", onClick, CAP);
    window.removeEventListener("submit", onSubmit, CAP);
  };
})();
