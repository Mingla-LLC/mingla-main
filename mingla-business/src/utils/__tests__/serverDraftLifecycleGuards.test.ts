import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("server-backed draft lifecycle guards", () => {
  test("publish preflights local conversion before server draft promotion", () => {
    const source = repoFile("src/components/event/EventCreatorWizard.tsx");

    const preflightIndex = source.indexOf("canConvertDraftToLiveEvent(liveDraft)");
    const serverPromotionIndex = source.indexOf("onBeforeLocalPublish?.(liveDraft)");
    const localPublishIndex = source.indexOf("publishDraft(liveDraft.id)");

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(serverPromotionIndex).toBeGreaterThan(preflightIndex);
    expect(localPublishIndex).toBeGreaterThan(serverPromotionIndex);
  });

  test("create route waits for a server draft id before navigation", () => {
    const source = repoFile("app/event/create.tsx");

    const createIndex = source.indexOf("createDraft(currentBrandId)");
    const navigationIndex = source.indexOf("`/event/${newDraft.id}/edit?step=0`");

    expect(createIndex).toBeGreaterThan(-1);
    expect(navigationIndex).toBeGreaterThan(createIndex);
  });

  test("edit and preview routes do not redirect while server draft hydration is loading", () => {
    const editSource = repoFile("app/event/[id]/edit.tsx");
    const previewSource = repoFile("app/event/[id]/preview.tsx");
    const loadingGuard =
      "draft === null &&\n      !serverDraftQuery.isLoading &&\n      !serverDraftQuery.isFetching";

    expect(editSource).toContain(loadingGuard);
    expect(previewSource).toContain(
      "draft === null && !serverDraftQuery.isLoading && !serverDraftQuery.isFetching",
    );
  });

  test("legacy local draft migration stays idempotent", () => {
    const source = repoFile("src/hooks/useServerDraftEvents.ts");

    expect(source).toContain("serverLegacyIds.has(draft.id)");
    expect(source).toContain("migratingIdsRef.current.has(draft.id)");
    expect(source).toContain("replaceDraft(draft.id, serverDraft)");
  });

  test("server autosave, discard, and publish still target draft rows", () => {
    const source = repoFile("src/services/eventDrafts.ts");

    expect(source).toContain(".eq(\"status\", \"draft\")");
    expect(source).toContain("autosaveServerDraft");
    expect(source).toContain("discardServerDraft");
    expect(source).toContain("markServerDraftPublished");
  });

  test("brand delete blocking statuses use DB lifecycle values, not UI buckets", () => {
    const source = repoFile("src/services/brandsService.ts");

    expect(source).toContain(
      'BRAND_DELETE_BLOCKING_EVENT_STATUSES = ["scheduled", "live"] as const',
    );
    expect(source).not.toContain('["upcoming", "live"]');
  });

  test("local publish preserves server event id and event cover media", () => {
    const source = repoFile("src/utils/liveEventConverter.ts");

    expect(source).toContain("serverEventId: draft.id");
    expect(source).toContain("eventSlug: serverEventSlug");
    expect(source).toContain("coverMediaUrl: draft.coverMediaUrl");
    expect(source).toContain("coverMediaType: draft.coverMediaType");
  });

  test("buyer-facing public routes use server-backed public hooks", () => {
    const eventRoute = repoFile("app/e/[brandSlug]/[eventSlug].tsx");
    const brandRoute = repoFile("app/b/[brandSlug]/index.tsx");
    const checkoutRoute = repoFile("app/checkout/[eventId]/index.tsx");

    expect(eventRoute).toContain("usePublicEventBySlug");
    expect(eventRoute).not.toContain("useLiveEventBySlug");
    expect(brandRoute).toContain("usePublicBrandBySlug");
    expect(brandRoute).not.toContain("useBrandList");
    expect(checkoutRoute).toContain("usePublicEventById");
    expect(checkoutRoute).not.toContain("useLiveEventStore");
  });

  test("event/public ticket surfaces render EventCoverMedia instead of direct hue-only covers", () => {
    const files = [
      "src/components/event/CreatorStep7Preview.tsx",
      "src/components/event/PreviewEventView.tsx",
      "src/components/event/PublicEventPage.tsx",
      "src/components/event/EventListCard.tsx",
      "app/(tabs)/home.tsx",
      "app/event/[id]/index.tsx",
      "app/checkout/[eventId]/index.tsx",
      "app/o/[orderId].tsx",
    ];

    for (const file of files) {
      const source = repoFile(file);
      expect(source).toContain("EventCoverMedia");
      expect(source).not.toContain("EventCover hue={event.coverHue}");
    }
  });

  test("published cover media server write is guarded by side-effect-free validation", () => {
    const source = repoFile("src/components/event/EditPublishedScreen.tsx");

    const validationIndex = source.indexOf("validateLiveEventFieldUpdate(");
    const serverWriteIndex = source.indexOf("updatePublishedEventCoverMedia(");

    expect(validationIndex).toBeGreaterThan(-1);
    expect(serverWriteIndex).toBeGreaterThan(validationIndex);
  });

  test("reduced-motion video covers render through video rather than Image fallback", () => {
    const source = repoFile("src/components/ui/EventCoverMedia.tsx");

    expect(source).toContain('presentation === "video" || presentation === "video_still"');
    expect(source).toContain('autoplay={presentation === "video" ? autoplay : false}');
    expect(source).toContain('loop={presentation === "video" ? loop : false}');
  });
});
