(function () {
  "use strict";

  const ID =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.documentElement.dataset.lfShieldId = ID;
  document.documentElement.dataset.localfirstShield = "armed";

  const HOST_ID = "localfirst-paste-shield-host";
  const SEND_SEL =
    'button[data-testid="send-button"], button[aria-label*="Send" i], button.send-button, button[mattooltip*="Send" i], button[data-qa="texty_send_button"], button[type="submit"]';

  let shieldEnabled = true, protectionLevel = "medium", mutedUntil = 0, mutedTarget = null, lastEditor = null;
  let scanEpoch = 0, hudHost = null, hudShadow = null;
  let hudState = { mode: "HIDDEN", target: null, savedSel: null, rawText: "", scan: null, bypassArmed: false, sendBtn: null };
  let lastCleanNorm = "", lastDismissedNorm = "", lastBypassedNorm = "";

  // Only long enough to swallow the synthetic input event our own DOM write emits.
  const MUTE_MS = 250;

  const isAlive = () => document.documentElement.dataset.lfShieldId === ID;
  const isMuted = (ed) => ed && mutedTarget === ed && Date.now() < mutedUntil;
  const normalize = (s) => (s || "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  const hasExt = () => typeof chrome !== "undefined" && Boolean(chrome.runtime?.id && chrome.storage?.local);
  const isOwnHudEvent = (ev) => Boolean(hudHost && (ev.composedPath?.().includes(hudHost) || ev.target?.id === HOST_ID));

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
        if (["low", "medium", "high"].includes(c.protectionLevel?.newValue)) protectionLevel = c.protectionLevel.newValue;
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

  function findEditor(node) {
    const el = node?.nodeType === 3 ? node.parentElement : node;
    if (!el || typeof el.closest !== "function") return null;
    const inp = el.closest("textarea, input");
    if (inp) {
      const t = (inp.getAttribute("type") || "text").toLowerCase();
      if (inp.tagName === "TEXTAREA" || ["text", "search", "url", "email", ""].includes(t)) return inp;
    }
    if (el.isContentEditable) {
      let root = el;
      while (root.parentElement?.isContentEditable) root = root.parentElement;
      return root;
    }
    return el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }

  function resolveEditor(evOrNode) {
    if (evOrNode?.composedPath) {
      for (const n of evOrNode.composedPath()) {
        const ed = findEditor(n);
        if (ed) return ed;
      }
    }
    return findEditor(evOrNode?.target ?? evOrNode) || findEditor(document.activeElement);
  }

  const readEditorText = (ed) =>
    !ed ? "" : ed.tagName === "TEXTAREA" || ed.tagName === "INPUT" ? ed.value || "" : ed.innerText || ed.textContent || "";

  function replaceEntireEditor(ed, nextText, spans) {
    ed.focus();
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const proto = ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(ed, nextText);
      else ed.value = nextText;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: nextText }));
      ed.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    let ok = false;
    try { ok = document.execCommand("insertText", false, nextText); } catch { ok = false; }
    const post = normalize(readEditorText(ed));
    const leaked = (spans || []).some((s) => s.matchedText && post.includes(normalize(s.matchedText)));
    if (!ok || leaked || !post) {
      ed.textContent = nextText;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: nextText }));
    }
  }

  function insertAtSel(ed, savedSel, text) {
    ed.focus();
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const s = savedSel?.kind === "input" ? savedSel.start : ed.value.length;
      const e = savedSel?.kind === "input" ? savedSel.end : ed.value.length;
      const proto = ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const next = ed.value.slice(0, s) + text + ed.value.slice(e);
      if (setter) setter.call(ed, next);
      else ed.value = next;
      ed.setSelectionRange?.(s + text.length, s + text.length);
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }));
      ed.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const sel = window.getSelection();
    if (sel && savedSel?.kind === "editable" && savedSel.range) {
      sel.removeAllRanges();
      sel.addRange(savedSel.range);
    }
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
    if (!ok) {
      ed.textContent = (ed.textContent || "") + text;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }));
    }
  }

  function ensureHost() {
    if (hudHost && document.documentElement.contains(hudHost)) return hudHost;
    document.getElementById(HOST_ID)?.remove();
    hudHost = document.createElement("div");
    hudHost.id = HOST_ID;
    hudHost.dataset.lfState = "HIDDEN";
    hudHost.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;pointer-events:auto;";
    hudShadow = hudHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `:host{all:initial}@keyframes lf-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}.box{display:none;background:#090B0E;color:#F8FAFC;border:1px solid rgba(148,163,184,.26);border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.68);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.pill{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border-color:rgba(0,229,163,.4)}.modal{display:block;width:380px;max-width:calc(100vw - 32px);padding:14px;animation:lf-in .16s cubic-bezier(.23,1,.32,1)}.row{display:flex;justify-content:space-between;align-items:center;gap:8px}.title{font-weight:700;font-size:13px;letter-spacing:-.01em;color:#F8FAFC}.badge{font:700 10px ui-monospace,monospace;padding:2px 7px;border-radius:5px;border:1px solid rgba(255,77,90,.35);background:rgba(255,77,90,.14);color:#FF6B76;letter-spacing:.04em}.prev{margin:9px 0;padding:8px 10px;background:#11141B;border:1px solid rgba(255,255,255,.08);border-radius:8px;font:11px ui-monospace,monospace;color:#00E5A3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}button{cursor:pointer;border:1px solid transparent;border-radius:8px;font-size:11.5px;font-weight:600;padding:6px 11px;transition:transform .1s ease,opacity .14s ease}button:active{transform:scale(.97)}.pri{background:#00E5A3;color:#07090D;font-weight:700}.pri:hover{opacity:.92}.gho{background:rgba(255,255,255,.06);border-color:rgba(148,163,184,.22);color:#E2E8F0}.gho:hover{background:rgba(255,255,255,.11)}.byp{background:transparent;color:#94A3B8;font-size:10.5px;padding:6px 0 0;text-decoration:underline}.byp:hover{color:#F8FAFC}`;
    const box = document.createElement("div");
    box.className = "box";
    box.id = "lf-box";
    hudShadow.append(style, box);
    document.documentElement.appendChild(hudHost);
    return hudHost;
  }

  function scrubCurrentDraft(ed, scan) {
    const sendBtn = hudState.sendBtn;
    mutedTarget = ed;
    mutedUntil = Date.now() + MUTE_MS;
    scanEpoch++;
    setHud({ mode: "HIDDEN" });
    // Mark the scrubbed text as clean BEFORE the write so our own synthetic input
    // event cannot clear the mute, and so the programmatic Send click below is
    // not re-intercepted.
    const clean = normalize(scan.sanitizedText);
    lastCleanNorm = clean;
    lastBypassedNorm = clean;
    replaceEntireEditor(ed, scan.sanitizedText, scan.mergedSpans);
    recordStats(scan.mergedSpans.length);
    setTimeout(() => {
      if (!isAlive() || !ed) return;
      const post = normalize(readEditorText(ed));
      // If the host framework restored the pre-scrub DOM, `post` contains the raw
      // secret again. Never treat that as clean, or the next Send ships it.
      const stillLeaky = (scan.mergedSpans || []).some(
        (s) => s.matchedText && post.includes(normalize(s.matchedText)),
      );
      lastCleanNorm = stillLeaky ? "" : post;
    }, 150);
    // "Scrub & Send" must actually send: fire the real Send control once the
    // scrubbed text has landed.
    setTimeout(() => {
      if (!isAlive()) return;
      const btn =
        sendBtn && document.contains(sendBtn) ? sendBtn : document.querySelector(SEND_SEL);
      btn?.click();
    }, 0);
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
    if (hudState.mode === "HIDDEN" || !hudState.scan) { box.className = "box"; box.replaceChildren(); return; }
    const count = hudState.scan.mergedSpans.length;
    const isSend = hudState.trigger === "SEND";
    const headline = isSend ? `Send Blocked — ${count} secret${count === 1 ? "" : "s"} detected` : `Blocked ${count} secret${count === 1 ? "" : "s"} locally`;
    const priLabel = isSend ? "Use Scrub & Send" : "Paste Safe Version";
    const bypLabel = isSend
      ? "Reject & Send Anyway"
      : hudState.bypassArmed
        ? "Confirm Paste Raw Once?"
        : "Paste Raw Once";
    box.className = "box modal";
    const mk = (tag, cls, id, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (id) el.id = id;
      if (tag === "button") el.type = "button";
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const row = mk("div", "row");
    row.append(mk("span", "title", "lf-headline", headline), mk("span", "badge", "", `CORDON · ${protectionLevel.toUpperCase()}`));
    const prevEl = mk("div", "prev", "lf-preview", hudState.scan.sanitizedText.slice(0, 110));
    const acts = mk("div", "acts");
    const priBtn = mk("button", "pri", "lf-primary", priLabel);
    const canBtn = mk("button", "gho", "lf-cancel", "Cancel");
    acts.append(priBtn, canBtn);
    const bypBtn = mk("button", "byp", "lf-bypass", bypLabel);
    box.replaceChildren(row, prevEl, acts, bypBtn);
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
      // Send mode is a single explicit confirmation; paste mode keeps the two-step guard.
      if (!isSend && !hudState.bypassArmed) return setHud({ bypassArmed: true });
      scanEpoch++;
      const { target, savedSel, rawText, trigger } = hudState;
      setHud({ mode: "HIDDEN" });
      if (trigger === "SEND") {
        // "Confirm Send Raw Once" must actually send: mark this exact draft as bypassed
        // (so the click below is not re-intercepted) and fire the real Send control.
        lastBypassedNorm = normalize(rawText);
        setTimeout(() => {
          if (!isAlive()) return;
          const btn = hudState.sendBtn && document.contains(hudState.sendBtn)
            ? hudState.sendBtn
            : document.querySelector(SEND_SEL);
          btn?.click();
        }, 0);
      } else {
        insertAtSel(target, savedSel, rawText);
      }
    };
  }

  function onPaste(ev) {
    // Silent while pasting: the send-time guard is the only trigger. We never
    // preventDefault or pop the HUD here.
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const ed = resolveEditor(ev);
    if (ed) lastEditor = ed;
  }

  function onInput(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const ed = resolveEditor(ev);
    if (!ed) return;
    lastEditor = ed;
    const norm = normalize(readEditorText(ed));
    if (norm !== lastDismissedNorm) lastDismissedNorm = "";
    if (norm !== lastBypassedNorm) lastBypassedNorm = "";
    // New user text means the post-scrub mute no longer applies.
    if (norm !== lastCleanNorm && mutedTarget === ed) {
      mutedTarget = null;
      mutedUntil = 0;
    }
  }

  function handleSendAttempt(ev, ed, sendBtn = null) {
    const fw = globalThis.LocalFirstFirewall, text = readEditorText(ed), norm = normalize(text);
    if (!fw?.scrubSync || !norm || norm === lastCleanNorm || norm === lastBypassedNorm) return;
    const scan = fw.scrubSync(text, true, protectionLevel);
    if (scan.mergedSpans.length >= 1) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      setHud({ mode: "MODAL", trigger: "SEND", target: ed, savedSel: null, rawText: text, scan, bypassArmed: false, sendBtn });
      return;
    }
    if (protectionLevel !== "low" && text.length >= 20 && !text.includes("[REDACTED:") && fw.runExtensionNanoScan && globalThis.LanguageModel) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      const myEpoch = ++scanEpoch;
      void fw.runExtensionNanoScan(text, { timeoutMs: 2500 }).then((nanoRes) => {
        if (!isAlive() || myEpoch !== scanEpoch || isMuted(ed)) return;
        if (nanoRes?.mergedSpans?.length >= 1) {
          setHud({ mode: "MODAL", trigger: "SEND", target: ed, savedSel: null, rawText: text, scan: nanoRes, bypassArmed: false, sendBtn });
        } else {
          lastBypassedNorm = norm;
          (sendBtn || document.querySelector(SEND_SEL))?.click();
        }
      });
    }
  }

  function onKeyDown(ev) {
    if (!isAlive()) return;
    if (hudState.mode === "MODAL") { if (ev.key === "Escape") { ev.preventDefault(); hudShadow?.getElementById("lf-cancel")?.click(); } return; }
    if (isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    const ed = resolveEditor(ev);
    if (!ed || isMuted(ed)) return;
    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.shouldInterceptSendKey) return;
    const isSendKey = fw.shouldInterceptSendKey({
      key: ev.key,
      isTextarea: ed.tagName === "TEXTAREA",
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      level: protectionLevel,
    });
    if (isSendKey) handleSendAttempt(ev, ed, null);
  }

  function onClick(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    const el = ev.target?.nodeType === 3 ? ev.target.parentElement : ev.target;
    const sendBtn = el?.closest?.(SEND_SEL);
    if (!sendBtn) return;
    const fw = globalThis.LocalFirstFirewall;
    const label = `${sendBtn.getAttribute("aria-label") || ""} ${sendBtn.textContent || ""}`;
    if (fw?.isLikelyNonSendButton?.(label)) return;
    const ed = resolveEditor(document.activeElement) || (lastEditor && document.contains(lastEditor) ? lastEditor : null) || document.querySelector('[contenteditable="true"], [role="textbox"], textarea');
    if (ed && !isMuted(ed)) handleSendAttempt(ev, ed, sendBtn);
  }

  loadSettings();
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!isAlive() || msg?.type !== "LOCALFIRST_PING") return false;
      sendResponse({ armed: true, host: location.hostname, protectionLevel, shieldEnabled });
      return false;
    });
  }
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
})();
