import { describe, it, expect, vi, beforeEach } from "vitest";

const getGenerativeModelMock = vi.fn((_ai: unknown, params: unknown) => ({ params }));

vi.mock("firebase/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/ai")>();
  return {
    ...actual,
    getGenerativeModel: (ai: unknown, params: unknown) => getGenerativeModelMock(ai, params),
  };
});

import { InferenceMode, InferenceSource as SDKInferenceSource, type AI } from "firebase/ai";
import {
  configureLocalhostAppCheckDebugToken,
  createCloudEscalationModel,
  createHybridBriefModel,
  createOnDeviceFirewallModel,
  normalizeSdkInferenceSource,
  selectAppCheckProvider,
  TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
} from "../src/config/firebase";

describe("firebase SDK & App Check config", () => {
  beforeEach(() => {
    getGenerativeModelMock.mockClear();
  });

  it("passes inCloudParams.model (and zero top-level model) to getGenerativeModel in PREFER_IN_CLOUD", () => {
    const fakeAi = {} as AI;
    createCloudEscalationModel(fakeAi, "gemini-3.8-flash", "System prompt");

    expect(getGenerativeModelMock).toHaveBeenCalledTimes(1);
    const passedParams = getGenerativeModelMock.mock.calls[0][1] as Record<string, unknown>;
    expect(passedParams.mode).toBe(InferenceMode.PREFER_IN_CLOUD);
    expect(passedParams.model).toBeUndefined();
    expect(passedParams.inCloudParams).toEqual({
      model: "gemini-3.8-flash",
      systemInstruction: "System prompt",
    });
    expect(passedParams.onDeviceParams).toEqual({
      createOptions: TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
    });
  });

  it("configures ONLY_ON_DEVICE with explicit text-only expectedInputs and optional responseConstraint", () => {
    const fakeAi = {} as AI;
    const schema = { type: "object" };
    createOnDeviceFirewallModel(fakeAi, schema);

    const passedParams = getGenerativeModelMock.mock.calls[0][1] as Record<string, unknown>;
    expect(passedParams.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(passedParams.onDeviceParams).toEqual({
      createOptions: TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
      promptOptions: { responseConstraint: schema },
    });
  });

  it("configures PREFER_ON_DEVICE hybrid brief model with both onDeviceParams and inCloudParams", () => {
    const fakeAi = {} as AI;
    createHybridBriefModel(fakeAi, "gemini-3.5-flash-lite");

    const passedParams = getGenerativeModelMock.mock.calls[0][1] as Record<string, unknown>;
    expect(passedParams.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(passedParams.inCloudParams).toEqual({ model: "gemini-3.5-flash-lite" });
    expect(passedParams.onDeviceParams).toEqual({
      createOptions: TEXT_ONLY_ON_DEVICE_CREATE_OPTIONS,
    });
  });

  it("normalizes lowercase SDK InferenceSource ('on_device' | 'in_cloud') accurately", () => {
    expect(normalizeSdkInferenceSource({ inferenceSource: SDKInferenceSource.ON_DEVICE })).toBe(
      "ON_DEVICE",
    );
    expect(normalizeSdkInferenceSource({ inferenceSource: SDKInferenceSource.IN_CLOUD })).toBe(
      "IN_CLOUD",
    );
    expect(normalizeSdkInferenceSource({ inferenceSource: "ON_DEVICE" })).toBe("ON_DEVICE");
    expect(normalizeSdkInferenceSource({}, "IN_CLOUD")).toBe("IN_CLOUD");
  });

  it("selects App Check provider explicitly (Enterprise > v3 > Unconfigured) and restricts debug token to localhost", () => {
    expect(selectAppCheckProvider({ enterpriseKey: "ent_123", v3Key: "v3_456" })).toEqual({
      provider: "RECAPTCHA_ENTERPRISE",
      siteKey: "ent_123",
    });
    expect(selectAppCheckProvider({ v3Key: "6Le7_v3_site_key" })).toEqual({
      provider: "RECAPTCHA_V3",
      siteKey: "6Le7_v3_site_key",
    });
    expect(selectAppCheckProvider({})).toEqual({ provider: "UNCONFIGURED", siteKey: "" });

    const prodObj: Record<string, unknown> = {};
    expect(configureLocalhostAppCheckDebugToken("para-1-2e22b.web.app", "true", true, prodObj)).toBe(
      false,
    );
    expect(prodObj.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();

    const localObj: Record<string, unknown> = {};
    expect(configureLocalhostAppCheckDebugToken("localhost", undefined, true, localObj)).toBe(true);
    expect(localObj.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });

  it("loads DEFAULT_RUNTIME_CONFIG safely when Firebase env vars are absent", async () => {
    const { DEFAULT_RUNTIME_CONFIG, loadRuntimeConfig } = await import("../src/config/firebase");
    const cfg = await loadRuntimeConfig(100);
    expect(cfg.cloudModel).toBe(DEFAULT_RUNTIME_CONFIG.cloudModel);
    expect(cfg.cloudFallbackModel).toBe(DEFAULT_RUNTIME_CONFIG.cloudFallbackModel);
    expect(cfg.enableCloudEscalation).toBe(true);
  });
});
