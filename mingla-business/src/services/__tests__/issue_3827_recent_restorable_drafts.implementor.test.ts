/* eslint-disable import/first -- The canonical lifecycle mock must be installed before the service import. */
jest.mock("../../components/trip/TripDetailHeroStatusPill", () => ({
  deriveTripLifecycleStatus: (input: { status: string }) => input.status,
}));

import {
  retainAuthoritativeBusinessRecentPointers,
  type BusinessRecentIndexRow,
} from "../businessRecentService";
import type { BusinessRecentPointer } from "../../store/businessRecentStore";

const pointer = (
  entityType: BusinessRecentPointer["entityType"],
  entityId: string,
  overrides: Partial<BusinessRecentPointer> = {},
): BusinessRecentPointer => ({
  entityType,
  entityId,
  lastOpenedAt: "2026-10-15T12:00:00.000Z",
  operationId: `op-${entityId}`,
  pendingSync: false,
  localDraft: false,
  ...overrides,
});

const indexRow = (
  entityType: BusinessRecentIndexRow["entityType"],
  entityId: string,
): BusinessRecentIndexRow => ({
  pointerId: `pointer-${entityId}`,
  entityType,
  entityId,
  lastOpenedAt: "2026-10-15T12:00:00.000Z",
  lifecycleStatus: entityType === "venue" ? "verified" : "upcoming",
  rawStatus: entityType === "venue" ? "verified" : "scheduled",
  startsAt: null,
  endsAt: null,
  endedAt: null,
});

test("orphaned local drafts stay hidden before hydration and are rejected afterwards", () => {
  const rows = [
    pointer("event", "d_orphan", { localDraft: true }),
    pointer("rsvp", "d_restorable", { localDraft: true }),
    pointer("event", "server-promoted", { pendingSync: true }),
  ];

  expect(
    retainAuthoritativeBusinessRecentPointers(rows, [], null).map(
      (row) => row.entityId,
    ),
  ).toEqual(["server-promoted"]);

  expect(
    retainAuthoritativeBusinessRecentPointers(
      rows,
      [],
      new Set(["rsvp:d_restorable"]),
    ).map((row) => row.entityId),
  ).toEqual(["d_restorable", "server-promoted"]);
});

test("authoritative drafts, published offerings, trips, experiences, and venues are unaffected", () => {
  const rows: BusinessRecentPointer[] = [
    pointer("event", "event-draft"),
    pointer("event", "event-published"),
    pointer("rsvp", "rsvp-draft"),
    pointer("trip", "trip-live"),
    pointer("experience", "experience-live"),
    pointer("venue", "venue-live"),
  ];
  const indexRows = rows.map((row) => indexRow(row.entityType, row.entityId));

  expect(
    retainAuthoritativeBusinessRecentPointers(rows, indexRows, new Set()).map(
      (row) => `${row.entityType}:${row.entityId}`,
    ),
  ).toEqual(rows.map((row) => `${row.entityType}:${row.entityId}`));
});
