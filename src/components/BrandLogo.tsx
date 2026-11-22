interface BrandLogoProps {
  size?: number;
  className?: string;
  beamGlow?: boolean;
}

/**
 * Geometric Airgap Mark:
 * Solid left vault (raw data stays local) | Glowing center airgap beam | Hollow right shell (safe sanitized output).
 */
export function BrandLogo({ size = 24, className = "", beamGlow = false }: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Solid left vault: raw data stays local */}
      <path d="M4 7a3 3 0 0 1 3-3h6v24H7a3 3 0 0 1-3-3V7Z" fill="currentColor" />
      {/* Center glowing airgap beam */}
      <rect
        x="15.25"
        y="2.5"
        width="1.5"
        height="27"
        rx="0.75"
        fill="var(--signal-mint, #00E5A3)"
        style={{
          filter: beamGlow ? "drop-shadow(0 0 6px var(--accent-primary))" : "none",
          transition: "filter 180ms ease",
        }}
      />
      {/* Hollow right shell: sanitized output */}
      <path
        d="M20 5h5a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2h-5V5Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
