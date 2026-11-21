import { motion } from "motion/react";

interface BrandLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

/**
 * Bespoke "Split-Shield Airgap" emblem:
 * Two interlocking angular shield facets separated by an active airgap channel.
 * Left facet traps Signal Vermilion threat; right facet emits Electric Mint verified light.
 */
export function BrandLogo({ size = 24, animated = true, className = "" }: BrandLogoProps) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      whileHover={animated ? { scale: 1.06 } : undefined}
      transition={{ type: "spring", duration: 0.35, bounce: 0.2 }}
    >
      {/* Left Shield Facet (On-Device Trap — Signal Vermilion) */}
      <motion.path
        d="M14.2 3.5L5 7.2V15.4C5 21.4 8.9 26.7 14.2 28.5V3.5Z"
        fill="var(--mask-bg)"
        stroke="var(--mask-solid)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        initial={animated ? { pathLength: 0, opacity: 0.4 } : false}
        animate={animated ? { pathLength: 1, opacity: 1 } : false}
        transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
      />

      {/* Right Shield Facet (Verified Output — Electric Mint) */}
      <motion.path
        d="M17.8 3.5L27 7.2V15.4C27 21.4 23.1 26.7 17.8 28.5V3.5Z"
        fill="var(--safe-bg)"
        stroke="var(--safe-solid)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        initial={animated ? { pathLength: 0, opacity: 0.4 } : false}
        animate={animated ? { pathLength: 1, opacity: 1 } : false}
        transition={{ duration: 0.55, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}
      />

      {/* Active Glowing Airgap Channel */}
      <motion.line
        x1="16"
        y1="2.5"
        x2="16"
        y2="29.5"
        stroke="var(--nano-solid)"
        strokeWidth="1.5"
        strokeLinecap="round"
        initial={animated ? { opacity: 0.3, scaleY: 0.6 } : false}
        animate={animated ? { opacity: [0.55, 1, 0.55], scaleY: 1 } : false}
        transition={{
          opacity: { duration: 2.2, repeat: Infinity, ease: "easeInOut" },
          scaleY: { duration: 0.4, ease: [0.23, 1, 0.32, 1] },
        }}
      />

      {/* Left Threat Dot & Right Verified Check Node */}
      <circle cx="10.2" cy="15.5" r="1.75" fill="var(--mask-solid)" />
      <circle cx="21.8" cy="15.5" r="1.75" fill="var(--safe-solid)" />
    </motion.svg>
  );
}
