import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyRehydrationTier,
  getVaultSummary,
  purgeRehydrationVault,
  registerTicketSpansInVault,
  rehydrateTextForLocalView,
} from "../src/firewall/rehydrationVault";
import type { RedactionSpan } from "../src/types/triage";

describe("rehydrationVault", () => {
  beforeEach(() => {
    purgeRehydrationVault();
  });

  it("classifies credentials/PHI as PERMANENTLY_LOCKED and business context as REHYDRATABLE_CONTEXT", () => {
    expect(classifyRehydrationTier("API_KEY")).toBe("PERMANENTLY_LOCKED");
    expect(classifyRehydrationTier("AWS_ACCESS_KEY")).toBe("PERMANENTLY_LOCKED");
    expect(classifyRehydrationTier("MEDICAL_PHI")).toBe("PERMANENTLY_LOCKED");
    expect(classifyRehydrationTier("CONTEXTUAL_PHI")).toBe("PERMANENTLY_LOCKED");
    expect(classifyRehydrationTier("M_AND_A_SECRET")).toBe("REHYDRATABLE_CONTEXT");
    expect(classifyRehydrationTier("ORG_TERM")).toBe("REHYDRATABLE_CONTEXT");
    expect(classifyRehydrationTier("PROJECT_CODENAME")).toBe("REHYDRATABLE_CONTEXT");
  });

  it("unmasks ONLY REHYDRATABLE_CONTEXT in RAM while keeping credentials permanently locked", () => {
    const spans: RedactionSpan[] = [
      {
        start: 0,
        end: 15,
        category: "M_AND_A_SECRET",
        detector: "HEURISTIC_GUARD",
        placeholder: "[REDACTED:M_AND_A_1]",
        matchedText: "Project-Chimera",
        masked: true,
      },
      {
        start: 20,
        end: 40,
        category: "AWS_ACCESS_KEY",
        detector: "REGEX_FIREWALL",
        placeholder: "[REDACTED:AWS_1]",
        matchedText: "AKIAIOSFODNN7EXAMPLE",
        masked: true,
      },
      {
        start: 45,
        end: 65,
        category: "MEDICAL_PHI",
        detector: "NANO_SEMANTIC_FIREWALL",
        placeholder: "[REDACTED:PHI_1]",
        matchedText: "Manipal ICU Floor 3",
        masked: true,
      },
    ];

    registerTicketSpansInVault("ticket-1", spans);
    const blindText =
      "Check [REDACTED:M_AND_A_1] deploy using [REDACTED:AWS_1] for [REDACTED:PHI_1].";

    // Default OFF: everything stays redacted
    const offView = rehydrateTextForLocalView("ticket-1", blindText, false);
    expect(offView.unmaskedContextCount).toBe(0);
    expect(offView.segments.some((s) => s.value === "Project-Chimera")).toBe(false);

    // Toggle ON: only Project-Chimera unmasks in RAM; AWS_1 and PHI_1 remain locked!
    const onView = rehydrateTextForLocalView("ticket-1", blindText, true);
    expect(onView.unmaskedContextCount).toBe(1);
    expect(onView.lockedCredentialsCount).toBe(2);
    expect(onView.segments.some((s) => s.kind === "rehydrated" && s.value === "Project-Chimera")).toBe(true);
    expect(onView.segments.some((s) => s.value.includes("AKIAIOSFODNN7EXAMPLE"))).toBe(false);
    expect(onView.segments.some((s) => s.value.includes("Manipal ICU Floor 3"))).toBe(false);

    // Blind text itself is never mutated (Copy Safe RCA stays 100% redacted)
    expect(blindText).toContain("[REDACTED:M_AND_A_1]");

    // Purge wipes Map completely
    purgeRehydrationVault("ticket-1");
    expect(getVaultSummary("ticket-1").rehydratableCount).toBe(0);
    expect(getVaultSummary("ticket-1").lockedCount).toBe(0);
  });
});
