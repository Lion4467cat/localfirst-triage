import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource as SDKInferenceSource,
  type AI,
  type GenerativeModel,
  type LanguageModelCreateOptions,
} from "firebase/ai";
import {
  fetchAndActivate,
  getBoolean,
  getRemoteConfig,
  getString,
  type RemoteConfig,
} from "firebase/remote-config";
import type { AppCheckProviderKind, RemoteConfigSource } from "../types/triage";

export interface RuntimeConfigValues {
  cloudModel: string;
  cloudFallbackModel: string;
  enableCloudEscalation: boolean;
  source?: RemoteConfigSource;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfigValues = {
  cloudModel: "gemini-3.5-flash-lite",
  cloudFallbackModel: "gemini-3.8-flash",
  enableCloudEscalation: true,
  source: "DEFAULT_FALLBACK",
};

/**
 * Explicit text-only expectedInputs / expectedOutputs so Chrome text-only Nano 4
 * builds do not fail @firebase/ai's default multimodal (text+image) check.
 */
export const TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
};

let cachedApp: FirebaseApp | null = null;
let cachedAI: AI | null = null;
let cachedRemoteConfig: RemoteConfig | null = null;
let appCheckInitialized = false;
let activeAppCheckProvider: AppCheckProviderKind = "UNCONFIGURED";

export interface AppCheckEnvSelection {
  provider: AppCheckProviderKind;
  siteKey: string;
}

export function selectAppCheckProvider(env: {
  enterpriseKey?: string;
  v3Key?: string;
}): AppCheckEnvSelection {
  const enterpriseKey = (env.enterpriseKey ?? "").trim();
  if (enterpriseKey) {
    return { provider: "RECAPTCHA_ENTERPRISE", siteKey: enterpriseKey };
  }
  const v3Key = (env.v3Key ?? "").trim();
  if (v3Key) {
    return { provider: "RECAPTCHA_V3", siteKey: v3Key };
  }
  return { provider: "UNCONFIGURED", siteKey: "" };
}

export function getAppCheckProviderStatus(): AppCheckProviderKind {
  if (activeAppCheckProvider !== "UNCONFIGURED") {
    return activeAppCheckProvider;
  }
  return selectAppCheckProvider({
    enterpriseKey: import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
    v3Key: import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY,
  }).provider;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  }
  return cachedApp;
}

export function configureLocalhostAppCheckDebugToken(
  hostname: string,
  envDebugToken?: string,
  isDev = Boolean(import.meta.env.DEV),
  target: Record<string, unknown> | undefined = typeof self !== "undefined"
    ? (self as unknown as Record<string, unknown>)
    : undefined,
): boolean {
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isLocalhost || !target) {
    return false;
  }
  const trimmed = (envDebugToken ?? "").trim();
  if (trimmed === "true") {
    target.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    return true;
  }
  if (trimmed) {
    target.FIREBASE_APPCHECK_DEBUG_TOKEN = trimmed;
    return true;
  }
  if (isDev) {
    target.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    return true;
  }
  return false;
}

export function initAppCheckIfConfigured(app: FirebaseApp | null): void {
  if (!app || appCheckInitialized || typeof window === "undefined") {
    return;
  }

  configureLocalhostAppCheckDebugToken(
    window.location.hostname,
    import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN,
    Boolean(import.meta.env.DEV),
  );

  const selection = selectAppCheckProvider({
    enterpriseKey: import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
    v3Key: import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY,
  });

  if (selection.provider === "UNCONFIGURED") {
    activeAppCheckProvider = "UNCONFIGURED";
    return;
  }

  try {
    const provider =
      selection.provider === "RECAPTCHA_ENTERPRISE"
        ? new ReCaptchaEnterpriseProvider(selection.siteKey)
        : new ReCaptchaV3Provider(selection.siteKey);

    initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
    activeAppCheckProvider = selection.provider;
    appCheckInitialized = true;
  } catch {
    // Non-fatal in unit test or offline sandbox environments
  }
}

export function getHybridAI(): AI | null {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  initAppCheckIfConfigured(app);
  if (!cachedAI) {
    cachedAI = getAI(app, { backend: new GoogleAIBackend() });
  }
  return cachedAI;
}

export function createOnDeviceFirewallModel(
  ai: AI,
  responseConstraint?: object,
): GenerativeModel {
  return getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
      ...(responseConstraint ? { promptOptions: { responseConstraint } } : {}),
    },
  });
}

