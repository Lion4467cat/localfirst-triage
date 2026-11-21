(function () {
  "use strict";

  const HOST_ID = "localfirst-paste-shield-host";
  const STORAGE_KEY_ENABLED = "shieldEnabled";
  const STORAGE_KEY_STATS = "shieldStats";
  const STORAGE_KEY_TARGET = "workbenchTarget";
  const TARGET_URLS = {
    production: "https://para-1-2e22b.web.app/",
    local: "http://localhost:4173/",
  };

  let shieldEnabled = true;
  let workbenchTarget = "production";
  let isInjectingSafePaste = false;
  let activeHud = null;
  let typingDebounceTimer = null;
  let bypassedDraftText = null;

  function loadInitialSettings() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    try {
      chrome.storage.local.get([STORAGE_KEY_ENABLED, STORAGE_KEY_TARGET], (res) => {
        if (typeof res?.[STORAGE_KEY_ENABLED] === "boolean") {
          shieldEnabled = res[STORAGE_KEY_ENABLED];
        }
        if (res?.[STORAGE_KEY_TARGET] === "local" || res?.[STORAGE_KEY_TARGET] === "production") {
          workbenchTarget = res[STORAGE_KEY_TARGET];
        }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[STORAGE_KEY_ENABLED] && typeof changes[STORAGE_KEY_ENABLED].newValue === "boolean") {
          shieldEnabled = changes[STORAGE_KEY_ENABLED].newValue;
        }
        if (changes[STORAGE_KEY_TARGET]) {
          const val = changes[STORAGE_KEY_TARGET].newValue;
          if (val === "local" || val === "production") workbenchTarget = val;
        }
      });
    } catch {
      // Ignore storage init errors in restricted contexts
    }
  }

  function recordAggregateTelemetry(secretCount) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    try {
      chrome.storage.local.get([STORAGE_KEY_STATS], (res) => {
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

  function resolveEditableTarget(node) {
    if (!node) return null;
    const el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || typeof el.closest !== "function") return null;
    const input = el.closest("textarea, input");
    if (input) {
      if (input.tagName === "TEXTAREA") return input;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      if (["text", "search", "url", "email", ""].includes(type)) return input;
    }
    const editable = el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]');
    if (editable) return editable;
    if (document.activeElement && document.activeElement !== document.body) {
      const active = document.activeElement;
      if (
        active.tagName === "TEXTAREA" ||
        active.getAttribute("contenteditable") === "true" ||
        active.getAttribute("contenteditable") === "" ||
        active.getAttribute("role") === "textbox"
      ) {
        return active;
      }
    }
    return null;
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
        if (setter) {
          setter.call(target, nextVal);
        } else {
          target.value = nextVal;
        }
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
      isInjectingSafePaste = false;
    }
  }

  function getTargetText(target) {
    if (!target) return "";
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return target.value || "";
    }
    return target.innerText || target.textContent || "";
  }

  function replaceTargetText(target, nextText) {
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
        if (!replaced) {
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
      isInjectingSafePaste = false;
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
    PERSON: "Person Name",
    ORG_TERM: "Company / Org",
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

  function showShieldHud({ target, savedSel, rawText, initialScan, mode = "paste" }) {
    destroyHud();

    let currentScan = initialScan;
    let bypassArmed = false;
    const isDraftMode = mode === "draft";

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 32px);width:400px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
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

      const headlineText = isDraftMode
        ? `Detected ${count} secret${count === 1 ? "" : "s"} in draft — Scrub Before Sending?`
        : `Blocked ${count} secret${count === 1 ? "" : "s"} locally`;
      const primaryBtnText = isDraftMode ? "Scrub Draft Now" : "Paste Safe Version";
      const bypassBtnText = isDraftMode
        ? bypassArmed
          ? "Confirm send anyway? (unsafe)"
          : "Send Anyway (Unsafe)"
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
          <span class="lf-risk lf-risk-${risk.tier}">${risk.tier}</span>
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
      card.querySelector("#lf-cancel").addEventListener("click", destroyHud);
      card.querySelector("#lf-bypass").addEventListener("click", handleBypass);
    };

    const handlePasteSafe = () => {
      if (isDraftMode) {
        replaceTargetText(target, currentScan.sanitizedText);
        recordAggregateTelemetry(currentScan.mergedSpans.length);
      } else {
        insertSafeText(target, savedSel, currentScan.sanitizedText);
      }
      card.innerHTML = `
        <div class="lf-toast">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
          <span>${isDraftMode ? "Safe draft scrubbed · 0 leaked" : "Safe text pasted · 0 leaked"}</span>
        </div>
      `;
      setTimeout(destroyHud, 1500);
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

    const handleBypass = () => {
      if (!bypassArmed) {
        bypassArmed = true;
        render();
        return;
      }
      if (isDraftMode) {
        bypassedDraftText = rawText;
      } else {
        insertSafeText(target, savedSel, rawText);
      }
      destroyHud();
    };

    const onKeyDown = (e) => {
      if (!document.getElementById(HOST_ID)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        destroyHud();
      } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handlePasteSafe();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    activeHud = {
      cleanup: () => document.removeEventListener("keydown", onKeyDown, true),
    };

    render();
    shadow.appendChild(style);
    shadow.appendChild(card);
    (document.body || document.documentElement).appendChild(host);

    // Optional non-blocking Nano 4 live refinement
    const fw = globalThis.LocalFirstFirewall;
    if (fw?.runExtensionNanoScan && typeof globalThis.LanguageModel !== "undefined") {
      void fw.runExtensionNanoScan(rawText, { timeoutMs: 3500 }).then((nanoRes) => {
        if (!document.getElementById(HOST_ID)) return;
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
    if (!shieldEnabled || isInjectingSafePaste) return;
    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.scrubSync) return;

    const target = resolveEditableTarget(event.target);
    if (!target) return;

    const rawText = event.clipboardData?.getData("text/plain") || "";
    if (!rawText) return;

    const scan = fw.scrubSync(rawText, true);
    if (scan.mergedSpans.length === 0) {
      return; // Benign paste: 0ms friction
    }

    // Intercept immediately BEFORE React/ProseMirror/Quill/Lexical sees a single byte
    event.preventDefault();
    event.stopImmediatePropagation();

    const savedSel = captureSelection(target);
    recordAggregateTelemetry(scan.mergedSpans.length);
    showShieldHud({ target, savedSel, rawText, initialScan: scan });
  }

  function onInput(event) {
    if (!shieldEnabled || isInjectingSafePaste) return;
    const target = resolveEditableTarget(event.target);
    if (!target) return;
    clearTimeout(typingDebounceTimer);
    typingDebounceTimer = setTimeout(() => {
      const fw = globalThis.LocalFirstFirewall;
      if (!fw?.scrubSync) return;
      const text = getTargetText(target);
      if (!text.trim() || text === bypassedDraftText) return;
      const scan = fw.scrubSync(text, true);
      if (scan.mergedSpans.length >= 1) {
        showShieldHud({
          target,
          savedSel: null,
          rawText: text,
          initialScan: scan,
          mode: "draft",
        });
      }
    }, 450);
  }

  function onSubmitKeyDown(event) {
    if (!shieldEnabled || isInjectingSafePaste) return;
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (document.getElementById(HOST_ID)) return;
    const target = resolveEditableTarget(event.target);
    if (!target || target.tagName === "TEXTAREA") return;
    const fw = globalThis.LocalFirstFirewall;
    if (!fw?.scrubSync) return;
    const text = getTargetText(target);
    if (!text.trim() || text === bypassedDraftText) return;
    const scan = fw.scrubSync(text, true);
    if (scan.mergedSpans.length >= 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showShieldHud({
        target,
        savedSel: null,
        rawText: text,
        initialScan: scan,
        mode: "draft",
      });
    }
  }

  loadInitialSettings();
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("keydown", onSubmitKeyDown, true);
})();
