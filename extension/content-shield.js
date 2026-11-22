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
  let hudState = { mode: "HIDDEN", target: null, savedSel: null, rawText: "", scan: null, bypassArmed: false };
  let lastCleanNorm = "", lastDismissedNorm = "", lastBypassedNorm = "";

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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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

  function captureSel(ed) {
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      return { kind: "input", start: ed.selectionStart ?? ed.value.length, end: ed.selectionEnd ?? ed.value.length };
    }
    const sel = window.getSelection();
    return { kind: "editable", range: sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null };
  }

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
    style.textContent = `:host{all:initial}.box{display:none;background:#0B0C10;color:#F8FAFC;border:1px solid rgba(148,163,184,.28);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.6);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.pill{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border-color:rgba(0,229,163,.4)}.modal{display:block;width:380px;max-width:calc(100vw - 32px);padding:14px}.row{display:flex;justify-content:space-between;align-items:center;gap:8px}.title{font-weight:700;font-size:13px}.badge{font:700 10px ui-monospace,monospace;padding:2px 6px;border-radius:5px;background:rgba(255,77,90,.15);color:#FF6B76}.prev{margin:8px 0;padding:7px 9px;background:#07090D;border-radius:7px;font:11px ui-monospace,monospace;color:#00E5A3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}button{cursor:pointer;border:1px solid transparent;border-radius:7px;font-size:11.5px;font-weight:600;padding:6px 10px}.pri{background:#00E5A3;color:#07090D}.gho{background:transparent;color:#94A3B8}.byp{background:transparent;color:#64748B;font-size:10.5px;padding:4px 0 0;text-decoration:underline}`;
    const box = document.createElement("div");
    box.className = "box";
    box.id = "lf-box";
    hudShadow.append(style, box);
    document.documentElement.appendChild(hudHost);
    return hudHost;
  }

  function scrubCurrentDraft(ed, scan) {
    mutedTarget = ed;
    mutedUntil = Date.now() + 2000;
    scanEpoch++;
    setHud({ mode: "HIDDEN" });
    replaceEntireEditor(ed, scan.sanitizedText, scan.mergedSpans);
    recordStats(scan.mergedSpans.length);
    lastCleanNorm = normalize(readEditorText(ed) || scan.sanitizedText);
    setTimeout(() => { if (isAlive() && ed) lastCleanNorm = normalize(readEditorText(ed)); }, 150);
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
    if (hudState.mode === "HIDDEN" || !hudState.scan) { box.className = "box"; box.innerHTML = ""; return; }
    const count = hudState.scan.mergedSpans.length;
    const isSend = hudState.trigger === "SEND";
    const headline = isSend ? `Send Blocked — ${count} secret${count === 1 ? "" : "s"} detected` : `Blocked ${count} secret${count === 1 ? "" : "s"} locally`;
    const priLabel = isSend ? "Scrub Draft" : "Paste Safe Version";
    const bypLabel = isSend ? (hudState.bypassArmed ? "Confirm Send Raw Once?" : "Send Raw Once") : (hudState.bypassArmed ? "Confirm Paste Raw Once?" : "Paste Raw Once");
    box.className = "box modal";
    box.innerHTML = `<div class="row"><span class="title" id="lf-headline">${headline}</span><span class="badge">${protectionLevel.toUpperCase()}</span></div><div class="prev" id="lf-preview"></div><div class="acts"><button type="button" class="pri" id="lf-primary">${priLabel}</button><button type="button" class="gho" id="lf-cancel">Cancel</button></div><button type="button" class="byp" id="lf-bypass">${bypLabel}</button>`;
    hudShadow.getElementById("lf-preview").textContent = hudState.scan.sanitizedText.slice(0, 110);
    hudShadow.getElementById("lf-primary").onclick = () => {
      if (isSend) return scrubCurrentDraft(hudState.target, hudState.scan);
      mutedTarget = hudState.target;
      mutedUntil = Date.now() + 2000;
      scanEpoch++;
      const { target, savedSel, scan } = hudState;
      setHud({ mode: "HIDDEN" });
      insertAtSel(target, savedSel, scan.sanitizedText);
      lastCleanNorm = normalize(readEditorText(target));
    };
    hudShadow.getElementById("lf-cancel").onclick = () => {
      scanEpoch++;
      if (hudState.trigger === "SEND") lastDismissedNorm = normalize(hudState.rawText);
      setHud({ mode: "HIDDEN" });
    };
    hudShadow.getElementById("lf-bypass").onclick = () => {
      if (!hudState.bypassArmed) return setHud({ bypassArmed: true });
      scanEpoch++;
      const { target, savedSel, rawText, trigger } = hudState;
      setHud({ mode: "HIDDEN" });
      if (trigger === "SEND") lastBypassedNorm = normalize(rawText);
      else insertAtSel(target, savedSel, rawText);
    };
  }

  function onPaste(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const fw = globalThis.LocalFirstFirewall, ed = resolveEditor(ev), rawText = ev.clipboardData?.getData("text/plain") || "";
    if (!fw?.scrubSync || !ed || !rawText) return;
    lastEditor = ed;
    scanEpoch++;
    const scan = fw.scrubSync(rawText, true, protectionLevel);
    if (scan.mergedSpans.length === 0) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    recordStats(scan.mergedSpans.length);
    setHud({ mode: "MODAL", trigger: "PASTE", target: ed, savedSel: captureSel(ed), rawText, scan, bypassArmed: false });
  }

  function onInput(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled) return;
    const ed = resolveEditor(ev);
    if (!ed) return;
    lastEditor = ed;
    const norm = normalize(readEditorText(ed));
    if (norm !== lastDismissedNorm) lastDismissedNorm = "";
    if (norm !== lastBypassedNorm) lastBypassedNorm = "";
  }

  function handleSendAttempt(ev, ed, sendBtn = null) {
    const fw = globalThis.LocalFirstFirewall, text = readEditorText(ed), norm = normalize(text);
    if (!fw?.scrubSync || !norm || norm === lastCleanNorm || norm === lastBypassedNorm) return;
    const scan = fw.scrubSync(text, true, protectionLevel);
    if (scan.mergedSpans.length >= 1) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      setHud({ mode: "MODAL", trigger: "SEND", target: ed, savedSel: null, rawText: text, scan, bypassArmed: false });
      return;
    }
    if (protectionLevel === "high" && text.length >= 20 && !text.includes("[REDACTED:") && fw.runExtensionNanoScan && globalThis.LanguageModel) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      const myEpoch = ++scanEpoch;
      void fw.runExtensionNanoScan(text, { timeoutMs: 2500 }).then((nanoRes) => {
        if (!isAlive() || myEpoch !== scanEpoch || isMuted(ed)) return;
        if (nanoRes?.mergedSpans?.length >= 1) {
          setHud({ mode: "MODAL", trigger: "SEND", target: ed, savedSel: null, rawText: text, scan: nanoRes, bypassArmed: false });
        } else {
          lastBypassedNorm = norm;
          sendBtn?.click();
        }
      });
    }
  }

  function onKeyDown(ev) {
    if (!isAlive()) return;
    if (hudState.mode === "MODAL") { if (ev.key === "Escape") { ev.preventDefault(); hudShadow?.getElementById("lf-cancel")?.click(); } return; }
    if (isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low" || ev.key !== "Enter" || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const ed = resolveEditor(ev);
    if (ed && !isMuted(ed) && ed.tagName !== "TEXTAREA") handleSendAttempt(ev, ed, null);
  }

  function onClick(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    const el = ev.target?.nodeType === 3 ? ev.target.parentElement : ev.target;
    const sendBtn = el?.closest?.(SEND_SEL);
    if (!sendBtn) return;
    const ed = resolveEditor(document.activeElement) || (lastEditor && document.contains(lastEditor) ? lastEditor : null) || document.querySelector('[contenteditable="true"], [role="textbox"], textarea');
    if (ed && !isMuted(ed)) handleSendAttempt(ev, ed, sendBtn);
  }

  loadSettings();
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
})();
