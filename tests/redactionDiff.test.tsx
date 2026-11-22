import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RedactionDiff } from "../src/components/RedactionDiff";
import type { RedactionSpan } from "../src/types/triage";

describe("RedactionDiff", () => {
  it("renders inline highlighted tokens and plain-English secret tags invoking onToggleSpan", () => {
    const onToggleSpan = vi.fn();
    const spans: RedactionSpan[] = [
      {
        start: 0,
        end: 4,
        category: "M_AND_A_SECRET",
        detector: "NANO_SEMANTIC_FIREWALL",
        placeholder: "[REDACTED:M_AND_A_SECRET_1]",
        matchedText: "$42M",
        masked: true,
      },
    ];

    const { getAllByRole } = render(
      <RedactionDiff
        rawText="$42M valuation"
        sanitizedText="[REDACTED:M_AND_A_SECRET_1] valuation"
        spans={spans}
        onToggleSpan={onToggleSpan}
      />,
    );

    const buttons = getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    const chip = buttons.find((b) =>
      b.textContent?.includes("Confidential Deal Info") && b.textContent?.includes("Gemini Nano"),
    );
    expect(chip).toBeDefined();
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip!);
    expect(onToggleSpan).toHaveBeenCalledWith(0);
  });

  it("disables unmasking when viewing a purged zero-PII record from disk", () => {
    const onToggleSpan = vi.fn();
    const spans: RedactionSpan[] = [
      {
        start: 0,
        end: 4,
        category: "API_KEY",
        detector: "REGEX_FIREWALL",
        placeholder: "[REDACTED:API_KEY_1]",
        matchedText: "[REDACTED:API_KEY_1]",
        masked: true,
      },
    ];

    const { getByText, getAllByRole } = render(
      <RedactionDiff
        rawText="[PURGED_FROM_DISK_FOR_PRIVACY]"
        sanitizedText="[REDACTED:API_KEY_1] trace"
        spans={spans}
        loadedFromZeroPiiStore={true}
        onToggleSpan={onToggleSpan}
      />,
    );

    expect(getByText(/Raw text purged from storage/i)).toBeTruthy();
    const chip = getAllByRole("button").find((b) =>
      b.textContent?.includes("API Key") && b.textContent?.includes("Pattern Guard"),
    );
    expect((chip as HTMLButtonElement).disabled).toBe(true);
  });
});
