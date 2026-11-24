import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeHandoffPayload, scanAndRedactLocal } from "../src/firewall/regexScrubber";
import { verifyZeroLeakage } from "../src/firewall/spanMerger";
import { checkChromeNanoAvailability } from "../src/firewall/nanoExtractor";
import { escalateApprovedTicket, generateSanitizedHybridBrief, runTriagePipeline } from "../src/firewall/pipeline";
import {
  buildSanitizedHandoffUrl,
  runExtensionNanoScan,
  scrubSync,
} from "../extension/sidepanel/firewall-core.js";

const HOST_ID = "localfirst-paste-shield-host";
const STRIPE_SECRET = ["sk_", "live_", "51NxMockSecret9988776655"].join("");
const AWS_KEY = ["AK", "IAIOSFODNN7EXAMPLE"].join("");

describe("v4.6.2 Hardening: Obfuscation Parity, 20k+ Boundary, Rapid Paste-Send & Handoff Guards", () => {
  describe("PII engine obfuscation parity & 20k+ boundary safety", () => {
    it("strips zero-width chars, soft hyphens, and non-breaking spaces across Web and Extension engines", () => {
      const zwsp = "\u200B";
      const zwnj = "\u200C";
      const zwj = "\u200D";
      const bom = "\uFEFF";
      const shy = "\u00AD";
      const nbsp = "\u00A0";

      const obfPayload = [
        `Prefix ok | stripe=sk_${zwsp}live_${shy}51NxMock${zwnj}Secret9988776655 | aws=AKIA${zwj}IOSFODNN7${bom}EXAMPLE`,
        `card 4111${nbsp}1111${zwsp}1111${shy}1111 exp${nbsp}09/${zwsp}29 cvv${nbsp}1${zwj}23`,
        `pan ABC${zwsp}PE12${shy}34F | ifsc HDFC${zwnj}0${shy}001234 | upi ravi.${zwsp}kumar@ok${shy}sbi`,
        `address${nbsp}143/A,${nbsp}2nd${zwsp} Cross, Indiranagar,${nbsp}Bengaluru 560${shy}038 | Suffix ok.`,
      ].join("\n");

      const webRes = scanAndRedactLocal(obfPayload, {
        protectionLevel: "medium",
        includeHeuristics: true,
        enableEntropyScanner: true,
      });
      const extRes = scrubSync(obfPayload, true, "medium");

      for (const [name, res] of [
        ["web", webRes],
        ["extension", extRes],
      ] as const) {
        const cats = new Set(res.mergedSpans.map((s: { category: string }) => s.category));
        for (const expected of [
          "API_KEY",
          "AWS_ACCESS_KEY",
          "CREDIT_CARD",
          "CARD_EXPIRY",
          "CVV",
          "PAN_ID",
          "IFSC",
          "UPI_ID",
          "ADDRESS",
        ]) {
          expect(cats.has(expected), `${name} missed ${expected} (got ${[...cats].join(",")})`).toBe(true);
        }
        expect(res.sanitizedText).toContain("Prefix ok |");
        expect(res.sanitizedText).toContain("| Suffix ok.");
        expect(res.sanitizedText).not.toContain("51NxMock");
        expect(res.sanitizedText).not.toContain("IOSFODNN7");
        expect(res.sanitizedText).not.toContain("4111");
        expect(res.sanitizedText).not.toContain("PE12");
        expect(res.sanitizedText).not.toContain("001234");
        expect(res.sanitizedText).not.toContain("oksbi");
        expect(res.sanitizedText).not.toContain("Indiranagar");
      }

      // 3-pass idempotency on obfuscated output
      expect(scanAndRedactLocal(webRes.sanitizedText, { includeHeuristics: true }).sanitizedText).toBe(
        webRes.sanitizedText,
      );
      expect(scrubSync(extRes.sanitizedText, true, "medium").sanitizedText).toBe(extRes.sanitizedText);
      expect(verifyZeroLeakage(webRes.sanitizedText, webRes.mergedSpans).verified).toBe(true);
    });

    it("processes 25,000+ char pastes with overlapping spans quickly and blocks raw credential guards", () => {
      const filler = "2026-11-24T12:00:00Z INFO api-worker status=200 path=/v1/health latency=3ms\n".repeat(340);
      const largePaste = `${filler}\nCustomer Priya Sharma at address 143/A, 2nd Cross, Indiranagar, Bengaluru 560038 leaked ${AWS_KEY} and card 4111\u00A01111\u200B1111 1111.\n${filler.slice(0, 3000)}`;
      expect(largePaste.length).toBeGreaterThan(25_000);

      const t0 = performance.now();
      const webRes = scanAndRedactLocal(largePaste, {
        includeHeuristics: true,
        customTerms: ["Indiranagar", "Bengaluru 560038"],
      });
      const extRes = scrubSync(largePaste, true, "medium");
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(200);
      expect(webRes.sanitizedText).not.toContain(AWS_KEY);
      expect(extRes.sanitizedText).not.toContain(AWS_KEY);
      expect(verifyZeroLeakage(webRes.sanitizedText, webRes.mergedSpans).verified).toBe(true);

      // Even if spans=[] is passed, RAW_CREDENTIAL_GUARDS catches raw credentials (including zero-width obfuscated)
      const unmaskedAudit = verifyZeroLeakage(`Prompt with AKIA\u200BIOSFODNN7EXAMPLE`, []);
      expect(unmaskedAudit.verified).toBe(false);
      expect(unmaskedAudit.leakedCategories).toContain("RAW_CREDENTIAL_PATTERN");
    });
  });

  describe("Fail-closed #handoff= URL parsing, timeouts & malformed JSON guards", () => {
    it("scrubs raw heuristic PII and secrets in BOTH title and body of crafted #handoff= hashes", () => {
      const crafted = JSON.stringify({
        title: `Incident for Priya Sharma (${STRIPE_SECRET})`,
        sanitizedText:
          "Customer daughter admitted to Manipal ICU Floor 3. Address: 143/A, 2nd Cross, Indiranagar, Bengaluru 560038. Deal Project-Apollo at $42M valuation.",
      });
      const encoded = encodeURIComponent(Buffer.from(crafted, "utf8").toString("base64"));
      const decoded = decodeHandoffPayload(`#handoff=${encoded}`);

      expect(decoded).not.toBeNull();
      expect(decoded?.title).not.toContain(STRIPE_SECRET);
      expect(decoded?.title).toContain("[REDACTED:API_KEY_");
      expect(decoded?.sanitizedText).not.toContain("Manipal ICU Floor 3");
      expect(decoded?.sanitizedText).not.toContain("Indiranagar");
      expect(decoded?.sanitizedText).not.toContain("Project-Apollo");
      expect(decoded?.sanitizedText).not.toContain("$42M valuation");

      // Extension-side builder also scrubs raw title secrets before building #handoff=
      const builtUrl = buildSanitizedHandoffUrl(`Key ${AWS_KEY}`, `Body ${STRIPE_SECRET}`);
      expect(builtUrl).not.toContain(AWS_KEY);
      expect(builtUrl).not.toContain(STRIPE_SECRET);
      const roundTrip = decodeHandoffPayload(builtUrl.slice(builtUrl.indexOf("#")));
      expect(roundTrip?.title).not.toContain(AWS_KEY);
      expect(roundTrip?.sanitizedText).not.toContain(STRIPE_SECRET);

      // Reject JSON arrays/primitives/broken encodings cleanly
      const arrayB64 = Buffer.from("[1,2,3]", "utf8").toString("base64url");
      expect(decodeHandoffPayload(`#handoff=${arrayB64}`)).toBeNull();
      expect(decodeHandoffPayload("#handoff=%E0%A4%A")).toBeNull();
    });

    it("times out hanging cloud, brief, and availability calls cleanly and survives malformed Nano JSON", async () => {
      const ticket = await runTriagePipeline(
        { id: "t-hang", title: "Hang Test", rawText: `P0 outage ${AWS_KEY}`, offlineMode: false },
        {
          extractWithNano: async () => ({
            nanoStatus: "UNAVAILABLE",
            inferenceSource: "LOCAL_REGEX_FALLBACK",
            severity: "P0",
            runbookId: null,
            category: "OUTAGE",
            spans: [],
          }),
        },
      );

      const hungEscalation = await escalateApprovedTicket(ticket, ticket.spans, {
        bypassCache: true,
        cloudTimeoutMs: 40,
        loadConfig: async () => ({
          cloudModel: "gemini-3.5-flash-lite",
          cloudFallbackModel: "gemini-3.8-flash",
          enableCloudEscalation: true,
        }),
        callCloud: () => new Promise(() => {}),
      });
      expect(hungEscalation.resolutionMode).toBe("CLOUD_ERROR");
      expect(hungEscalation.cloudError).toMatch(/timed out/i);

      const hungBrief = await generateSanitizedHybridBrief(ticket, {
        offlineMode: false,
        timeoutMs: 40,
        deps: {
          loadConfig: async () => ({
            cloudModel: "gemini-3.5-flash-lite",
            cloudFallbackModel: "gemini-3.8-flash",
            enableCloudEscalation: true,
          }),
          callHybridBrief: () => new Promise(() => {}),
          callCloud: () => new Promise(() => {}),
        },
      });
      expect(hungBrief.inferenceSource).toBe("LOCAL_FALLBACK");

      const prevLM = (globalThis as Record<string, unknown>).LanguageModel;
      try {
        (globalThis as Record<string, unknown>).LanguageModel = {
          availability: () => new Promise(() => {}),
        };
        expect(await checkChromeNanoAvailability(35)).toBe("no");

        // Malformed non-array entities object in extension Nano output must fall back without TypeError
        (globalThis as Record<string, unknown>).LanguageModel = {
          availability: async () => "available",
          create: async () => ({
            prompt: async () => '{"entities":{"type":"PHI","value":"ICU"},}',
            destroy: () => {},
          }),
        };
        const extScan = await runExtensionNanoScan(`Leak ${STRIPE_SECRET}`, {
          timeoutMs: 250,
          protectionLevel: "high",
        });
        expect(extScan.sanitizedText).not.toContain(STRIPE_SECRET);
      } finally {
        (globalThis as Record<string, unknown>).LanguageModel = prevLM;
      }
    });
  });

  describe("content-shield <50ms rapid paste-then-Enter/Send & modal double-submit guards", () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      vi.resetModules();
      document.body.innerHTML = "";
      document.getElementById(HOST_ID)?.remove();
      await import("../extension/sidepanel/firewall-core.js");
      await import("../extension/content-shield.js");
    });

    afterEach(() => {
      vi.useRealTimers();
      document.getElementById(HOST_ID)?.remove();
      document.body.innerHTML = "";
    });

    it("intercepts <50ms paste-then-immediate-Enter in contenteditable BEFORE async DOM commit", () => {
      document.body.innerHTML = `
        <div id="ce" contenteditable="true" role="textbox"></div>
        <button id="send" type="button" aria-label="Send message">Send</button>
      `;
      const ce = document.getElementById("ce") as HTMLElement;
      const send = document.getElementById("send") as HTMLButtonElement;
      let sends = 0;
      send.addEventListener("click", () => {
        sends++;
      });
      ce.focus();

      // Paste fires at t=0ms, but host ProseMirror hasn't populated ce.textContent yet!
      const pasteEv = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEv, "clipboardData", {
        value: { getData: () => `Debug key ${STRIPE_SECRET}` },
      });
      ce.dispatchEvent(pasteEv);
      expect(pasteEv.defaultPrevented).toBe(false);

      // 10ms later, user hits Enter before DOM has textContent: must still block!
      vi.advanceTimersByTime(10);
      const enterEv = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ce.dispatchEvent(enterEv);

      expect(enterEv.defaultPrevented).toBe(true);
      expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");

      // A second impatient Enter or Send click while MODAL is open is also swallowed
      const secondEnter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ce.dispatchEvent(secondEnter);
      expect(secondEnter.defaultPrevented).toBe(true);
      send.click();
      expect(sends).toBe(0);
    });

    it("intercepts <50ms paste-then-Ctrl+Enter in textarea and prevents double-scrub click race", () => {
      document.body.innerHTML = `
        <textarea id="ta"></textarea>
        <button id="send" type="button" aria-label="Send message">Send</button>
      `;
      const ta = document.getElementById("ta") as HTMLTextAreaElement;
      const send = document.getElementById("send") as HTMLButtonElement;
      let sends = 0;
      send.addEventListener("click", () => {
        sends++;
      });
      ta.focus();

      const pasteEv = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEv, "clipboardData", {
        value: { getData: () => `Token ${AWS_KEY}` },
      });
      ta.dispatchEvent(pasteEv);
      // Host updates textarea 5ms later and user hits Ctrl+Enter at 12ms
      vi.advanceTimersByTime(5);
      ta.value = `Token ${AWS_KEY}`;
      vi.advanceTimersByTime(7);

      const ctrlEnter = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      ta.dispatchEvent(ctrlEnter);
      expect(ctrlEnter.defaultPrevented).toBe(true);
      expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");

      // Double-clicking Use Scrub & Send rapidly must release Send at most once
      const priBtn = document.getElementById(HOST_ID)?.shadowRoot?.getElementById("lf-primary") as HTMLButtonElement;
      priBtn.click();
      priBtn.click();
      vi.advanceTimersByTime(250);

      expect(sends).toBe(1);
      expect(ta.value).toContain("[REDACTED:AWS_ACCESS_KEY_1]");
      expect(ta.value).not.toContain(AWS_KEY);
    });

    it("executes window capture BEFORE document capture on Google Search <textarea name='q'> + 0ms Enter and [role='option']", () => {
      document.body.innerHTML = `
        <form id="gsearch" action="/search" role="search">
          <div role="combobox">
            <textarea id="q" name="q" aria-label="Search"></textarea>
          </div>
          <ul role="listbox">
            <li id="opt1" role="option">debug key suggestion</li>
          </ul>
          <button id="gbtn" type="submit" aria-label="Google Search">Google Search</button>
        </form>
      `;
      const q = document.getElementById("q") as HTMLTextAreaElement;
      const opt1 = document.getElementById("opt1") as HTMLElement;
      let docCaptureSawEnter = false;
      const docListener = () => {
        docCaptureSawEnter = true;
      };
      document.addEventListener("keydown", docListener, true);

      try {
        q.focus();
        q.value = `why did ${STRIPE_SECRET} fail`;
        q.dispatchEvent(new Event("input", { bubbles: true }));

        const enterEv = new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        });
        q.dispatchEvent(enterEv);

        expect(enterEv.defaultPrevented).toBe(true);
        // Because Cordon binds on `window` capture and calls stopPropagation(), document capture never sees it!
        expect(docCaptureSawEnter).toBe(false);
        expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");

        // Dismiss modal, then click autocomplete [role="option"] -> blocked synchronously on pointerdown/click
        (document.getElementById(HOST_ID)?.shadowRoot?.getElementById("lf-cancel") as HTMLButtonElement).click();
        expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("HIDDEN");

        let optClicked = false;
        opt1.addEventListener("click", () => {
          optClicked = true;
        });
        opt1.click();
        expect(optClicked).toBe(false);
        expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");
      } finally {
        document.removeEventListener("keydown", docListener, true);
      }
    });

    it("catches secrets even when a site clears input.value = '' on mousedown before click, and blocks Shift+Enter on <input>", () => {
      document.body.innerHTML = `
        <form id="chat-form">
          <input id="chat-in" type="search" placeholder="Search or ask..." />
          <button id="chat-send" type="submit" aria-label="Search">Search</button>
        </form>
      `;
      const input = document.getElementById("chat-in") as HTMLInputElement;
      const btn = document.getElementById("chat-send") as HTMLButtonElement;
      let submittedRaw = "";

      // Hostile/eager page script wipes input on mousedown (bubbling or document) before click fires
      btn.addEventListener("mousedown", () => {
        submittedRaw = input.value;
        input.value = "";
      });

      input.focus();
      input.value = `card 4532 0151 1283 0366 and ${STRIPE_SECRET}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));

      // 1. Shift+Enter on single-line <input> is blocked synchronously
      const shiftEnter = new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(shiftEnter);
      expect(shiftEnter.defaultPrevented).toBe(true);
      expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");

      // Cancel and test mousedown-clearing button click
      (document.getElementById(HOST_ID)?.shadowRoot?.getElementById("lf-cancel") as HTMLButtonElement).click();
      const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      btn.dispatchEvent(md);
      expect(md.defaultPrevented).toBe(true);
      expect(submittedRaw).toBe("");
      expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");
    });

    it("intercepts beforeinput insertParagraph and nested Shadow DOM editors while allowing benign searches", () => {
      const host = document.createElement("div");
      host.id = "shadow-composer-host";
      const sr = host.attachShadow({ mode: "open" });
      sr.innerHTML = `
        <textarea id="sh-ta" placeholder="Ask AI anything..."></textarea>
        <button id="sh-send" type="button" aria-label="Send">Send</button>
      `;
      document.body.appendChild(host);
      const shTa = sr.getElementById("sh-ta") as HTMLTextAreaElement;
      const shSend = sr.getElementById("sh-send") as HTMLButtonElement;

      // Benign developer query -> 0 false-positive modals
      shTa.focus();
      shTa.value = "how to fix python IndexError on 127.0.0.1 localhost port 8080 v4.6.2";
      shTa.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      let cleanSends = 0;
      shSend.addEventListener("click", () => {
        cleanSends++;
      });
      shSend.click();
      expect(cleanSends).toBe(1);
      expect(document.getElementById(HOST_ID)?.dataset.lfState ?? "HIDDEN").toBe("HIDDEN");

      // Secret inside nested Shadow DOM -> blocked on Send click!
      shTa.value = `UPI ravi.kumar@okicici and PAN ABCDE1234F`;
      shTa.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      shSend.click();
      expect(cleanSends).toBe(1);
      expect(document.getElementById(HOST_ID)?.dataset.lfState).toBe("MODAL");
    });
  });
});