export function createHybridBriefModel(ai: AI, cloudModel: string): GenerativeModel {
  return getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
    },
    inCloudParams: {
      model: cloudModel,
    },
  });
}

export function createCloudEscalationModel(
  ai: AI,
  cloudModel: string,
  systemInstruction?: string,
): GenerativeModel {
  return getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_IN_CLOUD,
    onDeviceParams: {
      createOptions: TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
    },
    inCloudParams: {
      model: cloudModel,
      ...(systemInstruction ? { systemInstruction } : {}),
    },
  });
}

/**
 * Normalize @firebase/ai EnhancedGenerateContentResponse.inferenceSource
 * (SDK emits lowercase 'on_device' | 'in_cloud').
 */
export function normalizeSdkInferenceSource(
  response: unknown,
  fallback: "ON_DEVICE" | "IN_CLOUD" = "IN_CLOUD",
): "ON_DEVICE" | "IN_CLOUD" {
  const raw = String(
    (response as { inferenceSource?: string } | null | undefined)?.inferenceSource ?? "",
  ).toLowerCase();
  if (raw === SDKInferenceSource.ON_DEVICE) {
    return "ON_DEVICE";
  }
  if (raw === SDKInferenceSource.IN_CLOUD) {
    return "IN_CLOUD";
  }
  return fallback;
}

/**
 * User-gesture-initiated Nano 4 download & warm-up using Firebase AI Logic's
 * native initializeDeviceModel(onDownloadProgress), falling back to LanguageModel.create().
 */
export async function warmupOnDeviceModel(
  onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ai = getHybridAI();
    if (ai) {
      const model = createOnDeviceFirewallModel(ai);
      await model.initializeDeviceModel((progress) => {
        const clamped = Math.max(0, Math.min(100, Math.round(progress * 100)));
        onProgress?.(clamped);
      });
      onProgress?.(100);
      return { ok: true };
    }

    const g = globalThis as unknown as {
      LanguageModel?: {
        create?: (options?: LanguageModelCreateOptions) => Promise<{ destroy?: () => void }>;
      };
    };
    if (g.LanguageModel?.create) {
      const session = await g.LanguageModel.create({
        ...TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            onProgress?.(Math.max(0, Math.min(100, Math.round(e.loaded * 100))));
          });
        },
      });
      session?.destroy?.();
      onProgress?.(100);
      return { ok: true };
    }

    return {
      ok: false,
      error: "Chrome Prompt API (LanguageModel) is not enabled in this browser.",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function loadRuntimeConfig(timeoutMs = 1500): Promise<RuntimeConfigValues> {
  const app = getFirebaseApp();
  if (!app) {
    return { ...DEFAULT_RUNTIME_CONFIG, source: "DEFAULT_FALLBACK" };
  }

  try {
    if (!cachedRemoteConfig) {
      cachedRemoteConfig = getRemoteConfig(app);
      cachedRemoteConfig.settings.minimumFetchIntervalMillis = 60_000;
      cachedRemoteConfig.defaultConfig = {
        cloud_model: DEFAULT_RUNTIME_CONFIG.cloudModel,
        cloud_fallback_model: DEFAULT_RUNTIME_CONFIG.cloudFallbackModel,
        enable_cloud_escalation: DEFAULT_RUNTIME_CONFIG.enableCloudEscalation,
      };
    }

    const rc = cachedRemoteConfig;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    await Promise.race([
      fetchAndActivate(rc).finally(() => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }),
      new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          resolve(false);
        }, timeoutMs);
      }),
    ]);

    return {
      cloudModel: getString(rc, "cloud_model") || DEFAULT_RUNTIME_CONFIG.cloudModel,
      cloudFallbackModel:
        getString(rc, "cloud_fallback_model") || DEFAULT_RUNTIME_CONFIG.cloudFallbackModel,
      enableCloudEscalation: getBoolean(rc, "enable_cloud_escalation"),
      source: timedOut ? "TIMEOUT" : "LOADED",
    };
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG, source: "DEFAULT_FALLBACK" };
  }
}

export function resetFirebaseCachesForTests(): void {
  cachedApp = null;
  cachedAI = null;
  cachedRemoteConfig = null;
  appCheckInitialized = false;
  activeAppCheckProvider = "UNCONFIGURED";
}
