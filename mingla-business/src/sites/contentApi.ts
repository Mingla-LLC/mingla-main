/**
 * #2829 W9r — Website content (destinations, stories, reviews), photos, past
 * trips, changes since the last publish, "Last 30 days", "Ask an admin" and
 * the remembered preview size. Service calls and React Query hooks.
 *
 * Imported only by the Website section's lazy chunk (WebsiteApp), never the
 * boot path. Core checks every rank and revision; a stale save comes back as
 * BrandSiteContentConflict carrying the teammate's name and the latest
 * revision, so nothing is overwritten silently.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import {
  BrandSitesError,
  brandSitesErrorFrom,
  createBrandSiteOperationId,
  failureFromInvokeError,
  invokeBrandSiteControl,
} from "../services/brandSitesService";
import { brandSiteKeys } from "./brandSiteKeys";
import type { RichTextDoc } from "../../../packages/site-contracts/src/richText.ts";
import {
  PREVIEW_DEVICE_KEY,
  parsePreviewPreference,
  type PreviewDevicePreference,
} from "./previewDevice";

export type ContentCollection = "destinations" | "stories" | "testimonials";

/** The section name the app uses for each Studio collection. */
export const COLLECTION_OF_SECTION = {
  destinations: "destinations",
  stories: "stories",
  reviews: "testimonials",
} as const satisfies Record<string, ContentCollection>;

export type PictureRef = { id: string; thumb_url: string | null };

export type EntryBase = {
  id: string;
  revision: string;
  enabled: boolean;
  sort_order: number | null;
  thumb_url: string | null;
};

export type DestinationSummary = EntryBase & {
  title: string;
  slug: string;
  country: string | null;
  tagline: string | null;
  photo_count: number;
  photos_missing_alt: number;
  trip_count: number;
};

export type StorySummary = EntryBase & {
  title: string;
  slug: string;
  category: string | null;
  published_at: string | null;
  excerpt: string | null;
};

export type ReviewSummary = EntryBase & {
  quote: string;
  reviewer: string;
  review_date: string | null;
  trip_name: string | null;
  related_offering: string | null;
  confirmed: boolean;
  confirmed_at: string | null;
};

export type DestinationDetail = DestinationSummary & {
  featured_image: PictureRef | null;
  summary: string | null;
  facts: { language: string | null; currency: string | null; religion: string | null; timezone: string | null };
  story_heading: string | null;
  body: RichTextDoc | null;
  seasons: { heading: string; body: string | null; activities: string[]; image: PictureRef | null }[];
  did_you_know: string[];
  related_offerings: string[];
  gallery: (PictureRef & { alt: string | null })[];
  seo: { noindex: boolean };
};

export type StoryDetail = StorySummary & {
  featured_image: PictureRef | null;
  content: RichTextDoc | null;
  seo: { noindex: boolean };
};

export type ReviewDetail = ReviewSummary & { source_note: string | null };

export type EntrySummary = DestinationSummary | StorySummary | ReviewSummary;
export type EntryDetail = DestinationDetail | StoryDetail | ReviewDetail;

export type ContentList<T extends EntrySummary = EntrySummary> = {
  collection: ContentCollection;
  revision: string;
  reordered: boolean;
  entries: T[];
};

/** "<Name> saved a newer version …": the latest revision travels with it. */
export class BrandSiteContentConflict extends BrandSitesError {
  constructor(readonly latest: { revision: string | null; updatedAt: string | null; updatedByName: string | null }) {
    super("REVISION_CONFLICT", "Someone saved a newer version while you were editing.", false);
    this.name = "BrandSiteContentConflict";
  }
}

const CONTENT_MESSAGES: Readonly<Record<string, string>> = {
  REVIEW_NOT_CONFIRMED: "Confirm this review is real before showing it.",
  TITLE_REQUIRED: "Add a name first.",
  QUOTE_REQUIRED: "Paste the review text first.",
  SLUG_TAKEN: "Another page already uses that address. Choose a different one.",
  SLUG_INVALID: "Use lowercase letters, numbers and single hyphens for the address.",
  CATEGORY_IN_USE: "Move its stories to another category before deleting it.",
  CONTENT_LIMIT_EXCEEDED: "This collection is full. Delete an entry first.",
  OFFERING_NOT_FOUND: "That isn't one of your public Mingla trips.",
  TRIP_NOT_ENDED: "Only trips that have ended can be hidden here.",
  NOT_FOUND: "That isn't on your website any more. It may have been deleted.",
};

