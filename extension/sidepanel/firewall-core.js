import "../firewall-core.js";

const core = globalThis.LocalFirstFirewall;

export const TEXT_ONLY_OPTIONS = core.TEXT_ONLY_OPTIONS;
export const runLocalDeterministicScan = core.runLocalDeterministicScan;
export const mergeSpans = core.mergeSpans;
export const computeQuickRiskScore = core.computeQuickRiskScore;
export const scrubSync = core.scrubSync;
export const runExtensionNanoScan = core.runExtensionNanoScan;
export const buildSanitizedHandoffUrl = core.buildSanitizedHandoffUrl;
export const describeManualHost = core.describeManualHost;
export const shouldInterceptSendKey = core.shouldInterceptSendKey;
export const isLikelyNonSendButton = core.isLikelyNonSendButton;
