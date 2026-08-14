import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabaseUrl } from "./supabase";

export type UpdateDecision = { state: "required"; storeUrl: string; message: string } | { state: "allowed" | "unknown" };
type Policy = { appId: "explorer"; platform: "ios" | "android"; minimumVersion: string; storeUrl: string; message: string; enforcementMode: "observe" | "enforce"; updatedAt: string };
const CACHE_KEY = "mingla.appVersionPolicy.explorer.v1";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
let inFlight: Promise<UpdateDecision> | null = null;
export const nativeAppVersion = (): string | null => typeof Constants.nativeAppVersion === "string" && versionPattern.test(Constants.nativeAppVersion) ? Constants.nativeAppVersion : (__DEV__ && typeof Constants.expoConfig?.version === "string" && versionPattern.test(Constants.expoConfig.version) ? Constants.expoConfig.version : null);
export const compareSemver = (a: string, b: string): number | null => { const aa = versionPattern.exec(a); const bb = versionPattern.exec(b); if (!aa || !bb) return null; for (let i = 1; i < 4; i += 1) { const delta = Number(aa[i]) - Number(bb[i]); if (delta) return delta; } return 0; };
const decision = (policy: Policy): UpdateDecision => { const installed = nativeAppVersion(); const comparison = installed ? compareSemver(installed, policy.minimumVersion) : null; return comparison !== null && comparison < 0 ? { state: "required", storeUrl: policy.storeUrl, message: policy.message } : { state: "allowed" }; };
const valid = (input: unknown): input is Policy => { const p = input as Partial<Policy>; return p?.appId === "explorer" && (p.platform === "ios" || p.platform === "android") && typeof p.minimumVersion === "string" && versionPattern.test(p.minimumVersion) && typeof p.storeUrl === "string" && /^https:\/\//.test(p.storeUrl) && typeof p.message === "string"; };
export async function checkAppVersionPolicy(): Promise<UpdateDecision> { if (Platform.OS === "web") return { state: "allowed" }; if (inFlight) return inFlight; inFlight = (async () => { try { const platform = Platform.OS as "ios" | "android"; const response = await fetch(`${supabaseUrl}/functions/v1/app-version-policy?app_id=explorer&platform=${platform}`, { headers: { "Cache-Control": "no-store" } }); const body: unknown = await response.json(); if (!response.ok || !valid(body) || body.platform !== platform) throw new Error("invalid_policy_response"); await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(body)); return decision(body); } catch { try { const cached = await AsyncStorage.getItem(CACHE_KEY); if (cached) { const parsed: unknown = JSON.parse(cached); if (valid(parsed)) return decision(parsed); } } catch {} return { state: "unknown" }; } finally { inFlight = null; } })(); return inFlight; }