async function contentCall<T>(siteId: string, action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: T; error?: unknown }>(
    "brand-site-control",
    { body: { route: `/v1/sites/${siteId}/content`, method: "POST", action, operation_id: createBrandSiteOperationId(), args } },
  );
  if (error !== null) {
    const context = (error as { context?: { status?: unknown; json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } } }).context;
    if (context && typeof context.json === "function") {
      const body = await (typeof context.clone === "function" ? context.clone().json() : context.json()).catch(() => null) as
        | { error?: { code?: unknown; message?: unknown; latest?: Record<string, unknown> } }
        | null;
      const code = body?.error?.code;
      if (code === "REVISION_CONFLICT") {
        const latest = body?.error?.latest ?? {};
        throw new BrandSiteContentConflict({
          revision: typeof latest.revision === "string" ? latest.revision : null,
          updatedAt: typeof latest.updated_at === "string" ? latest.updated_at : null,
          updatedByName: typeof latest.updated_by_name === "string" ? latest.updated_by_name : null,
        });
      }
      if (typeof code === "string" && CONTENT_MESSAGES[code]) {
        throw new BrandSitesError(code, CONTENT_MESSAGES[code]!, false);
      }
      throw brandSitesErrorFrom(typeof context.status === "number" ? context.status : null, body);
    }
    throw await failureFromInvokeError(error);
  }
  if (!data || data.ok !== true) throw brandSitesErrorFrom(null, data);
  return data.data as T;
}

export const listContent = <T extends EntrySummary>(siteId: string, collection: ContentCollection) =>
  contentCall<ContentList<T>>(siteId, "list", { collection });

export const getContentEntry = <T extends EntryDetail>(siteId: string, collection: ContentCollection, id: string) =>
  contentCall<{ entry: T }>(siteId, "get", { collection, id }).then((result) => result.entry);

export type EntryWrite = Record<string, unknown>;

export function createContentEntry<T extends EntryDetail>(siteId: string, collection: ContentCollection, data: EntryWrite) {
  return contentCall<{ entry: T }>(siteId, "create", { collection, data }).then((result) => result.entry);
}

export function updateContentEntry<T extends EntryDetail>(input: {
  siteId: string; collection: ContentCollection; id: string; revision: string; data: EntryWrite;
}) {
  return contentCall<{ entry: T }>(input.siteId, "update", {
    collection: input.collection, id: input.id, expected_revision: input.revision, data: input.data,
  }).then((result) => result.entry);
}

export function setContentVisibility(input: { siteId: string; collection: ContentCollection; id: string; revision: string; enabled: boolean }) {
  return contentCall<{ entry: EntrySummary }>(input.siteId, "set_visibility", {
    collection: input.collection, id: input.id, expected_revision: input.revision, enabled: input.enabled,
  });
}

export function deleteContentEntry(input: { siteId: string; collection: ContentCollection; id: string; revision: string }) {
  return contentCall<{ deleted: string }>(input.siteId, "delete", {
    collection: input.collection, id: input.id, expected_revision: input.revision,
  });
}

export function reorderContent(input: { siteId: string; collection: ContentCollection; ids: string[]; listRevision: string }) {
  return contentCall<{ revision: string; ids: string[] }>(input.siteId, "reorder", {
    collection: input.collection, ids: input.ids, expected_list_revision: input.listRevision,
  });
}

export function confirmReview(input: { siteId: string; id: string; revision: string; confirmed: boolean }) {
  return contentCall<{ entry: ReviewSummary }>(input.siteId, "confirm_review", {
    id: input.id, expected_revision: input.revision, confirmed: input.confirmed,
  });
}

export type StoryCategory = { id: string; title: string; slug: string; revision: string; story_count: number };

export type PastTrip = {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  destination: string | null;
  travellers?: number;
  cover_url: string | null;
  hidden: boolean;
};

export type MinglaOffering = {
  id: string;
  kind: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  status: string | null;
  ended: boolean;
  spots_left: number | null;
  public_url: string | null;
};

