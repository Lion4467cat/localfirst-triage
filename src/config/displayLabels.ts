import type { DetectorSource } from "../types/triage";

export interface ScenarioDisplayMeta {
  title: string;
  subtitle: string;
  plainBadge: string;
}

export const SCENARIO_DISPLAY: Record<string, ScenarioDisplayMeta> = {
  "scenario-p0-semantic-leak": {
    title: "Hospital Checkout Alert",
    subtitle: "Hides patient details, password hint, token & API key",
    plainBadge: "Critical · Health & Auth",
  },
  "scenario-p3-local-runbook": {
    title: "Expired Local Certificate",
    subtitle: "Fixed instantly on your device ($0 cloud spend)",
    plainBadge: "Low · Offline Fix",
  },
  "scenario-p1-billing-webhook": {
    title: "Payment Webhook Outage",
    subtitle: "Hides card, SSN, private key, AWS/Stripe keys & DB link",
    plainBadge: "High · Payments",
  },
  "scenario-p2-offline-oauth": {
    title: "Warehouse Kiosk Login Error",
    subtitle: "Clock-sync fix runs offline without cloud AI",
    plainBadge: "Medium · Offline Fix",
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  AWS_ACCESS_KEY: "AWS Key",
  STRIPE_KEY: "Stripe Key",
  FIREBASE_KEY: "Firebase Key",
  WEBHOOK_SECRET: "Webhook Secret",
  PEM_PRIVATE_KEY: "Private Key",
  JWT_TOKEN: "Auth Token",
  BEARER_OR_JWT: "Auth Token",
  DATABASE_URI: "Database Link",
  DB_CONNECTION_URI: "Database Link",
  CREDIT_CARD: "Card Number",
  SSN: "SSN",
  US_SSN: "SSN",
  EMAIL: "Email",
  PHONE: "Phone Number",
  IP_ADDRESS: "IP Address",
  MEDICAL_PHI: "Medical Info",
  CONTEXTUAL_PHI: "Medical Info",
  PASSWORD_HINT: "Password Hint",
  NATURAL_SECRET: "Password Hint",
  INTERNAL_CODENAME: "Project Codename",
  M_AND_A_SECRET: "Confidential Deal Info",
  PERSONAL_INFO: "Personal Info",
  PERSONAL_PII_LOCATION: "Personal Location / Name",
  HIGH_ENTROPY_SECRET: "Secret Key",
  MANUAL_MASK: "Hidden by You",
  MANUAL_SECRET: "Hidden by You",
  CUSTOM_POLICY_TERM: "Company Rule",
  POLICY_TERM: "Company Rule",
  API_KEY: "API Key",
  SECRET_TOKEN: "Access Secret",
  BEARER_TOKEN: "Bearer Token",
};

export function formatCategoryLabel(category: string): string {
  const mapped = CATEGORY_LABELS[category];
  if (mapped) return mapped;
  return category
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDetectorLabel(detector: DetectorSource): string {
  switch (detector) {
    case "NANO_SEMANTIC_FIREWALL":
      return "Gemini Nano (On-Device)";
    case "REGEX_FIREWALL":
      return "Pattern Guard";
    case "ENTROPY_SCANNER":
      return "Key Strength Scan";
    case "HEURISTIC_GUARD":
      return "Local Safety Check";
    case "POLICY_TERM":
      return "Company Rule";
    case "MANUAL_MASK":
      return "Hidden by You";
  }
}

export function getSeverityStyle(severity: string): {
  bg: string;
  border: string;
  text: string;
  label: string;
} {
  switch (severity) {
    case "P0":
      return {
        bg: "var(--mask-bg)",
        border: "var(--mask-border)",
        text: "var(--mask-text)",
        label: "Critical",
      };
    case "P1":
      return {
        bg: "var(--warn-bg)",
        border: "var(--warn-border)",
        text: "var(--warn-text)",
        label: "High",
      };
    case "P2":
      return {
        bg: "var(--info-bg)",
        border: "var(--info-border)",
        text: "var(--info-text)",
        label: "Medium",
      };
    default:
      return {
        bg: "var(--safe-bg)",
        border: "var(--safe-border)",
        text: "var(--safe-text)",
        label: "Low",
      };
  }
}
