import {
  APP_LOCK_LATENCIES,
  HARDWARE_BENCHMARK_ROWS,
  MULTI_TURN_RELOCK_RANGE,
} from "../data/hardwareBenchmark";

const HEADERS = ["Device", "Recall", "False positives", "p50", "p95", "max", "Leaks"];

function Cell({ children, mono = true }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={mono ? "font-mono text-[11.5px] tabular-nums" : "text-[12px]"}>
      {children}
    </span>
  );
}

export function HardwareBenchmark() {
  const slowest = APP_LOCK_LATENCIES.reduce((a, b) => (b.lockMs > a.lockMs ? b : a));

  return (
    <section
      id="hardware-benchmark"
      aria-labelledby="hardware-benchmark-heading"
      className="mx-auto w-full max-w-[1440px] scroll-mt-16 px-3 pb-8 lg:px-4"
    >
      <div
        className="rounded-xl border p-4 sm:p-5"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div>
            <p
              className="font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ color: "var(--text-muted)" }}
            >
              Measured, not marketed
            </p>
            <h2
              id="hardware-benchmark-heading"
              className="mt-1 font-display text-lg font-bold tracking-tight sm:text-xl"
              style={{ color: "var(--text-primary)" }}
            >
              Verified on real hardware
            </h2>
          </div>
          <p className="max-w-[46ch] text-[11.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Same corpus, same build. The phone that ships AICore runs the hybrid pass; the phone
            without it fails closed to the deterministic rules.
          </p>
        </div>

        <div className="mt-4 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <caption className="sr-only">
              Cordon firewall benchmark on Galaxy S26 Ultra, Moto G82 5G and the Chrome extension
            </caption>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {HEADERS.map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="whitespace-nowrap py-2 pr-3 font-mono text-[10px] font-semibold uppercase tracking-wider last:pr-0"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HARDWARE_BENCHMARK_ROWS.map((row) => (
                <tr key={row.device} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <th scope="row" className="py-2.5 pr-3 text-left align-top">
                    <span className="block text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
                      {row.device}
                    </span>
                    <span className="block font-mono text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                      {row.detail}
                    </span>
                  </th>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top" style={{ color: "var(--safe-text)" }}>
                    <Cell>
                      {row.recall} <span style={{ color: "var(--text-muted)" }}>({row.recallRatio})</span>
                    </Cell>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top" style={{ color: "var(--text-primary)" }}>
                    <Cell>
                      {row.falsePositives}{" "}
                      <span style={{ color: "var(--text-muted)" }}>({row.fpRatio})</span>
                    </Cell>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top" style={{ color: "var(--text-primary)" }}>
                    <Cell>{row.p50}</Cell>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top" style={{ color: "var(--text-secondary)" }}>
                    <Cell>{row.p95}</Cell>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top" style={{ color: "var(--text-secondary)" }}>
                    <Cell>{row.max}</Cell>
                  </td>
                  <td className="whitespace-nowrap py-2.5 align-top" style={{ color: "var(--safe-text)" }}>
                    <Cell>{row.leaks}</Cell>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 flex flex-col gap-2 sm:hidden">
          {HARDWARE_BENCHMARK_ROWS.map((row) => (
            <li
              key={row.device}
              className="rounded-lg border p-3"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {row.device}
                </span>
                <span className="font-mono text-[11px]" style={{ color: "var(--safe-text)" }}>
                  {row.recall}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                {row.detail}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>Recall</dt>
                  <dd className="font-mono text-[10.5px] tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {row.recallRatio}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>False pos.</dt>
                  <dd className="font-mono text-[10.5px] tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {row.fpRatio}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>p50</dt>
                  <dd className="font-mono text-[10.5px] tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {row.p50}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>Leaks</dt>
                  <dd className="font-mono text-[10.5px] tabular-nums" style={{ color: "var(--safe-text)" }}>
                    {row.leaks}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                {row.note}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: "var(--text-muted)" }}
            >
              Live lock latency
            </span>
            <span className="text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
              tap-to-modal on the S26 Ultra, per app
            </span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {APP_LOCK_LATENCIES.map((entry) => (
              <li
                key={entry.package}
                className="rounded border px-2 py-1"
                style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-subtle)" }}
                title={entry.package}
              >
                <span className="text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
                  {entry.app}
                </span>
                <span
                  className="ml-1.5 font-mono text-[10.5px] font-semibold tabular-nums"
                  style={{ color: "var(--text-primary)" }}
                >
                  {entry.lockMs} ms
                </span>
              </li>
            ))}
            <li
              className="rounded border px-2 py-1"
              style={{ backgroundColor: "var(--bg-subtle)", borderColor: "var(--border-subtle)" }}
            >
              <span className="text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
                Multi-turn re-lock
              </span>
              <span
                className="ml-1.5 font-mono text-[10.5px] font-semibold tabular-nums"
                style={{ color: "var(--text-primary)" }}
              >
                {MULTI_TURN_RELOCK_RANGE}
              </span>
            </li>
          </ul>
          <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Slowest app in the sweep: {slowest.app} at {slowest.lockMs} ms. Deterministic latencies
            are p50 over the 81-case CordonBench corpus at the MEDIUM dial; the hybrid figure is one
            Gemini Nano pass with Airplane Mode on and zero network bytes.
          </p>
        </div>
      </div>
    </section>
  );
}
