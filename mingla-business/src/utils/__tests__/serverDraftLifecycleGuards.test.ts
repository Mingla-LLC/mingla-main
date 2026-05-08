import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("server-backed draft lifecycle guards", () => {
  test("publish uses the server RPC result instead of local LiveEvent promotion", () => {
    const source = repoFile("src/components/event/EventCreatorWizard.tsx");

    expect(source).toContain("onPublishDraft");
    expect(source).toContain("const slug = await onPublishDraft(draftToPublish)");
    expect(source).toContain("deleteDraft(draftToPublish.id)");
    expect(source).not.toContain("publishDraft(liveDraft.id)");
    expect(source).not.toContain("canConvertDraftToLiveEvent(liveDraft)");
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

  test("server autosave and discard still target draft rows while publish RPC owns promotion", () => {
    const source = repoFile("src/services/eventDrafts.ts");
    const businessEvents = repoFile("src/services/businessEvents.ts");

    expect(source).toContain(".eq(\"status\", \"draft\")");
    expect(source).toContain("autosaveServerDraft");
    expect(source).toContain("discardServerDraft");
    expect(source).toContain("Client-side draft promotion is disabled");
    expect(businessEvents).toContain("business_publish_event_draft");
  });

  test("brand delete blocking statuses use DB lifecycle values, not UI buckets", () => {
    const source = repoFile("src/services/brandsService.ts");

    expect(source).toContain(
      'BRAND_DELETE_BLOCKING_EVENT_STATUSES = ["scheduled", "live"] as const',
    );
    expect(source).not.toContain('["upcoming", "live"]');
  });

  test("new organiser surfaces read published events from server-backed hooks", () => {
    const homeSource = repoFile("app/(tabs)/home.tsx");
    const eventsSource = repoFile("app/(tabs)/events.tsx");
    const detailSource = repoFile("app/event/[id]/index.tsx");
    const editSource = repoFile("app/event/[id]/edit.tsx");

    expect(homeSource).toContain("useBusinessEventsForBrand");
    expect(eventsSource).toContain("useBusinessEventsForBrand");
    expect(detailSource).toContain("useManagedEventRoute");
    expect(editSource).toContain("useBusinessEventById");
    expect(editSource).toContain("disableLocalSaveReason");
  });

  test("Step 7 never advertises draft placeholder slugs as public links", () => {
    const source = repoFile("src/components/event/CreatorStep7Preview.tsx");

    expect(source).toContain("Your public link will be created after publish.");
    expect(source).toContain("!eventSlug.startsWith(\"draft-\")");
    expect(source).not.toContain("eventSlug={draft.serverSlug}");
  });

  test("server autosave hydration uses revision-aware draft upserts", () => {
    const storeSource = repoFile("src/store/draftEventStore.ts");
    const hookSource = repoFile("src/hooks/useServerDraftEvents.ts");
    const wizardSource = repoFile("src/components/event/EventCreatorWizard.tsx");

    expect(storeSource).toContain("upsertServerDraft");
    expect(storeSource).toContain("shouldApplyServerDraft");
    expect(storeSource).toContain("markDraftDirty");
    expect(storeSource).toContain("markDraftSaved");
    expect(hookSource).toContain("upsertServerDrafts");
    expect(hookSource).toContain("const accepted = upsertServerDraft(draft)");
    expect(wizardSource).toContain("clientRevisionRef.current + 1");
    expect(wizardSource).toContain("markDraftDirty(liveDraft.id, nextRevision)");
  });

  test("server-backed event detail lifecycle actions are honest unavailable states", () => {
    const detailSource = repoFile("app/event/[id]/index.tsx");
    const eventsSource = repoFile("app/(tabs)/events.tsx");
    const menuSource = repoFile("src/components/event/EventManageMenu.tsx");

    expect(menuSource).toContain("canUseLifecycleActions");
    expect(detailSource).toContain("Server event lifecycle changes are not available yet.");
    expect(detailSource).toContain("Server event cancellation is not available yet.");
    expect(detailSource).toContain("canUseLifecycleActions={!isServerBackedEvent}");
    expect(eventsSource).toContain("serverBackedEventIds");
    expect(eventsSource).toContain("Server event lifecycle changes are not available yet.");
  });

  test("server-backed management subroutes use shared event route recovery", () => {
    const files = [
      "app/event/[id]/orders/index.tsx",
      "app/event/[id]/orders/[oid]/index.tsx",
      "app/event/[id]/guests/index.tsx",
      "app/event/[id]/guests/[guestId].tsx",
      "app/event/[id]/scanner/index.tsx",
      "app/event/[id]/scanners/index.tsx",
      "app/event/[id]/door/index.tsx",
      "app/event/[id]/door/[saleId].tsx",
      "app/event/[id]/reconciliation.tsx",
    ];

    for (const file of files) {
      const source = repoFile(file);
      expect(source).toContain("useManagedEventRoute");
      expect(source).toContain("replacementEventId");
      expect(source).toContain("Loading event...");
      expect(source).not.toContain("useLiveEventStore");
    }
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
