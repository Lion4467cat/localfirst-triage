import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HardwareBenchmark } from "../src/components/HardwareBenchmark";
import {
  APP_LOCK_LATENCIES,
  HARDWARE_BENCHMARK_ROWS,
  MULTI_TURN_RELOCK_RANGE,
} from "../src/data/hardwareBenchmark";

describe("hardware benchmark panel", () => {
  it("renders every device with its measured numbers", () => {
    render(<HardwareBenchmark />);

    for (const row of HARDWARE_BENCHMARK_ROWS) {
      expect(screen.getAllByText(row.device).length).toBeGreaterThan(0);
      expect(screen.getAllByText(row.detail).length).toBeGreaterThan(0);
    }

    const table = screen.getByRole("table");
    expect(within(table).getAllByText("100.0%")).toHaveLength(HARDWARE_BENCHMARK_ROWS.length);
    expect(within(table).getAllByText("0.0%")).toHaveLength(HARDWARE_BENCHMARK_ROWS.length);
    expect(within(table).getByText("0.44 ms")).toBeTruthy();
    expect(within(table).getByText("1.42 ms")).toBeTruthy();
    expect(within(table).getAllByText("(81/81)")).toHaveLength(2);
    expect(within(table).getByText("(80/80)")).toBeTruthy();
    expect(within(table).getByText("(0/48)")).toBeTruthy();
  });

  it("renders the per-app lock latency for all six swept apps", () => {
    render(<HardwareBenchmark />);

    for (const entry of APP_LOCK_LATENCIES) {
      const chip = screen.getByTitle(entry.package);
      expect(within(chip).getByText(entry.app)).toBeTruthy();
      expect(within(chip).getByText(`${entry.lockMs} ms`)).toBeTruthy();
    }
    expect(screen.getByText(MULTI_TURN_RELOCK_RANGE)).toBeTruthy();
  });

  it("keeps the desktop table scrollable instead of overflowing the page", () => {
    render(<HardwareBenchmark />);

    const table = screen.getByRole("table");
    const scrollWrapper = table.parentElement;
    expect(scrollWrapper?.className).toContain("overflow-x-auto");
    expect(scrollWrapper?.className).toContain("hidden");
    expect(scrollWrapper?.className).toContain("sm:block");
    expect(table.className).toContain("min-w-[620px]");
    expect(table.className).toContain("w-full");
  });

  it("swaps the table for stacked cards on a mobile viewport", () => {
    render(<HardwareBenchmark />);

    const table = screen.getByRole("table");
    const mobileList = screen.getAllByRole("list").find((node) => node.className.includes("sm:hidden"));
    expect(mobileList).toBeTruthy();
    expect(table.parentElement?.className).toContain("hidden");

    for (const row of HARDWARE_BENCHMARK_ROWS) {
      expect(within(mobileList as HTMLElement).getAllByText(row.recallRatio).length).toBeGreaterThan(0);
    }
    expect(within(mobileList as HTMLElement).getAllByText("Leaks")).toHaveLength(
      HARDWARE_BENCHMARK_ROWS.length,
    );
  });

  it("has no fixed-width wrapper that could overflow a narrow screen", () => {
    render(<HardwareBenchmark />);

    const section = document.getElementById("hardware-benchmark");
    expect(section).toBeTruthy();
    expect(section?.className).toContain("w-full");
    expect(section?.className).not.toMatch(/(?<!max-)w-\[\d{3,}px\]/);
    expect(section?.getAttribute("style")).toBeNull();
  });
});
