import React, { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, type Text as RNText } from "react-native";
import { ScrollView } from "../../src/wrappers/SmartScrollView";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { brandSiteKeys } from "../../src/sites/brandSiteKeys";
import { normalizePlanPreview } from "../../src/sites/planPreviewApi";
import { normalizeSitePlan } from "../../src/sites/sitePlanState";
import { defaultPreviewPreference } from "../../src/sites/previewDevice";
import { WebsiteProvider, type WebsiteContextValue } from "../../src/components/sites/website/WebsiteContext";
import { PlanPreviewChooser } from "../../src/components/sites/plan/PlanPreviewChooser";
import { PlanDesignPart } from "../../src/components/sites/plan/PlanDesignPart";

/**
 * #4453 milestone 10 — DEV-ONLY harness for "See your site in three styles",
 * so the chooser, the plan bar, the three previews, the confirm sheet and the
 * ✕ warning can be opened without a deployed Core. Never in a release build:
 * `__DEV__` is false there and this route redirects home. It sits under the
 * anon-tolerant `/b/` prefix so it opens signed out without touching the auth
 * gate (it reads no auth and no brand data). The plan-preview answer is
 * a fixture passed at bundle time (EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE, the JSON
 * Core would send); the renders come from a local `smoke:prod -- --serve`.
 */
const BRAND = "aaaaaaaa-1111-4111-8111-0000000010b1";

function fixture(): unknown {
  try {
    return JSON.parse(process.env.EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE ?? "null");
  } catch {
    return null;
  }
}

export default function DevPlanPreviewHarness(): React.ReactElement {
  if (!__DEV__) return <Redirect href="/" />;
  return <Harness />;
}

function Harness(): React.ReactElement {
  const queryClient = useQueryClient();
  const headingRef = useRef<RNText | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [allStyles, setAllStyles] = useState(false);
  const plan = useMemo(() => normalizeSitePlan(BRAND, {
    plan: { brand_id: BRAND, revision: 1, offerings_selected: ["trips"], story: { main_action: "Reserve the next trip" } },
    style_library: true,
    plan_preview: true,
  }), []);
  useMemo(() => {
    queryClient.setQueryData(brandSiteKeys.planPreview(BRAND, plan.plan?.revision ?? null), normalizePlanPreview(fixture()));
  }, [queryClient, plan]);
  const noop = (): void => undefined;
  const value = {
    brandId: BRAND,
    brandName: "Young and Stamped",
    controller: {},
    phone: false,
    section: "setup",
    go: noop,
    back: noop,
    toast: (message: string) => setToast(message),
    askAdmin: noop,
    asking: false,
    lock: { heldByOther: false },
    plan,
    previewPreference: defaultPreviewPreference(false),
    setPreviewPreference: noop,
    openFullScreenPreview: noop,
    openPreviewSheet: noop,
    designDirty: false,
    setDesignDirty: noop,
    tokenDeclarations: null,
    setTokenDeclarations: noop,
    headingRef,
    offerings: ["trips"],
    setStickyBar: noop,
    setTopbarSave: noop,
  } as unknown as WebsiteContextValue;
  return (
    <WebsiteProvider value={value}>
      <SafeScreen edges={["top", "bottom"]} style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.dev}>Dev harness · fixture data · not in release builds</Text>
        {toast ? <Text style={styles.toast} testID="dev-toast">{toast}</Text> : null}
        {allStyles
          ? <PlanDesignPart brandId={BRAND} planState={plan} onDone={() => setAllStyles(false)} />
          : <PlanPreviewChooser brandId={BRAND} planState={plan} onDone={noop} onSeeAll={() => setAllStyles(true)} onChangeDetails={noop} />}
      </ScrollView>
      </SafeScreen>
    </WebsiteProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1 },
  body: { padding: 16, paddingBottom: 48 },
  dev: { color: "#9aa0a6", fontSize: 12, marginBottom: 12 },
  toast: { color: "#fff", backgroundColor: "#333", padding: 10, borderRadius: 8, marginBottom: 12 },
});
