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
    const wizardSource = repoFile("src/components/event/EventCreatorWizard.tsx");

    expect(source).toContain(".eq(\"status\", \"draft\")");
    expect(source).toContain("ServerDraftLifecycleError");
    expect(source).toContain("isServerDraftLifecycleError");
    expect(source).toContain(".maybeSingle()");
    expect(source).toContain("autosaveServerDraft");
    expect(source).toContain("discardServerDraft");
    expect(source).toContain("business_discard_event_draft");
    expect(source).not.toContain(".update({ deleted_at: new Date().toISOString() })");
    expect(source).toContain("Client-side draft promotion is disabled");
    expect(businessEvents).toContain("business_publish_event_draft");
    expect(wizardSource).toContain("if (isPublishing) return;");
    expect(wizardSource).toContain("disabled={publishDisabled || isPublishing}");
    expect(wizardSource).toContain("confirmLoading={isPublishing}");
    expect(wizardSource).toContain("confirmDisabled={isPublishing}");
  });

  test("stale server-backed drafts retire instead of autosaving local cache", () => {
    const hookSource = repoFile("src/hooks/useServerDraftEvents.ts");
    const editSource = repoFile("app/event/[id]/edit.tsx");
    const previewSource = repoFile("app/event/[id]/preview.tsx");

    expect(hookSource).toContain("isServerDraftLifecycleError");
    expect(hookSource).toContain("Draft retired");
    expect(hookSource).toContain("deleteDraft(draft.id)");
    expect(hookSource).toContain("queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) })");
    expect(hookSource).toContain("!isLocalOnlyDraftId(draft.id)");

    expect(editSource).toContain("staleServerDraft");
    expect(editSource).toContain("serverDraftQuery.data === null");
    expect(editSource).toContain("!draft.id.startsWith(\"d_\")");
    expect(editSource).toContain("onAutosaveDraft={draft.id.startsWith(\"d_\") ? undefined : autosave.saveDraft}");
    expect(editSource).toContain("This draft is no longer editable.");

    expect(previewSource).toContain("staleServerDraft");
    expect(previewSource).toContain("serverDraftQuery.data === null");
    expect(previewSource).toContain("!draft.id.startsWith(\"d_\")");
    expect(previewSource).toContain("!draft.id.startsWith(\"d_\") && !staleServerDraft");
  });

  test("stale draft route recovery cannot be canceled by cleanup-cleared timeout", () => {
    const editSource = repoFile("app/event/[id]/edit.tsx");
    const previewSource = repoFile("app/event/[id]/preview.tsx");
    const editStaleStart = editSource.indexOf("if (staleServerDraft) {");
    const editStaleEnd = editSource.indexOf(
      "if (staleRecoveryDraftIdRef.current === idParam)",
      editStaleStart,
    );
    const previewStaleStart = previewSource.indexOf("if (staleServerDraft) {");
    const previewStaleEnd = previewSource.indexOf(
      "if (staleRecoveryDraftIdRef.current === idParam)",
      previewStaleStart,
    );
    const editStaleBlock = editSource.slice(editStaleStart, editStaleEnd);
    const previewStaleBlock = previewSource.slice(previewStaleStart, previewStaleEnd);

    expect(editSource).toContain("const staleRecoveryDraftIdRef = React.useRef<string | null>(null)");
    expect(previewSource).toContain("const staleRecoveryDraftIdRef = React.useRef<string | null>(null)");

    expect(editStaleBlock).toContain("staleRecoveryDraftIdRef.current = draft.id");
    expect(editStaleBlock).toContain("router.replace(recoveryRoute as never)");
    expect(editStaleBlock).not.toContain("setTimeout");
    expect(editStaleBlock).not.toContain("clearTimeout");
    expect(editSource).toContain("staleRecoveryDraftIdRef.current === idParam");

    expect(previewStaleBlock).toContain("staleRecoveryDraftIdRef.current = draft.id");
    expect(previewStaleBlock).toContain("router.replace(\"/(tabs)/events\" as never)");
    expect(previewStaleBlock).not.toContain("setTimeout");
    expect(previewStaleBlock).not.toContain("clearTimeout");
    expect(previewSource).toContain("staleRecoveryDraftIdRef.current === idParam");
  });

  test("publish and discard cleanup remove draft cache state", () => {
    const businessHooks = repoFile("src/hooks/useBusinessEvents.ts");
    const draftHooks = repoFile("src/hooks/useServerDraftEvents.ts");
    const wizardSource = repoFile("src/components/event/EventCreatorWizard.tsx");

    expect(businessHooks).toContain("deleteDraft(draft.id)");
    expect(businessHooks).toContain("queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) })");
    expect(businessHooks).toContain("(prev) => (prev ?? []).filter((d) => d.id !== draft.id)");

    expect(draftHooks).toContain("discardServerDraft(draft.id)");
    expect(draftHooks).toContain("if (isServerDraftLifecycleError(error)) return;");
    expect(draftHooks).toContain("removeDraftFromListCache(queryClient, draft)");

    expect(wizardSource).toContain("clearTimeout(autosaveTimerRef.current)");
    expect(wizardSource).toContain("autosaveTimerRef.current = null");
  });

  test("draft discard RPC has explicit auth, rank, lifecycle, and grant guards", () => {
    const source = repoFile(
      "../supabase/migrations/20260515000006_orch_0763d_draft_discard_rpc.sql",
    );

    expect(source).toContain("CREATE OR REPLACE FUNCTION public.business_discard_event_draft");
    expect(source).toContain("SECURITY DEFINER");
    expect(source).toContain("v_user_id := auth.uid();");
    expect(source).toContain("RAISE EXCEPTION 'not_authenticated'");
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain("RAISE EXCEPTION 'event_draft_not_found'");
    expect(source).toContain("RAISE EXCEPTION 'event_draft_not_discardable'");
    expect(source).toContain("biz_brand_effective_rank(v_event.brand_id, v_user_id)");
    expect(source).toContain("biz_role_rank('event_manager'");
    expect(source).toContain("RAISE EXCEPTION 'insufficient_event_permission'");
    expect(source).toContain("deleted_at = v_now");
    expect(source).toContain("GRANT EXECUTE ON FUNCTION public.business_discard_event_draft(uuid) TO authenticated, service_role");
  });

  test("draft delete UI handles local-only drafts, server pending state, and visible errors", () => {
    const eventsSource = repoFile("app/(tabs)/events.tsx");
    const dialogSource = repoFile("src/components/ui/ConfirmDialog.tsx");
    const editSource = repoFile("app/event/[id]/edit.tsx");
    const wizardSource = repoFile("src/components/event/EventCreatorWizard.tsx");
    const hookSource = repoFile("src/hooks/useServerDraftEvents.ts");

    expect(eventsSource).toContain("isLocalOnlyDraft");
    expect(eventsSource).toContain("deleteLocalDraft(draft.id)");
    expect(eventsSource).toContain("discardServerDraft.discardDraft(draft)");
    expect(eventsSource).toContain("deleteDraftSubmitting");
    expect(eventsSource).toContain("errorMessage={deleteDraftError}");
    expect(eventsSource).toContain('testID="delete-draft-confirm"');
    expect(eventsSource).toContain('confirmTestID="delete-draft-confirm-button"');
    expect(dialogSource).toContain("confirmLoading");
    expect(dialogSource).toContain("errorMessage");
    expect(editSource).toContain("isLocalOnlyDraft(draftToDiscard)");
    expect(wizardSource).toContain("isLocalOnlyDraft(draft)");
    expect(hookSource).toContain("onError");
    expect(hookSource).toContain("useDiscardServerDraft");
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

  test("server-backed event lifecycle actions use server RPC hooks", () => {
    const detailSource = repoFile("app/event/[id]/index.tsx");
    const eventsSource = repoFile("app/(tabs)/events.tsx");
    const menuSource = repoFile("src/components/event/EventManageMenu.tsx");

    expect(menuSource).toContain("canUseLifecycleActions");
    expect(menuSource).toContain('label: "Share event"');
    expect(menuSource).not.toContain('label: "Copy share link"');
    expect(detailSource).toContain("useCancelBusinessEvent");
    expect(detailSource).toContain("useEndBusinessEventTicketSales");
    expect(detailSource).toContain("cancelServerEvent.cancelEvent");
    expect(detailSource).toContain("endServerTicketSales.endTicketSales");
    expect(detailSource).not.toContain("Server event lifecycle changes are not available yet.");
    expect(detailSource).not.toContain("Server event cancellation is not available yet.");
    expect(detailSource).not.toContain("canUseLifecycleActions={!isServerBackedEvent}");
    expect(eventsSource).toContain("serverBackedEventIds");
    expect(eventsSource).toContain("useCancelBusinessEvent");
    expect(eventsSource).toContain("useEndBusinessEventTicketSales");
    expect(eventsSource).toContain("cancelServerEvent.cancelEvent");
    expect(eventsSource).toContain("endServerTicketSales.endTicketSales");
    expect(eventsSource).not.toContain("Server event lifecycle changes are not available yet.");
    expect(eventsSource).not.toContain("Server event cancellation is not available yet.");
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

  test("server-loaded published event edits can save cover media without local store writes", () => {
    const source = repoFile("src/components/event/EditPublishedScreen.tsx");

    expect(source).toContain("isCoverMediaOnlyPatch");
    expect(source).toContain("canSaveServerCoverMediaOnly");
    expect(source).toContain(
      "disableLocalSaveReason !== undefined && !isCoverMediaOnlyPatch(patch)",
    );
    expect(source).toContain(
      "disableLocalSaveReason !== undefined && isCoverMediaOnlyPatch(patch)",
    );
    expect(source).toContain("invalidateServerEventCaches");
    expect(source).toContain("businessEventKeys.detail(liveEvent.id)");
    expect(source).toContain("publicEventKeys.detailBySlug(");
  });

  test("reduced-motion video covers render through video rather than Image fallback", () => {
    const source = repoFile("src/components/ui/EventCoverMedia.tsx");

    expect(source).toContain('presentation === "video" || presentation === "video_still"');
    expect(source).toContain('autoplay={presentation === "video" ? autoplay : false}');
    expect(source).toContain('loop={presentation === "video" ? loop : false}');
  });
});
