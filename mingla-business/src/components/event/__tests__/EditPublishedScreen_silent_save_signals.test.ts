/**
 * ORCH-0980 [Silent-save-failure bug class — regression pin].
 *
 * Investigation `INVESTIGATION_ORCH-0980_REHOME_CURRENT_MAIN.md` §6.3 proved
 * that both original silent-save bugs are already fixed-by-construction on
 * current main: `handleConfirmSave` is now five independent sequential
 * server-patch blocks (cover-media, ORCH-0824 taxonomy/address, ORCH-0877
 * When, ORCH-0964 theme, ORCH-1006 pricing), each failing-closed with a
 * VISIBLE toast, then a clean success fast-path (toast + navigate), then a
 * local-store path whose `{ok:false}` opens a VISIBLE reject dialog — plus
 * an up-front block-with-toast in `handleSavePress` for any patch that
 * touches a non-server-editable field on a server-loaded event.
 *
 * These four tests LOCK that contract: every TERMINAL save path surfaces a
 * visible signal (toast or dialog). No terminal path is silent. They are the
 * regression pin so a future refactor cannot silently re-open the class.
 *
 * Seam approach (matches the established siblings
 * `EditPublishedScreen.coverPersistence.test.tsx` +
 * `EditPublishedScreen_when_save_gate.test.ts` +
 * `publishedEventEditGuards.test.ts`):
 *   - T-01..T-03 read `EditPublishedScreen.tsx` as source text and assert the
 *     exact `showToast(...)` / dialog signal that terminates each path. They
 *     are FAIL-ON-REVERT: deleting or altering the asserted `showToast(...)`
 *     string on the corresponding path breaks the matching test.
 *   - T-04 is a pure behavioral unit test on `validateLiveEventFieldUpdate`
 *     (no RN render needed), proving the client guard returns a structured
 *     rejection — which `handleConfirmSave` renders as a visible reject
 *     dialog (the `{ok:false}` -> `buildRejectDialog` -> `<ConfirmDialog>`
 *     path) rather than failing silently.
 *
 * fails-on-revert anchors (see IMPLEMENTATION report for the captured proof):
 *   T-01 -> EditPublishedScreen.tsx clean-success fast-path showToast("Saved. Live now.")
 *   T-02 -> EditPublishedScreen.tsx When-block catch showToast(message) (drop-a-date copy)
 *   T-03 -> EditPublishedScreen.tsx handleSavePress up-front showToast(disableLocalSaveReason)
 *   T-04 -> publishedEventEditGuards.ts multi_date_remove_with_sales rejection branch
 *
 * NO behavior change to EditPublishedScreen.tsx — this file is the pin only.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

import type { LiveEvent } from "../../../store/liveEventStore";
import type { TicketStub } from "../../../store/draftEventStore";
import { validateLiveEventFieldUpdate } from "../../../utils/publishedEventEditGuards";

const SCREEN_PATH = path.resolve(__dirname, "..", "EditPublishedScreen.tsx");

const readScreen = (): string => fs.readFileSync(SCREEN_PATH, "utf8");

/** Slice between two needles so a structural assertion is scoped to the block. */
const sliceBetween = (
  source: string,
  startNeedle: string,
  endNeedle: string,
): string => {
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("ORCH-0980 — EditPublishedScreen save paths are never silent", () => {
  // ---- T-01: success fast-path surfaces a toast --------------------------
  // Server-editable-only patch on a server-loaded event takes the unified
  // clean-termination fast-path, which MUST emit "Saved. Live now." and
  // navigate. If this toast is removed the success becomes silent.
  test("T-01: clean server-editable success fast-path shows the 'Saved. Live now.' toast (no silent success)", () => {
    const src = readScreen();
    const fastPath = sliceBetween(
      src,
      "ORCH-0824 hotfix: unified early-return for server-editable-only",
      "const result = updateLiveEventFields(",
    );

    // The fast-path is gated on server-editable-only + disableLocalSaveReason,
    // and MUST terminate with the success toast + navigation.
    expect(fastPath).toContain("disableLocalSaveReason !== undefined &&");
    expect(fastPath).toContain("isServerEditableOnlyPatch(patch)");
    expect(fastPath).toContain('showToast("Saved. Live now.");');
    expect(fastPath).toContain("router.back();");
    expect(fastPath).toContain("return;");
  });

  // ---- T-02: server-block failure surfaces a toast -----------------------
  // When the When-RPC rejects (e.g. multi_date_remove_with_sales), the catch
  // MUST surface the drop-a-date copy via showToast. If the catch's
  // showToast(message) is removed the failure becomes silent.
  test("T-02: When-block RPC rejection shows the active-tickets toast (no silent server failure)", () => {
    const src = readScreen();
    const whenCatch = sliceBetween(
      src,
      "patchPublishedEventWhen({",
      "const themePatchPresent = patch.themeOverrides !== undefined;",
    );

    // The catch maps the RPC reject codes to user copy and surfaces it.
    expect(whenCatch).toContain("} catch (error) {");
    expect(whenCatch).toContain('code === "multi_date_remove_with_sales"');
    expect(whenCatch).toContain(
      "This change would drop a date with active tickets. Cancel or refund those tickets first.",
    );
    expect(whenCatch).toContain("showToast(message);");
    // And it aborts before falling through to the success path.
    expect(whenCatch).toContain("return;");
  });

  // ---- T-03: up-front non-editable block surfaces a toast ----------------
  // A patch touching a non-server-editable field on a server-loaded event is
  // blocked in handleSavePress with showToast(disableLocalSaveReason) BEFORE
  // the modal ever opens. If that toast is removed the block becomes silent.
  test("T-03: up-front non-server-editable block shows the disableLocalSaveReason toast (no silent block)", () => {
    const src = readScreen();
    const handleSavePress = sliceBetween(
      src,
      "const handleSavePress = useCallback((): void => {",
      "const invalidateServerEventCaches = useCallback",
    );

    expect(handleSavePress).toContain("disableLocalSaveReason !== undefined &&");
    expect(handleSavePress).toContain("!isServerEditableOnlyPatch(patch)");
    expect(handleSavePress).toContain("showToast(disableLocalSaveReason);");
    expect(handleSavePress).toContain("return;");
  });

  // ---- T-03b: local-store reject opens a visible dialog ------------------
  // Defensive companion to T-01: the residual local updateLiveEventFields
  // {ok:false} branch MUST open a visible reject dialog, never fail silently.
  test("T-03b: local-store rejection opens a visible reject dialog (no silent local reject)", () => {
    const src = readScreen();
    const localPath = sliceBetween(
      src,
      "const result = updateLiveEventFields(",
      "const handleModalClose = useCallback",
    );

    expect(localPath).toContain("if (result.ok) {");
    expect(localPath).toContain('showToast("Saved. Live now.");');
    // Guard-rail rejection -> visible dialog, not a silent no-op.
    expect(localPath).toContain("setRejectDialog(buildRejectDialog(result));");
  });
});

// ---- T-04: client guard returns a structured rejection (rendered as a
// visible dialog by handleConfirmSave) — behavioral unit test --------------

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1",
  name: "General",
  priceGbp: 20,
  capacity: 10,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "le_1",
  serverEventId: "event-1",
  brandId: "brand-1",
  brandSlug: "brand",
  eventSlug: "event",
  status: "live",
  publishedAt: "2026-06-01T10:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  name: "Live event",
  description: "A live event.",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-06-10",
  doorsOpen: "18:00",
  endsAt: "22:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Studio",
  address: "1 Road",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: "https://cdn.example.com/old.jpg",
  coverMediaType: "image",
  tickets: [ticket()],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  orders: [],
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:00:00.000Z",
  ...patch,
});

