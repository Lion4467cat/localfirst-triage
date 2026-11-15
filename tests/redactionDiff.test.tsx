import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RedactionDiff } from "../src/components/RedactionDiff";
import type { RedactionSpan } from "../src/types/triage";

describe("RedactionDiff", () => {
  it("renders clickable redaction pills and invokes onToggleSpan", () => {
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

    const { getByRole } = render(
      <RedactionDiff
        rawText="$42M valuation"
        sanitizedText="[REDACTED:M_AND_A_SECRET_1] valuation"
        spans={spans}
        onToggleSpan={onToggleSpan}
      />,
    );

    const pill = getByRole("button");
    fireEvent.click(pill);
    expect(onToggleSpan).toHaveBeenCalledWith(0);
  });
});
