import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type Text as RNText } from "react-native";
import { Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { brandSiteKeys } from "../../src/sites/brandSiteKeys";
import { normalizeSitePlan } from "../../src/sites/sitePlanState";
import { defaultPreviewPreference } from "../../src/sites/previewDevice";
import { WebsiteProvider, type WebsiteContextValue } from "../../src/components/sites/website/WebsiteContext";
import { PagesSection } from "../../src/components/sites/website/sections/PagesSection";
import { ToolProposalCard } from "../../src/components/ari/ToolProposalCard";
import { WButton } from "../../src/components/sites/website/ui";
import { ariPagePrompt } from "../../../packages/site-contracts/src/ariPage.ts";
import type { SitePageRow } from "../../src/sites/contentApi";

/**
 * #4453 milestone 11 — DEV-ONLY harness for "Add a page with Ari": the Pages
 * sheet (chips, topic, Cancel), Ari's plan card ("Add as a Draft"), then the
 * Draft page card ("Ari needs this", "Publish this page", "Remove"), without a
 * deployed Core or a signed-in Ari. Kept out of every production bundle the
 * same way as the milestone 10 harness (metro.config.js DEV_ONLY_ROUTES), and
 * `__DEV__` is false in a release build, so it would redirect home anyway.
 * The brand-site-control content calls are answered by an in-page fake (web
 * fetch only, this route only), so the real hooks and mutations run.
 */
const BRAND = "aaaaaaaa-1111-4111-8111-0000000011b1";
const SITE = "bbbbbbbb-2222-4222-8222-0000000011b1";
const REQUEST = ariPagePrompt("Private hire");

const BASE_PAGES: SitePageRow[] = [
  { id: "p-home", path: "", title: "Home", enabled: true, in_menu: true, in_group: false, menu_index: 0, revision: "r1" } as SitePageRow,
  { id: "p-trips", path: "trips", title: "Trips", enabled: true, in_menu: true, in_group: false, menu_index: 1, revision: "r1", collection_kind: "trips" } as SitePageRow,
  { id: "p-about", path: "about", title: "About", enabled: true, in_menu: true, in_group: false, menu_index: 2, revision: "r1" } as SitePageRow,
];

const DRAFT_PAGE: SitePageRow = {
  id: "p-private-hire",
  path: "private-hire",
  title: "Private hire",
  enabled: false,
  in_menu: false,
  in_group: false,
  menu_index: null,
  revision: "r2",
  origin: "ari",
  ari_draft: true,
  ari_request: REQUEST,
  review_count: 3,
  owner_questions: [
    { key: "capacity", question: "How many guests can a private hire take?", block_index: 1, field_path: "caption", placeholder: "For example: up to 40 guests" },
    { key: "contact_note", question: "Anything guests should know before they enquire?", block_index: 2, field_path: "body", placeholder: "For example: we reply within a day" },
  ],
} as SitePageRow;

const PROPOSAL = {
  brand_id: BRAND,
  site_id: SITE,
  expected_site_revision: "a".repeat(64),
  request: REQUEST,
  page: { title: "Private hire", menu_label: "Private hire", slug: "private-hire" },
  blocks: [
    { type: "page_header", variant: "plain", heading: "Private hire" },
    { type: "media_feature", variant: "split", heading: "Your group, your night" },
    { type: "contact_form", variant: "simple", heading: "Ask about a date" },
  ],
  have: [
    { text: "Your trips and their prices on Mingla", source: "mingla_record", ref: "trips" },
    { text: "\"Private hire\" (your words)", source: "owner_words" },
  ],
  questions: DRAFT_PAGE.owner_questions,
  why: "You asked for a page about private hire.",
};

type Step = "pages" | "ari" | "draft";

export default function DevAriAddPageHarness(): React.ReactElement {
  if (!__DEV__) return <Redirect href="/" />;
  return <Harness />;
}

function Harness(): React.ReactElement {
  const headingRef = useRef<RNText | null>(null);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("pages");
  const pagesRef = useRef<SitePageRow[]>(BASE_PAGES);

  // The in-page fake of Core's content route (web only, this dev route only).
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.fetch !== "function") return undefined;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/functions/v1/brand-site-control")) return original(input, init);
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { action?: string; args?: Record<string, unknown> };
      const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
      const pageId = typeof body.args?.page_id === "string" ? body.args.page_id : "";
      switch (body.action) {
        case "pages":
          return reply({ revision: "r2", wordmark: "Young and Stamped", pages: pagesRef.current, footer_links: [] });
        case "offerings":
          return reply({ offerings: [] });
        case "ari_page_answer": {
          pagesRef.current = pagesRef.current.map((row) => row.id === pageId
            ? { ...row, owner_questions: (row.owner_questions ?? []).filter((q) => q.key !== body.args?.question_key) }
            : row);
          return reply({ page_id: pageId, remaining_questions: 0 });
        }
        case "ari_page_accept":
          pagesRef.current = pagesRef.current.map((row) => row.id === pageId ? { ...row, enabled: true, ari_draft: false, in_menu: true } : row);
          return reply({ page_id: pageId, enabled: true, history_line: "Page added with Ari: Private hire" });
        case "ari_page_remove":
          pagesRef.current = pagesRef.current.filter((row) => row.id !== pageId);
          return reply({ page_id: pageId, removed: true });
        default:
          return reply({ pages: [] });
      }
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  const plan = useMemo(() => normalizeSitePlan(BRAND, {
    plan: { brand_id: BRAND, revision: 1, offerings_selected: ["trips"], story: { main_action: "Reserve the next trip" } },
    style_library: true,
    ari_add_page: true,
  }), []);
  const noop = (): void => undefined;
  const value = {
    brandId: BRAND,
    brandName: "Young and Stamped",
    controller: { siteId: SITE, actions: { openStudio: noop }, isOpeningStudio: false },
    phone: false,
    section: "pages",
    go: (target: unknown) => setToast((current) => `${current ?? ""} · (harness) would open ${JSON.stringify(target)}`),
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
      <ScrollView style={styles.root} contentContainerStyle={styles.body}>
        <Text style={styles.dev}>{`Dev harness · fixture data · not in release builds · step ${step} · ${pagesRef.current.length} pages`}</Text>
        {toast ? <Text style={styles.toast} testID="dev-toast">{toast}</Text> : null}
        <View style={styles.steps}>
          <WButton label="1 · Pages" size="sm" onPress={() => setStep("pages")} testID="dev-step-pages" />
          <WButton label="2 · Ari" size="sm" onPress={() => setStep("ari")} testID="dev-step-ari" />
        </View>
        {step === "ari" ? (
          <View style={styles.thread} testID="dev-ari-thread">
            <Text style={styles.owner}>{REQUEST}</Text>
            <Text style={styles.ari}>Here is my plan. Nothing is added until you confirm it.</Text>
            <ToolProposalCard
              toolName="propose_site_page"
              args={PROPOSAL}
              isExecuting={false}
              onConfirm={async () => {
                pagesRef.current = [...BASE_PAGES.slice(0, 2), DRAFT_PAGE, ...BASE_PAGES.slice(2)];
                queryClient.setQueryData(brandSiteKeys.siteData(SITE, "pages"), { revision: "r2", wordmark: "Young and Stamped", pages: pagesRef.current, footer_links: [] });
                setToast("Page added as a Draft to review");
                setStep("draft");
                return { ok: true };
              }}
              onCancel={() => setStep("pages")}
            />
          </View>
        ) : (
          <PagesSection key={step} />
        )}
      </ScrollView>
    </WebsiteProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0c0e12" },
  body: { padding: 16, paddingBottom: 48 },
  dev: { color: "#9aa0a6", fontSize: 12, marginBottom: 12 },
  toast: { color: "#fff", backgroundColor: "#333", padding: 10, borderRadius: 8, marginBottom: 12 },
  steps: { flexDirection: "row", gap: 8, marginBottom: 16 },
  thread: { gap: 12, maxWidth: 640 },
  owner: { alignSelf: "flex-end", color: "#fff", backgroundColor: "#2a2d33", padding: 12, borderRadius: 16, maxWidth: "85%" },
  ari: { color: "#e8eaed", fontSize: 14, lineHeight: 20 },
});
