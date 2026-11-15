import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import {
  getRemoteConfig,
  fetchAndActivate,
  getString,
  getBoolean,
  type RemoteConfig,
} from "firebase/remote-config";

export interface RuntimeConfigValues {
  cloudModel: string;
  cloudFallbackModel: string;
  enableCloudEscalation: boolean;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigValues = {
  cloudModel: "gemini-3.5-flash-lite",
  cloudFallbackModel: "gemini-3.8-flash",
  enableCloudEscalation: true,
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

export function initAppCheckIfConfigured(app: FirebaseApp | null): void {
  if (!app || appCheckInitialized || typeof window === "undefined") {
    return;
  }
  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
  if (isLocalhost && debugToken) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }
  const siteKey =
    import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ??
    import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY ??
    "";
  if (!siteKey) {
    return;
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckInitialized = true;
  } catch {
    // Non-fatal in local/test or offline environments
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

export async function loadRuntimeConfig(timeoutMs = 1500): Promise<RuntimeConfigValues> {
  const app = getFirebaseApp();
  if (!app) {
    return { ...DEFAULT_RUNTIME_CONFIG };
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
    await Promise.race([
      fetchAndActivate(rc),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);

    return {
      cloudModel: getString(rc, "cloud_model") || DEFAULT_RUNTIME_CONFIG.cloudModel,
      cloudFallbackModel:
        getString(rc, "cloud_fallback_model") || DEFAULT_RUNTIME_CONFIG.cloudFallbackModel,
      enableCloudEscalation: getBoolean(rc, "enable_cloud_escalation"),
    };
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}