export type DraftChange = { section: string; title: string; detail: string };
/**
 * #2829 W10 — the Website overview's "Last 30 days", from Core's one analytics
 * reader (consent-gated visitor events, #4111 enquiry count, attributed
 * bookings). Counts and page addresses only.
 */
export type OverviewCounts = {
  visits_30d: number;
  enquiries_30d: number;
  bookings_30d: number;
  book_clicks_30d: number;
  top_pages: Array<{ path: string; views: number }>;
  sources: Partial<Record<"direct" | "search" | "social" | "mingla" | "other", number>>;
};

const SOURCE_KEYS = ["direct", "search", "social", "mingla", "other"] as const;

export function overviewCountsFrom(data: unknown): OverviewCounts {
  const value = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const n = (raw: unknown) => (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0);
  const pages = Array.isArray(value.top_pages) ? value.top_pages : [];
  const sourcesRaw = (value.sources && typeof value.sources === "object" ? value.sources : {}) as Record<string, unknown>;
  const sources: OverviewCounts["sources"] = {};
  for (const key of SOURCE_KEYS) if (n(sourcesRaw[key]) > 0) sources[key] = n(sourcesRaw[key]);
  return {
    visits_30d: n(value.visits_30d),
    enquiries_30d: n(value.enquiries_30d),
    bookings_30d: n(value.bookings_30d),
    book_clicks_30d: n(value.book_clicks_30d),
    top_pages: pages
      .map((row) => row as { path?: unknown; views?: unknown })
      .filter((row): row is { path: string; views: number } => typeof row.path === "string" && row.path.startsWith("/") && typeof row.views === "number")
      .slice(0, 5),
    sources,
  };
}
export type MediaItem = { id: string; filename: string; width: number | null; height: number | null; thumb_url: string | null };

/*
 * ── Hooks ─────────────────────────────────────────────────────────────────
 * Server state only; every mutation's onError reaches the screen (the caller
 * shows it), and every success invalidates the keys it changed.
 */
export function useContentList<T extends EntrySummary>(siteId: string | null, collection: ContentCollection, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.content(siteId, collection),
    queryFn: () => listContent<T>(siteId!, collection),
    enabled: siteId !== null && enabled,
    staleTime: 15_000,
  });
}

export function useContentEntry<T extends EntryDetail>(siteId: string | null, collection: ContentCollection, id: string | null) {
  return useQuery({
    queryKey: brandSiteKeys.contentEntry(siteId, collection, id ?? ""),
    queryFn: () => getContentEntry<T>(siteId!, collection, id!),
    enabled: siteId !== null && id !== null,
    staleTime: 0,
  });
}

/** After any content change: the lists, the counts, and "changes since you last published". */
function useInvalidateContent(siteId: string | null) {
  const client = useQueryClient();
  return (collection: ContentCollection | "categories" | null) => {
    if (collection) void client.invalidateQueries({ queryKey: brandSiteKeys.content(siteId, collection) });
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
  };
}

export function useSaveContentEntry(siteId: string | null, collection: ContentCollection) {
  const invalidate = useInvalidateContent(siteId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string | null; revision: string | null; data: EntryWrite }) => {
      if (!siteId) throw new BrandSitesError("SITE_UNAVAILABLE", "Mingla could not find this brand’s website.", false);
      return input.id && input.revision
        ? updateContentEntry({ siteId, collection, id: input.id, revision: input.revision, data: input.data })
        : createContentEntry(siteId, collection, input.data);
    },
    onSuccess: (entry) => {
      client.setQueryData(brandSiteKeys.contentEntry(siteId, collection, entry.id), entry);
      invalidate(collection);
    },
  });
}

export function useContentRowActions(siteId: string | null, collection: ContentCollection) {
  const invalidate = useInvalidateContent(siteId);
  const visibility = useMutation({
    mutationFn: (input: { id: string; revision: string; enabled: boolean }) => setContentVisibility({ siteId: siteId!, collection, ...input }),
    onSettled: () => invalidate(collection),
  });
  const reorder = useMutation({
    mutationFn: (input: { ids: string[]; listRevision: string }) => reorderContent({ siteId: siteId!, collection, ...input }),
    onSettled: () => invalidate(collection),
  });
  const remove = useMutation({
    mutationFn: (input: { id: string; revision: string }) => deleteContentEntry({ siteId: siteId!, collection, ...input }),
    onSettled: () => invalidate(collection),
  });
  return { visibility, reorder, remove };
}

