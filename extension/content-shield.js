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
  let composing = false, lastSendPointer = null;
  let hudState = { mode: "HIDDEN", target: null, savedSel: null, rawText: "", scan: null, bypassArmed: false, sendBtn: null, scrubbedText: "" };
  let lastCleanNorm = "", lastDismissedNorm = "", lastBypassedNorm = "";

  // Only long enough to swallow the synthetic input event our own DOM write emits.
  const MUTE_MS = 250;
  // Time for the host framework to reconcile before we trust the editor contents.
  const VERIFY_MS = 120;

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

  /**
   * Writes `nextText` into the editor and reports whether the write is trustworthy.
   *
   * A textarea's `value` setter is the supported React-safe path. In a contenteditable,
   * `execCommand("insertText")` goes through the browser's editing pipeline, which is what a
   * framework like ProseMirror listens to. Assigning `textContent` does NOT: it changes the DOM
   * while the framework keeps its own raw model, so the site would still send the original text.
   * An untrusted write is therefore rolled back, leaving the DOM and the model agreeing again.
   */
  function replaceEntireEditor(ed, nextText, spans) {
    ed.focus();
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const proto = ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(ed, nextText);
      else ed.value = nextText;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: nextText }));
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
    try { ok = document.execCommand("insertText", false, nextText); } catch { ok = false; }
    const post = normalize(readEditorText(ed));
    const leaked = (spans || []).some((s) => s.matchedText && post.includes(normalize(s.matchedText)));
    if (ok && !leaked && post) return true;
    if (readEditorText(ed) !== before) {
      ed.textContent = before;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: before }));
    }
    return false;
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
    // event cannot clear the mute.
    const clean = normalize(scan.sanitizedText);
    lastCleanNorm = clean;
    lastBypassedNorm = clean;
    const trusted = replaceEntireEditor(ed, scan.sanitizedText, scan.mergedSpans);
    recordStats(scan.mergedSpans.length);

    if (!trusted) {
      // The editor refused the write, so it was rolled back to the raw text. Clicking Send here
      // would send the original secret, so Send stays blocked and we hand over the safe text.
      lastCleanNorm = "";
      lastBypassedNorm = "";
      mutedTarget = null;
      mutedUntil = 0;
      showCopyFallback(scan.sanitizedText);
      return;
    }

    // Release Send only after the editor actually holds the scrubbed text. A framework
    // that reverts the DOM, or an editor that ignores the write, keeps Send blocked.
    setTimeout(() => {
      if (!isAlive()) return;
      const post = normalize(readEditorText(ed));
      const stillLeaky = (scan.mergedSpans || []).some(
        (s) => s.matchedText && post.includes(normalize(s.matchedText)),
      );
      const landed = !stillLeaky && post.includes("[REDACTED:");
      if (!landed) {
        lastCleanNorm = "";
        lastBypassedNorm = "";
        mutedTarget = null;
        mutedUntil = 0;
        showCopyFallback(scan.sanitizedText);
        return;
      }
      lastCleanNorm = post;
      lastBypassedNorm = post;
      // The write landed, so the mute has done its job. Leaving it up would let a real
      // user click through the guard for the rest of the window.
      mutedTarget = null;
      mutedUntil = 0;
      const btn = sendBtn && document.contains(sendBtn) ? sendBtn : document.querySelector(SEND_SEL);
      btn?.click();
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

    if (hudState.mode === "HIDDEN" || !hudState.scan) { box.className = "box"; box.replaceChildren(); return; }
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
      // Send stays blocked until a result arrives. Every path below ends in either the
      // modal or a released send, so a hung or throwing model can never deadlock the composer.
      const finish = (scanResult) => {
        if (!isAlive() || myEpoch !== scanEpoch || isMuted(ed)) return;
        if (scanResult?.mergedSpans?.length >= 1) {
          setHud({ mode: "MODAL", trigger: "SEND", target: ed, savedSel: null, rawText: text, scan: scanResult, bypassArmed: false, sendBtn });
          return;
        }
        lastBypassedNorm = norm;
        try {
          (sendBtn || document.querySelector(SEND_SEL))?.click();
        } finally {
          // Single-use: the click above is ours. A later Send of the same draft is the user
          // asking again, and must be rescanned now that the model may have recovered.
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
            if (isAlive() && myEpoch === scanEpoch) (sendBtn || document.querySelector(SEND_SEL))?.click();
          }
        });
    }
  }

  function onKeyDown(ev) {
    if (!isAlive()) return;
    if (hudState.mode === "MODAL") { if (ev.key === "Escape") { ev.preventDefault(); hudShadow?.getElementById("lf-cancel")?.click(); } return; }
    if (isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    // An IME (Japanese, Korean, Chinese, Vietnamese) commits with Enter. That keypress
    // belongs to the input method, never to the Send action.
    if (composing || ev.isComposing || ev.keyCode === 229) return;
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

  function onPointerDown(ev) {
    if (!isAlive() || isOwnHudEvent(ev)) return;
    const el = ev.target?.nodeType === 3 ? ev.target.parentElement : ev.target;
    lastSendPointer = el?.closest?.(SEND_SEL) ?? null;
  }

  function onSubmit(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    const form = ev.target;
    const ed =
      resolveEditor(document.activeElement) ||
      (lastEditor && document.contains(lastEditor) ? lastEditor : null) ||
      form?.querySelector?.('[contenteditable="true"], [role="textbox"], textarea');
    if (!ed || isMuted(ed)) return;
    const submitter =
      ev.submitter ??
      form?.querySelector?.('button[type="submit"], input[type="submit"]') ??
      null;
    handleSendAttempt(ev, ed, submitter);
  }

  function onClick(ev) {
    if (!isAlive() || isOwnHudEvent(ev) || !shieldEnabled || protectionLevel === "low") return;
    const el = ev.target?.nodeType === 3 ? ev.target.parentElement : ev.target;
    const sendBtn =
      el?.closest?.(SEND_SEL) ??
      (lastSendPointer && document.contains(lastSendPointer) ? lastSendPointer : null);
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
  document.addEventListener("compositionstart", () => { composing = true; }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
})();
