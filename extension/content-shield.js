(function () {
  "use strict";

  const INSTANCE_ID =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.documentElement.dataset.localfirstInstanceId = INSTANCE_ID;
  document.documentElement.dataset.localfirstShield = "armed";

  function isActiveInstance() {
    return document.documentElement.dataset.localfirstInstanceId === INSTANCE_ID;
  }

  const HOST_ID = "localfirst-paste-shield-host";
  const STORAGE_KEY_ENABLED = "shieldEnabled";
  const STORAGE_KEY_STATS = "shieldStats";
  const STORAGE_KEY_TARGET = "workbenchTarget";
  const STORAGE_KEY_LEVEL = "protectionLevel";
  const TARGET_URLS = {
    production: "https://para-1-2e22b.web.app/",
    local: "http://localhost:4173/",
  };

  const SEND_BUTTON_SELECTOR = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
    "button.send-button",
    'button[mattooltip*="Send" i]',
    'button[data-qa="texty_send_button"]',
    'button[type="submit"]',
  ].join(", ");

  let shieldEnabled = true;
  let workbenchTarget = "production";
  let protectionLevel = "medium";
  let isInjectingSafePaste = false;
  let activeHud = null;
  let typingDebounceTimer = null;
  let cooldownTimer = null;
  let lastNanoSweptText = "";

  function normalizeForDedup(s) {
    return (s || "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  }

  // Per-editor state machine: tracks last scrubbed/dismissed/bypassed text cleanly
  const editorStates = new WeakMap();

  function getEditorState(target) {
    if (!target) return null;
    let st = editorStates.get(target);
    if (!st) {
      st = {
        epoch: 0,
        cooldownUntil: 0,
        lastScrubbedText: null,
        lastDismissedText: null,
        bypassedText: null,
      };
      editorStates.set(target, st);
    }
    return st;
  }

  function hasValidExtensionContext() {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) && Boolean(chrome.storage?.local);
  }

  function loadInitialSettings() {
    if (!hasValidExtensionContext()) return;
    try {
      chrome.storage.local.get([STORAGE_KEY_ENABLED, STORAGE_KEY_TARGET, STORAGE_KEY_LEVEL], (res) => {
        if (!hasValidExtensionContext()) return;
        if (typeof res?.[STORAGE_KEY_ENABLED] === "boolean") {
          shieldEnabled = res[STORAGE_KEY_ENABLED];
        }
        if (res?.[STORAGE_KEY_TARGET] === "local" || res?.[STORAGE_KEY_TARGET] === "production") {
          workbenchTarget = res[STORAGE_KEY_TARGET];
        }
        if (["low", "medium", "high"].includes(res?.[STORAGE_KEY_LEVEL])) {
          protectionLevel = res[STORAGE_KEY_LEVEL];
        }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!hasValidExtensionContext() || area !== "local") return;
        if (changes[STORAGE_KEY_ENABLED] && typeof changes[STORAGE_KEY_ENABLED].newValue === "boolean") {
          shieldEnabled = changes[STORAGE_KEY_ENABLED].newValue;
        }
        if (changes[STORAGE_KEY_TARGET]) {
          const val = changes[STORAGE_KEY_TARGET].newValue;
          if (val === "local" || val === "production") workbenchTarget = val;
        }
        if (changes[STORAGE_KEY_LEVEL]) {
          const lvl = changes[STORAGE_KEY_LEVEL].newValue;
          if (lvl === "low" || lvl === "medium" || lvl === "high") protectionLevel = lvl;
        }
      });
    } catch {
      // Ignore storage init errors in restricted contexts
    }
  }

  function recordAggregateTelemetry(secretCount) {
    if (!hasValidExtensionContext()) return;
    try {
      chrome.storage.local.get([STORAGE_KEY_STATS], (res) => {
        if (!hasValidExtensionContext()) return;
        const prev = res?.[STORAGE_KEY_STATS] || {};
        const next = {
          totalBlockedPastes: (prev.totalBlockedPastes || 0) + 1,
          totalSecretsIntercepted: (prev.totalSecretsIntercepted || 0) + secretCount,
          lastSiteHost: window.location.hostname || "localhost",
          lastBlockedAt: new Date().toISOString(),
        };
        chrome.storage.local.set({ [STORAGE_KEY_STATS]: next });
      });
    } catch {
      // Never block user flow on telemetry
    }
  }

  function findEditableRootFromNode(node) {
    if (!node) return null;
    const el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || typeof el.closest !== "function") return null;
    const input = el.closest("textarea, input");
    if (input) {
      if (input.tagName === "TEXTAREA") return input;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      if (["text", "search", "url", "email", ""].includes(type)) return input;
    }
    if (el.isContentEditable) {
      let root = el;
      while (root.parentElement && root.parentElement.isContentEditable) {
        root = root.parentElement;
      }
      return root;
    }
    const editable = el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]');
    if (editable) return editable;
    return null;
  }

  function resolveEditableTarget(eventOrNode) {
    if (eventOrNode && typeof eventOrNode.composedPath === "function") {
      const path = eventOrNode.composedPath();
      for (const node of path) {
        const found = findEditableRootFromNode(node);
        if (found) return found;
      }
    }
    return (
      findEditableRootFromNode(eventOrNode?.target ?? eventOrNode) ||
      findEditableRootFromNode(document.activeElement) ||
      findEditableRootFromNode(window.getSelection?.()?.anchorNode)
    );
  }

  function captureSelection(target) {
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return {
        kind: "input",
        start: target.selectionStart ?? target.value.length,
        end: target.selectionEnd ?? target.value.length,
      };
    }
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    return { kind: "editable", range };
  }

  function getTargetText(target) {
    if (!target) return "";
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return target.value || "";
    }
    return target.innerText || target.textContent || "";
  }

  function releaseInjectingGuard(target, expectedSanitizedText) {
    clearTimeout(typingDebounceTimer);
    clearTimeout(cooldownTimer);
    isInjectingSafePaste = true;
    const st = getEditorState(target);
    if (st) {
      st.epoch++;
      st.cooldownUntil = Date.now() + 1500;
      st.lastScrubbedText = normalizeForDedup(getTargetText(target) || expectedSanitizedText);
    }
    setTimeout(() => {
      if (!isActiveInstance()) return;
      if (st) {
        st.lastScrubbedText = normalizeForDedup(getTargetText(target));
      }
    }, 250);
    cooldownTimer = setTimeout(() => {
      if (!isActiveInstance()) return;
      if (st) {
        st.lastScrubbedText = normalizeForDedup(getTargetText(target));
      }
      isInjectingSafePaste = false;
    }, 1500);
  }

  function insertSafeText(target, savedSel, text) {
    if (!target) return;
    isInjectingSafePaste = true;
    try {
      target.focus();
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
        const start = savedSel?.kind === "input" ? savedSel.start : target.value.length;
        const end = savedSel?.kind === "input" ? savedSel.end : target.value.length;
        const current = target.value;
        const nextVal = current.slice(0, start) + text + current.slice(end);
        const proto =
          target.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(target, nextVal);
        else target.value = nextVal;
        const caret = start + text.length;
        if (typeof target.setSelectionRange === "function") {
          target.setSelectionRange(caret, caret);
        }
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertFromPaste",
            data: text,
          }),
        );
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const sel = window.getSelection();
        if (sel && savedSel?.kind === "editable" && savedSel.range) {
          sel.removeAllRanges();
          sel.addRange(savedSel.range);
        }
        let inserted = false;
        try {
          inserted = document.execCommand("insertText", false, text);
        } catch {
          inserted = false;
        }
        if (!inserted) {
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            target.textContent = (target.textContent || "") + text;
          }
          target.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              inputType: "insertFromPaste",
              data: text,
            }),
          );
        }
      }
    } finally {
      releaseInjectingGuard(target, text);
    }
  }

  function replaceTargetText(target, nextText, maskedSpans = []) {
    if (!target) return;
    isInjectingSafePaste = true;
    try {
      target.focus();
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
        const proto =
          target.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(target, nextText);
        else target.value = nextText;
        const caret = nextText.length;
        if (typeof target.setSelectionRange === "function") {
          target.setSelectionRange(caret, caret);
        }
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertReplacementText",
            data: nextText,
          }),
        );
        target.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(target);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        let replaced = false;
        try {
          replaced = document.execCommand("insertText", false, nextText);
        } catch {
          replaced = false;
        }
        const postNorm = normalizeForDedup(getTargetText(target));
        const leakedSecret = maskedSpans.some(
          (s) => s.matchedText && postNorm.includes(normalizeForDedup(s.matchedText)),
        );
        if (!replaced || leakedSecret || !postNorm) {
          target.textContent = nextText;
          target.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              inputType: "insertReplacementText",
              data: nextText,
            }),
          );
        }
      }
    } finally {
      releaseInjectingGuard(target, nextText);
    }
  }

  const CATEGORY_LABELS = {
    AWS_ACCESS_KEY: "AWS Key",
    API_KEY: "API Key",
    BEARER_OR_JWT: "JWT / Token",
    PEM_PRIVATE_KEY: "Private Key",
    DB_CONNECTION_URI: "DB URI",
    CREDIT_CARD: "Credit Card",
    US_SSN: "SSN",
    EMAIL: "Email",
    PHONE: "Phone",
    GOV_ID: "Gov ID",
    PERSON: "Person Name",
    ORG_TERM: "Company / Org",
    ADDRESS: "Address",
    CONTEXTUAL_PHI: "Medical Info",
    M_AND_A_SECRET: "M&A Secret",
    NATURAL_SECRET: "Private Note",
    PERSONAL_PII_LOCATION: "Personal Location",
    HIGH_ENTROPY_SECRET: "High-Entropy",
  };

  function destroyHud() {
    if (activeHud?.cleanup) {
      activeHud.cleanup();
    }
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();
    activeHud = null;
  }

  function showShieldHud({ target, savedSel, rawText, initialScan, mode = "paste", trigger = mode }) {
    if (!isActiveInstance()) return;
    const hudVisible = Boolean(activeHud && document.getElementById(HOST_ID));
    // Hard re-entry gate: never spawn a second HUD or re-animate while visible unless upgrading to SEND_BLOCKED
    if (hudVisible) {
      if (trigger === "SEND_BLOCKED" && activeHud.mode !== "send") {
        destroyHud();
      } else {
        if (activeHud.target === target && activeHud.rawText === rawText) {
          activeHud.updateScan(initialScan);
        }
        return;
      }
    }

    const st = getEditorState(target);
    console.debug("[LocalFirst]", {
      trigger,
      epoch: st?.epoch ?? 0,
      masks: initialScan?.mergedSpans?.length ?? 0,
      preview: (rawText || "").slice(0, 40),
    });

    destroyHud();

    let currentScan = initialScan;
    let bypassArmed = false;

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 32px);width:400px;pointer-events:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .lf-hud {
        background: #0B0C10;
        color: #F8FAFC;
        border: 1px solid rgba(148,163,184,0.28);
        border-radius: 14px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,229,163,0.12);
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.45;
        animation: lfPop 180ms cubic-bezier(0.23,1,0.32,1);
      }
      @keyframes lfPop {
        from { opacity: 0; transform: translateY(10px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .lf-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .lf-title { display:flex; align-items:center; gap:8px; font-weight:700; font-size:13px; color:#F8FAFC; }
      .lf-sub { font-size:11px; color:#94A3B8; margin-top:2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .lf-risk { font-family: ui-monospace, Menlo, monospace; font-size:10px; font-weight:700; padding:2px 7px; border-radius:6px; border:1px solid; }
      .lf-risk-CRITICAL, .lf-risk-HIGH { background:rgba(255,77,90,0.14); border-color:rgba(255,77,90,0.45); color:#FF4D5A; }
      .lf-risk-ELEVATED { background:rgba(245,158,11,0.14); border-color:rgba(245,158,11,0.45); color:#FBBF24; }
      .lf-risk-LOW { background:rgba(0,229,163,0.12); border-color:rgba(0,229,163,0.4); color:#00E5A3; }
      .lf-chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; }
      .lf-chip { font-size:10px; font-weight:600; padding:2px 7px; border-radius:5px; background:rgba(255,77,90,0.12); border:1px solid rgba(255,77,90,0.35); color:#FF6B76; }
      .lf-chip-nano { background:rgba(56,189,248,0.12); border-color:rgba(56,189,248,0.38); color:#38BDF8; }
      .lf-preview { margin-top:9px; background:#07090D; border:1px solid rgba(148,163,184,0.16); border-radius:8px; padding:8px 10px; font-family: ui-monospace, Menlo, monospace; font-size:11px; color:#00E5A3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lf-actions { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:11px; }
      .lf-btn { cursor:pointer; border-radius:8px; font-size:11.5px; font-weight:600; padding:7px 11px; border:1px solid transparent; transition: opacity 140ms, transform 120ms; }
      .lf-btn:active { transform: scale(0.97); }
      .lf-btn-primary { background:#00E5A3; color:#07090D; }
      .lf-btn-secondary { background:#191C26; color:#E2E8F0; border-color:rgba(148,163,184,0.24); }
      .lf-btn-ghost { background:transparent; color:#94A3B8; padding:7px 8px; }
      .lf-bypass { background:transparent; border:none; color:#64748B; font-size:10.5px; cursor:pointer; margin-top:8px; padding:0; text-decoration:underline; }
      .lf-bypass-armed { color:#FF4D5A; font-weight:600; }
      .lf-toast { display:flex; align-items:center; gap:8px; font-weight:700; color:#00E5A3; font-size:12.5px; }
    `;

    const card = document.createElement("div");
    card.className = "lf-hud";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "LocalFirst Paste Shield");

    const render = () => {
      const count = currentScan.mergedSpans.length;
      const risk = currentScan.riskProfile || { score: 0, tier: "LOW" };
      const hostName = window.location.hostname || "this page";
      const uniqueCategories = Array.from(
        new Set(currentScan.mergedSpans.map((s) => s.category)),
      ).slice(0, 6);

      const levelBadge =
        protectionLevel === "high"
          ? "HIGH · NANO 4"
          : `${protectionLevel.toUpperCase()} SHIELD`;

      const headlineText =
        mode === "send"
          ? `Send Intercepted — ${count} secret${count === 1 ? "" : "s"} detected`
          : mode === "draft"
            ? `Detected ${count} secret${count === 1 ? "" : "s"} in draft — Scrub Before Sending?`
            : `Blocked ${count} secret${count === 1 ? "" : "s"} locally`;

      const primaryBtnText =
        mode === "send"
          ? "Scrub & Replace"
          : mode === "draft"
            ? "Scrub Draft Now"
            : "Paste Safe Version";

      const bypassBtnText =
        mode === "send" || mode === "draft"
          ? bypassArmed
            ? "Confirm send raw once? (unsafe)"
            : "Send Raw Once (Unsafe)"
          : bypassArmed
            ? "Confirm raw paste? (unsafe)"
            : "Bypass once (unsafe)";

      card.innerHTML = `
        <div class="lf-row">
          <div class="lf-title">
            <svg viewBox="0 0 32 32" width="20" height="20" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0B0C10"/>
              <path d="M5.5 8.5a2.5 2.5 0 0 1 2.5-2.5h5.2v20H8a2.5 2.5 0 0 1-2.5-2.5v-15Z" fill="#F8FAFC"/>
              <rect x="15.25" y="4.5" width="1.5" height="23" rx="0.75" fill="#00E5A3"/>
              <path d="M19.2 6.8h4.8a2 2 0 0 1 2 2v14.4a2 2 0 0 1-2 2h-4.8V6.8Z" stroke="#F8FAFC" stroke-width="1.9"/>
            </svg>
            <span id="lf-headline">${headlineText}</span>
          </div>
          <span class="lf-risk lf-risk-${risk.tier}">${levelBadge} · ${risk.tier}</span>
        </div>
        <div class="lf-sub" id="lf-subline">On-Device · 0 bytes sent to ${hostName}</div>
        <div class="lf-chips" id="lf-chips"></div>
        <div class="lf-preview" id="lf-preview"></div>
        <div class="lf-actions">
          <button type="button" class="lf-btn lf-btn-primary" id="lf-paste-safe">${primaryBtnText}</button>
          <button type="button" class="lf-btn lf-btn-secondary" id="lf-open-wb">Open in Workbench →</button>
          <button type="button" class="lf-btn lf-btn-ghost" id="lf-cancel">Cancel</button>
        </div>
        <div>
          <button type="button" class="lf-bypass ${bypassArmed ? "lf-bypass-armed" : ""}" id="lf-bypass">
            ${bypassBtnText}
          </button>
        </div>
      `;

      const chipsEl = card.querySelector("#lf-chips");
      for (const cat of uniqueCategories) {
        const spanEl = document.createElement("span");
        const isNano = currentScan.mergedSpans.some(
          (s) => s.category === cat && s.detector === "NANO_SEMANTIC_FIREWALL",
        );
        spanEl.className = `lf-chip ${isNano ? "lf-chip-nano" : ""}`;
        spanEl.textContent = CATEGORY_LABELS[cat] || cat;
        chipsEl.appendChild(spanEl);
      }

      const previewEl = card.querySelector("#lf-preview");
      previewEl.textContent = currentScan.sanitizedText.slice(0, 120);

      card.querySelector("#lf-paste-safe").addEventListener("click", handlePasteSafe);
      card.querySelector("#lf-open-wb").addEventListener("click", handleOpenWorkbench);
      card.querySelector("#lf-cancel").addEventListener("click", handleCancel);
      card.querySelector("#lf-bypass").addEventListener("click", handleBypass);
    };

    const handlePasteSafe = () => {
      clearTimeout(typingDebounceTimer);
      const st = getEditorState(target);
      if (st) st.epoch++;
      if (mode === "draft" || mode === "send") {
        replaceTargetText(target, currentScan.sanitizedText, currentScan.mergedSpans);
        recordAggregateTelemetry(currentScan.mergedSpans.length);
      } else {
        insertSafeText(target, savedSel, currentScan.sanitizedText);
      }
      destroyHud();
    };

    const handleOpenWorkbench = () => {
      const fw = globalThis.LocalFirstFirewall;
      const baseUrl = TARGET_URLS[workbenchTarget] || TARGET_URLS.production;
      const url = fw.buildSanitizedHandoffUrl(
        `Paste Shield (${window.location.hostname || "web"})`,
        currentScan.sanitizedText,
        baseUrl,
      );
      window.open(url, "_blank", "noopener,noreferrer");
      destroyHud();
    };

    const handleCancel = () => {
      const st = getEditorState(target);
      if (st) {
        st.epoch++;
        if (mode === "draft" || mode === "send") {
          st.lastDismissedText = normalizeForDedup(rawText);
        }
      }
      destroyHud();
    };

    const handleBypass = () => {
      if (!bypassArmed) {
        bypassArmed = true;
        render();
        return;
      }
      const st = getEditorState(target);
      if (st) st.epoch++;
      if (mode === "draft" || mode === "send") {
        if (st) st.bypassedText = normalizeForDedup(rawText);
      } else {
        insertSafeText(target, savedSel, rawText);
      }
      destroyHud();
    };

    const onKeyDown = (e) => {
      if (!document.getElementById(HOST_ID)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handlePasteSafe();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    activeHud = {
      target,
      rawText,
      mode,
      updateScan: (nextScan) => {
        currentScan = nextScan;
        render();
      },
      cleanup: () => document.removeEventListener("keydown", onKeyDown, true),
    };

    render();
    shadow.appendChild(style);
    shadow.appendChild(card);
    document.documentElement.appendChild(host);

    // Optional non-blocking Nano 4 live refinement on paste
    const fw = globalThis.LocalFirstFirewall;
    const pasteEpoch = st?.epoch ?? 0;
    if (mode === "paste" && fw?.runExtensionNanoScan && typeof globalThis.LanguageModel !== "undefined") {
      void fw.runExtensionNanoScan(rawText, { timeoutMs: 3500 }).then((nanoRes) => {
        if (!isActiveInstance() || !document.getElementById(HOST_ID)) return;
        if (st && (st.epoch !== pasteEpoch || Date.now() < st.cooldownUntil)) return;
        if (nanoRes.nanoActive && nanoRes.mergedSpans.length > currentScan.mergedSpans.length) {
          const extra = nanoRes.mergedSpans.length - currentScan.mergedSpans.length;
          currentScan = nanoRes;
          render();
          const sub = card.querySelector("#lf-subline");
          if (sub) {
            sub.textContent = `On-Device · +${extra} Nano 4 semantic catches · 0 bytes sent`;
          }
        }
      });
    }
  }

  function onPaste(event) {
    if (!isActiveInstance() || !shieldEnabled || isInjectingSafePaste) return;
    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.scrubSync) return;

    const target = resolveEditableTarget(event);
    if (!target) return;

    const rawText = event.clipboardData?.getData("text/plain") || "";
    if (!rawText) return;

    const st = getEditorState(target);
    if (st) st.epoch++;

    const scan = fw.scrubSync(rawText, true, protectionLevel);
    if (scan.mergedSpans.length === 0) {
      return; // Benign paste: 0ms friction
    }

    // Intercept immediately BEFORE React/ProseMirror/Quill/Lexical sees a single byte
    event.preventDefault();
    event.stopImmediatePropagation();
    clearTimeout(typingDebounceTimer);

    const savedSel = captureSelection(target);
    recordAggregateTelemetry(scan.mergedSpans.length);
    showShieldHud({ target, savedSel, rawText, initialScan: scan, mode: "paste", trigger: "PASTE_BLOCKED" });
  }

  function evaluateDraftTarget(target, mode = "draft") {
    if (!isActiveInstance() || isInjectingSafePaste) return false;
    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.scrubSync || !target) return false;
    const text = getTargetText(target);
    const normText = normalizeForDedup(text);
    if (!normText) return false;

    const st = getEditorState(target);
    if (st) {
      if (Date.now() < st.cooldownUntil) return false;
      if (normText === st.lastScrubbedText) return false;
      if (normText === st.bypassedText) return false;
      if (mode === "draft" && normText === st.lastDismissedText) return false;
    }

    const scan = fw.scrubSync(text, true, protectionLevel);
    if (scan.mergedSpans.length >= 1) {
      showShieldHud({
        target,
        savedSel: null,
        rawText: text,
        initialScan: scan,
        mode,
        trigger: mode === "send" ? "SEND_BLOCKED" : "TYPING_PAUSE",
      });
      return true;
    }

    if (activeHud && activeHud.target === target) {
      destroyHud();
    }

    // In HIGH protection mode, run always-on Nano 4 semantic PII sweep on drafts >= 20 chars
    // Never run Nano 4 on text that already contains [REDACTED: unless new unscrubbed chars were typed after scrubbing
    const hasUnscrubbedDelta =
      !text.includes("[REDACTED:") || Boolean(st?.lastScrubbedText && normText !== st.lastScrubbedText);
    if (
      mode === "draft" &&
      protectionLevel === "high" &&
      hasUnscrubbedDelta &&
      text.length >= 20 &&
      normText !== lastNanoSweptText &&
      typeof globalThis.LanguageModel !== "undefined" &&
      fw.runExtensionNanoScan
    ) {
      lastNanoSweptText = normText;
      const myEpoch = st ? st.epoch : 0;
      void fw.runExtensionNanoScan(text, { timeoutMs: 4000 }).then((nanoRes) => {
        if (!isActiveInstance() || isInjectingSafePaste) return;
        if (st && (myEpoch !== st.epoch || Date.now() < st.cooldownUntil)) return;
        if (st && (normText === st.lastScrubbedText || normText === st.lastDismissedText || normText === st.bypassedText)) return;
        if (normalizeForDedup(getTargetText(target)) !== normText) return;
        if (nanoRes?.mergedSpans?.length >= 1) {
          showShieldHud({
            target,
            savedSel: null,
            rawText: text,
            initialScan: nanoRes,
            mode: "draft",
            trigger: "NANO_ASYNC_SWEEP",
          });
        }
      });
    }
    return false;
  }

  function onInput(event) {
    if (!isActiveInstance() || !shieldEnabled || isInjectingSafePaste || protectionLevel === "low") return;
    const target = resolveEditableTarget(event);
    if (!target) return;
    const st = getEditorState(target);
    if (st) {
      if (Date.now() < st.cooldownUntil) return;
      st.epoch++;
    }
    clearTimeout(typingDebounceTimer);
    typingDebounceTimer = setTimeout(() => {
      if (!isActiveInstance()) return;
      evaluateDraftTarget(target, "draft");
    }, 1100);
  }

  function onSubmitKeyDown(event) {
    if (!isActiveInstance() || !shieldEnabled || isInjectingSafePaste || protectionLevel === "low") return;
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (document.getElementById(HOST_ID)) return;
    const target = resolveEditableTarget(event);
    if (!target || target.tagName === "TEXTAREA") return;
    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.scrubSync) return;
    const text = getTargetText(target);
    const normText = normalizeForDedup(text);
    if (!normText) return;
    const st = getEditorState(target);
    if (st && (Date.now() < st.cooldownUntil || normText === st.lastScrubbedText || normText === st.bypassedText)) return;
    const scan = fw.scrubSync(text, true, protectionLevel);
    if (scan.mergedSpans.length >= 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearTimeout(typingDebounceTimer);
      showShieldHud({
        target,
        savedSel: null,
        rawText: text,
        initialScan: scan,
        mode: "send",
        trigger: "SEND_BLOCKED",
      });
    }
  }

  function onSendButtonAttempt(event) {
    if (!isActiveInstance() || !shieldEnabled || isInjectingSafePaste || protectionLevel === "low") return;
    const el = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    if (!el || typeof el.closest !== "function") return;
    if (el.closest(`#${HOST_ID}`)) return;
    const sendBtn = el.closest(SEND_BUTTON_SELECTOR);
    if (!sendBtn) return;

    const target =
      resolveEditableTarget(document.activeElement) ||
      document.querySelector('[contenteditable="true"], [role="textbox"], textarea');
    if (!target) return;

    const text = getTargetText(target);
    const normText = normalizeForDedup(text);
    if (!normText) return;
    const st = getEditorState(target);
    if (st && (Date.now() < st.cooldownUntil || normText === st.lastScrubbedText || normText === st.bypassedText)) return;

    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.scrubSync) return;
    const scan = fw.scrubSync(text, true, protectionLevel);
    if (scan.mergedSpans.length >= 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearTimeout(typingDebounceTimer);
      showShieldHud({
        target,
        savedSel: null,
        rawText: text,
        initialScan: scan,
        mode: "send",
        trigger: "SEND_BLOCKED",
      });
    }
  }

  loadInitialSettings();
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("keydown", onSubmitKeyDown, true);
  document.addEventListener("pointerdown", onSendButtonAttempt, true);
  document.addEventListener("click", onSendButtonAttempt, true);

  if (document.documentElement) {
    document.documentElement.dataset.localfirstShield = "armed";
  }
})();