export function useConfirmReview(siteId: string | null) {
  const invalidate = useInvalidateContent(siteId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; revision: string; confirmed: boolean }) => confirmReview({ siteId: siteId!, ...input }),
    onSettled: (_data, _error, input) => {
      invalidate("testimonials");
      void client.invalidateQueries({ queryKey: brandSiteKeys.contentEntry(siteId, "testimonials", input.id) });
    },
  });
}

export function useStoryCategories(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "categories"),
    queryFn: () => contentCall<{ revision: string; categories: StoryCategory[] }>(siteId!, "categories"),
    enabled: siteId !== null && enabled,
  });
}

export function useCategoryActions(siteId: string | null) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "categories") });
    void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
  };
  return {
    create: useMutation({ mutationFn: (title: string) => contentCall<{ id: string }>(siteId!, "create_category", { title }), onSettled: refresh }),
    rename: useMutation({
      mutationFn: (input: { id: string; revision: string; title: string }) =>
        contentCall(siteId!, "rename_category", { id: input.id, expected_revision: input.revision, title: input.title }),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (input: { id: string; revision: string }) => contentCall(siteId!, "delete_category", { id: input.id, expected_revision: input.revision }),
      onSettled: refresh,
    }),
    reorder: useMutation({
      mutationFn: (input: { ids: string[]; listRevision: string }) =>
        contentCall(siteId!, "reorder_categories", { ids: input.ids, expected_list_revision: input.listRevision }),
      onSettled: refresh,
    }),
  };
}

export function usePastTrips(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "past-trips"),
    queryFn: () => contentCall<{ revision: string | null; can_hide: boolean; trips: PastTrip[] }>(siteId!, "past_trips"),
    enabled: siteId !== null && enabled,
  });
}

export function useSetPastTripHidden(siteId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { offeringId: string; hidden: boolean; revision: string }) =>
      contentCall<{ revision: string; hidden_offering_ids: string[] }>(siteId!, "set_offering_visibility", {
        offering_id: input.offeringId, hidden: input.hidden, expected_revision: input.revision,
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "past-trips") });
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
    },
  });
}

export function useMinglaOfferings(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "offerings"),
    queryFn: () => contentCall<{ offerings: MinglaOffering[] }>(siteId!, "offerings").then((result) => result.offerings),
    enabled: siteId !== null && enabled,
    staleTime: 60_000,
  });
}

export function useDraftChanges(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "changes"),
    queryFn: () => contentCall<{ published_at: string | null; changes: DraftChange[] }>(siteId!, "draft_changes"),
    enabled: siteId !== null && enabled,
    staleTime: 10_000,
  });
}

/** #2829 W9b — one of the six design checks, in plain English (warnings never block). */
export type DesignCheckKey = "words" | "photos" | "readability" | "links" | "truth" | "phone";
export type DesignCheck = {
  key: DesignCheckKey;
  label: string;
  status: "pass" | "warn";
  items: { message: string; page_path?: string | null; section?: string }[];
};
export type DesignCheckRun = { draft_digest: string; warning_count: number; checks: DesignCheck[]; ran_at: string };

/**
 * #2829 W9b — the Publish review runs the six design checks on open and
 * stores the result against this exact draft (a site's first publish needs
 * that run). Never cached across drafts: every open re-runs.
 */
export function useDesignChecks(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "design-checks"),
    queryFn: () => contentCall<DesignCheckRun>(siteId!, "design_checks"),
    enabled: siteId !== null && enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** #2829 W9b — "Why it looks like this": what Ari changed, why, and what it was based on. */
export type WorkLogCite = { kind: "owner_words" | "mingla_record" | "owner_material"; quote?: string; record_id?: string; media_id?: string };
export type WorkLogEntry = {
  id: string;
  part: string;
  decision: string;
  cites: WorkLogCite[];
  actor: "ari" | "user";
  target: string | null;
  created_at: string;
};

export function useWorkLog(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "work-log"),
    queryFn: () => contentCall<{ entries: WorkLogEntry[] }>(siteId!, "work_log").then((result) => result.entries),
    enabled: siteId !== null && enabled,
    staleTime: 30_000,
  });
}

