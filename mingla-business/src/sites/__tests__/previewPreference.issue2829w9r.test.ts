/*
 * #2829 W9r (DESIGN_SPEC §1.7) — the preview size is remembered per signed-in
 * user: read and written on the server row for THAT user (Core's RPCs touch
 * own rows only, pg suite issue_2829_site_collections), cached locally under
 * that user's key, and another user on the same device doesn't inherit it.
 */
// #2829 W11 — Core's functions bind to the signed-in member (auth.uid()),
// so the mock answers for whoever is signed in, never for a passed-in id.
const rows = new Map<string, unknown>();
const calls: Array<{ fn: string; args: Record<string, unknown>; as: string }> = [];
let mockSignedIn = "owner-1";

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: () => { throw new Error("the preferences table is RPC-only"); },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args, as: mockSignedIn });
      const key = `${mockSignedIn}:${String(args.p_key)}`;
      if (fn === "business_ui_preference_set") { rows.set(key, args.p_value); return { data: args.p_value, error: null }; }
      if (fn === "business_ui_preference_get") return { data: rows.get(key) ?? null, error: null };
      return { data: null, error: { message: "unknown" } };
    },
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchPreviewPreference, readCachedPreviewPreference, savePreviewPreference } from "../contentApi";

describe("#2829 W9r remembered preview size", () => {
  it("persists and reloads for the same user, not for another", async () => {
    mockSignedIn = "owner-1";
    await savePreviewPreference("owner-1", { device: "tablet", tablet: "landscape", phone: "portrait" });
    expect(calls.at(-1)).toMatchObject({ fn: "business_ui_preference_set", args: { p_key: "website.previewDevice" }, as: "owner-1" });
    expect(await fetchPreviewPreference("owner-1")).toEqual({ device: "tablet", tablet: "landscape", phone: "portrait" });
    expect(calls.at(-1)).toMatchObject({ fn: "business_ui_preference_get", args: { p_key: "website.previewDevice" } });
    expect(await readCachedPreviewPreference("owner-1")).toEqual({ device: "tablet", tablet: "landscape", phone: "portrait" });
    mockSignedIn = "marketing-2";
    expect(await fetchPreviewPreference("marketing-2")).toBeNull();
    expect(await readCachedPreviewPreference("marketing-2")).toBeNull();
    await AsyncStorage.setItem("mingla:website.previewDevice:marketing-2", JSON.stringify({ device: "tv" }));
    expect(await readCachedPreviewPreference("marketing-2")).toBeNull();
  });
});
