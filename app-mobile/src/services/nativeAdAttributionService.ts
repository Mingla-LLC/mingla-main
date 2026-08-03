import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { supabase } from "./supabase";

const STORAGE_KEY = "@mingla_ad_click_attribution_v1";
const MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000;
const CAPTURE_TIMEOUT_MS = 2500;

type StoredAttribution = { clickId: string; capturedAt: number };
type ParamValue = string | string[] | undefined;

function value(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (Array.isArray(input) && typeof input[0] === "string") return input[0].trim();
  return "";
}

function networkFrom(input: Record<string, unknown>): string {
  if (value(input.fbclid)) return "meta";
  if (value(input.ttclid)) return "tiktok";
  if (value(input.ScCid) || value(input.sccid)) return "snapchat";
  if (value(input.gclid)) return "google";
  if (value(input.rdt_cid)) return "reddit";
  const source = value(input.utm_source || input.pid).toLowerCase();
  if (source.includes("facebook") || source.includes("meta")) return "meta";
  if (source.includes("tiktok")) return "tiktok";
  if (source.includes("snap")) return "snapchat";
  if (source.includes("google")) return "google";
  if (source.includes("reddit")) return "reddit";
  return "other";
}

async function readStored(): Promise<StoredAttribution | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAttribution>;
    if (
      typeof parsed.clickId !== "string" ||
      typeof parsed.capturedAt !== "number" ||
      Date.now() - parsed.capturedAt > MAX_AGE_MS
    ) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { clickId: parsed.clickId, capturedAt: parsed.capturedAt };
  } catch (error) {
    console.warn("[nativeAdAttribution] stored attribution unreadable:", error);
    return null;
  }
}

export async function getStoredNativeAdClickId(): Promise<string | null> {
  return (await readStored())?.clickId ?? null;
}

export async function clearNativeAdAttribution(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("[nativeAdAttribution] clear failed:", error);
  }
}

async function capture(
  input: Record<string, unknown>,
  destination?: { brandSlug: string; venueSlug: string },
): Promise<void> {
  if (await readStored()) return;
  const afCId = value(input.af_c_id || input.c_id);
  const mcId = value(input.mc_id);
  const externalClickId = value(
    input.fbclid || input.ttclid || input.ScCid || input.sccid || input.gclid || input.rdt_cid,
  );
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const found = value(input[key]);
    if (found) utm[key] = found;
  }
  const network = networkFrom(input);
  if (!afCId && !mcId && !externalClickId && Object.keys(utm).length === 0 && network === "other") {
    return;
  }

  try {
    const invocation = supabase.functions.invoke<{ click_id?: unknown }>(
      "attribution-capture",
      {
        body: {
          kind: "touch",
          surface: Platform.OS === "ios" ? "ios" : "android",
          lane: "consumer",
          network,
          ...(externalClickId ? { external_click_id: externalClickId } : {}),
          ...(afCId ? { af_c_id: afCId } : {}),
          ...(mcId ? { mc_id: mcId } : {}),
          ...(Object.keys(utm).length > 0 ? { utm } : {}),
          ...(destination
            ? {
                dest: {
                  page_type: "venue",
                  brand_slug: destination.brandSlug,
                  entity_slug: destination.venueSlug,
                },
              }
            : {}),
        },
      },
    );
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
    });
    const result = await Promise.race([invocation, timeout]);
    const clickId = result && typeof result.data?.click_id === "string"
      ? result.data.click_id
      : null;
    if (clickId && !(await readStored())) {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ clickId, capturedAt: Date.now() } satisfies StoredAttribution),
      );
    }
  } catch (error) {
    console.warn("[nativeAdAttribution] capture failed (non-fatal):", error);
  }
}

export async function captureNativeStayRouteAttribution(input: {
  brandSlug: string;
  venueSlug: string;
  params: Record<string, ParamValue>;
}): Promise<void> {
  await capture(input.params, {
    brandSlug: input.brandSlug,
    venueSlug: input.venueSlug,
  });
}

export async function captureNativeOneLinkAttribution(
  data: Record<string, unknown>,
): Promise<void> {
  const normalized: Record<string, unknown> = {
    ...data,
    af_c_id: value(data.af_c_id || data.c_id),
    utm_source: value(data.utm_source || data.pid),
    utm_medium: value(data.utm_medium) || "paid",
    utm_campaign: value(data.utm_campaign || data.af_c_id || data.c_id),
  };
  await capture(normalized);
}