export function useOverviewCounts(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "counts"),
    queryFn: async (): Promise<OverviewCounts> => {
      const { data, error } = await supabase.rpc("brand_site_overview_counts", { p_site_id: siteId });
      if (error) throw new BrandSitesError("SERVICE_TEMPORARILY_UNAVAILABLE", "Your website numbers couldn’t be loaded.", true);
      return overviewCountsFrom(data);
    },
    enabled: siteId !== null && enabled,
    staleTime: 60_000,
  });
}

export function useMediaLibrary(siteId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "media"),
    queryFn: () => contentCall<{ media: MediaItem[] }>(siteId!, "media_library").then((result) => result.media),
    enabled: siteId !== null && enabled,
  });
}

export function useFontSearch(siteId: string | null, query: string, category: string | null, enabled: boolean) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, `font-search:${category ?? "all"}:${query}`),
    queryFn: () => contentCall<{ fonts: { family: string; category: string }[] }>(siteId!, "font_search", {
      query, ...(category ? { category } : {}),
    }).then((result) => result.fonts),
    enabled: siteId !== null && enabled,
    staleTime: 5 * 60_000,
  });
}

/** Specimen links for up to 12 families (rows ask as they scroll into view). */
export function useFontPreviews(siteId: string | null, families: readonly string[], format: "woff2" | "ttf" = "woff2") {
  const sorted = [...new Set(families)].sort().slice(0, 12);
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, `font-previews:${format}:${sorted.join("|")}`),
    queryFn: () => contentCall<{ previews: { family: string; url: string | null }[] }>(siteId!, "font_previews", format === "ttf" ? { families: sorted, format } : { families: sorted })
      .then((result) => result.previews),
    enabled: siteId !== null && sorted.length > 0,
    staleTime: 45 * 60_000,
  });
}

/*
 * Photos: the existing pipeline (quarantine → checked → renditions). The
 * file goes straight to storage with the 5-minute link Studio issues; Studio
 * then checks it and makes the renditions.
 */
export async function uploadSitePhoto(input: {
  siteId: string;
  file: { uri: string; name: string; type: string; size: number };
  onStatus?: (status: "uploading" | "checking") => void;
}): Promise<{ mediaId: string; thumbUrl: string | null }> {
  input.onStatus?.("uploading");
  const grant = await contentCall<{ media_id: string; upload_url: string; required_headers?: Record<string, string> }>(
    input.siteId, "media_upload_grant", { filename: input.file.name, content_type: input.file.type, bytes: input.file.size },
  );
  const blob = await (await fetch(input.file.uri)).blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const put = await fetch(grant.upload_url, { method: "PUT", headers: grant.required_headers ?? { "content-type": input.file.type }, body: blob });
  if (!put.ok) throw new BrandSitesError("MEDIA_REJECTED", "That photo couldn’t be uploaded. Try again.", true);
  input.onStatus?.("checking");
  const done = await contentCall<{ media_id: string; state: string }>(input.siteId, "media_complete", {
    media_id: grant.media_id, checksum, bytes: bytes.byteLength,
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = attempt === 0 && done.state === "READY"
      ? { state: "READY", thumb_url: null as string | null }
      : await contentCall<{ state: string; thumb_url: string | null; rejection_code: string | null }>(input.siteId, "media_status", { media_id: grant.media_id });
    if (status.state === "READY") {
      const ready = status.thumb_url !== null ? status
        : await contentCall<{ state: string; thumb_url: string | null }>(input.siteId, "media_status", { media_id: grant.media_id });
      return { mediaId: grant.media_id, thumbUrl: ready.thumb_url };
    }
    if (status.state === "REJECTED" || status.state === "TOMBSTONED") {
      throw new BrandSitesError("MEDIA_REJECTED", CONTENT_MESSAGES.MEDIA_REJECTED ?? "That file couldn’t be accepted. Photos must be JPEG, PNG or WebP under 20 MB.", false);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new BrandSitesError("MEDIA_PROCESSING", "That photo is still being prepared. Try again in a minute.", true);
}

/* ── "Ask an admin" ──────────────────────────────────────────────────────── */
export type AdminAsk = "publish" | "restore" | "confirm_review" | "domain" | "offline" | "download" | "past_trip" | "plan";

export const ASK_WORDS: Readonly<Record<AdminAsk, string>> = {
  publish: "publish the website",
  restore: "restore an earlier version",
  confirm_review: "confirm this review",
  domain: "change the website's addresses",
  offline: "change whether the website is online",
  download: "download the website",
  past_trip: "hide or show a past trip",
  plan: "finish this part of the setup plan",
};

export function useAskAdmin(brandId: string) {
  return useMutation({
    mutationFn: (action: AdminAsk) =>
      invokeBrandSiteControl<{ notified: number; already_asked: boolean }>(`/v1/brands/${brandId}/site-admin-request`, "POST", { action }),
  });
}

/* ── Preview size, remembered per user ──────────────────────────────────── */
const cacheKey = (userId: string) => `mingla:${PREVIEW_DEVICE_KEY}:${userId}`;

export async function readCachedPreviewPreference(userId: string): Promise<PreviewDevicePreference | null> {
  try {
    return parsePreviewPreference(JSON.parse((await AsyncStorage.getItem(cacheKey(userId))) ?? "null"));
  } catch {
    return null;
  }
}

export async function clearCachedPreviewPreference(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(userId));
  } catch {
    // Only the first-paint cache; the server row is the truth.
  }
}

export async function fetchPreviewPreference(userId: string): Promise<PreviewDevicePreference | null> {
  // #2829 W11 — RPC-only: Core reads the signed-in member's own row.
  const { data, error } = await supabase.rpc("business_ui_preference_get", { p_key: PREVIEW_DEVICE_KEY });
  if (error) throw new BrandSitesError("SERVICE_TEMPORARILY_UNAVAILABLE", "Your preview size couldn’t be loaded.", true);
  const preference = parsePreviewPreference(data);
  if (preference) {
    try {
      await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(preference));
    } catch {
      // First-paint cache only.
    }
  }
  return preference;
}