describe("ORCH-0980 — T-04 client guard rejects single-mode date change with sales (no silent pass)", () => {
  test("T-04: single-mode date change on an event with sold tickets returns multi_date_remove_with_sales", () => {
    // single-mode event with a sold ticket; the operator tries to change the
    // single date (which drops the original date) -> client guard MUST reject
    // with a structured reason that handleConfirmSave renders as a visible
    // "Refund first" dialog (buildRejectDialog), never a silent pass.
    const result = validateLiveEventFieldUpdate(
      liveEvent({ whenMode: "single", date: "2026-06-10" }),
      { date: "2026-06-20" },
      { soldCountByTier: { "ticket-1": 3 }, soldCountForEvent: 3 },
      "Moving the event to a new date for the venue",
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the guard to reject the date change");
    }
    expect(result.reason).toBe("multi_date_remove_with_sales");
    expect(result.affectedOrderCount).toBe(3);
    expect(result.droppedDates).toContain("2026-06-10");
  });

  test("T-04b: the same date change with zero sales passes (guard is not over-broad)", () => {
    const result = validateLiveEventFieldUpdate(
      liveEvent({ whenMode: "single", date: "2026-06-10" }),
      { date: "2026-06-20" },
      { soldCountByTier: {}, soldCountForEvent: 0 },
      "Moving the event to a new date for the venue",
    );

    expect(result).toEqual({
      ok: true,
      trimmedReason: "Moving the event to a new date for the venue",
    });
  });
});