export async function savePreviewPreference(userId: string, preference: PreviewDevicePreference): Promise<PreviewDevicePreference> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(preference));
  } catch {
    // First-paint cache only.
  }
  // #2829 W11 — RPC-only: Core writes the signed-in member's own row.
  const { error } = await supabase.rpc("business_ui_preference_set", { p_key: PREVIEW_DEVICE_KEY, p_value: preference });
  if (error) throw new BrandSitesError("SERVICE_TEMPORARILY_UNAVAILABLE", "Your preview size couldn’t be saved on Mingla. It’s kept on this device.", true);
  return preference;
}

/* ── Pages and the header menu ───────────────────────────────────────────── */
export type SitePageRow = {
  id: string;
  title: string;
  path: string | null;
  kind: string;
  collection_kind: string | null;
  planned_offering: string | null;
  enabled: boolean;
  in_menu: boolean;
  in_group: boolean;
  menu_index: number | null;
  revision: string;
};

export type SitePages = { revision: string; wordmark: string | null; pages: SitePageRow[]; footer_links: { label: string; href: string }[] };

export function useSitePages(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "pages"),
    queryFn: () => contentCall<SitePages>(siteId!, "pages"),
    enabled: siteId !== null && enabled,
  });
}

export function useSetSiteMenu(siteId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { pageIds: string[]; revision: string }) =>
      contentCall<{ revision: string }>(siteId!, "set_menu", { page_ids: input.pageIds, expected_revision: input.revision }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "pages") });
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "preview") });
    },
  });
}

/* ── Cover (the home page's big photo or video) ─────────────────────────── */
export type CoverMedia = { id: string; name: string; thumb_url: string | null; duration_ms: number | null };
export type SiteCover = { available: boolean; revision: string | null; photo: CoverMedia | null; video: CoverMedia | null };

export function useSiteCover(siteId: string | null, enabled = true) {
  return useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "cover"),
    queryFn: () => contentCall<SiteCover>(siteId!, "cover"),
    enabled: siteId !== null && enabled,
  });
}

export function useSetSiteCover(siteId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { revision: string; photoMediaId?: string; videoMediaId?: string | null }) =>
      contentCall<{ saved: boolean }>(siteId!, "set_cover", {
        expected_revision: input.revision,
        ...(input.photoMediaId !== undefined ? { photo_media_id: input.photoMediaId } : {}),
        ...(input.videoMediaId !== undefined ? { video_media_id: input.videoMediaId } : {}),
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "cover") });
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "changes") });
      void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "preview") });
    },
  });
}
