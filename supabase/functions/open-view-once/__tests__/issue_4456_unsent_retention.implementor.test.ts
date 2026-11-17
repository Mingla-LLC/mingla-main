// Issue #4456 — the hourly media sweep deletes an unsent message's kept file
// and thumbnail once its 30-day private copy is due (reason "unsent_retention",
// listed by issue_4114_view_once_media_due, which leaves out copies an open
// report names), then drops the copies through issue_4456_purge_unsent_evidence.
//
//   * both kept objects (a view-once file under once/ included) are removed;
//   * the copies are dropped only after the files, and never marked view-once
//     purged or media-expired;
//   * a failed delete stops before any copy is dropped;
//   * a failed drop fails the sweep (500) instead of reporting success;
//   * a non-canonical path is never handed to the deleter.
//
// FAILS-ON-REVERT: remove the "unsent_retention" path filter and the first test
// fails (nothing is removed); drop the purgeUnsentEvidence call and the first
// test fails; call it before the removal and the delete-failure test fails.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createOpenViewOnceHandler, type DueRow, type OpenViewOnceDeps } from "../handler.ts";

const CONV = "11111111-1111-4111-8111-111111111111";
const PHOTO_MSG = "22222222-2222-4222-8222-222222222222";
const ONCE_MSG = "33333333-3333-4333-8333-333333333333";
const PHOTO_OBJ = "44444444-4444-4444-8444-444444444444";
const ONCE_OBJ = "55555555-5555-4555-8555-555555555555";

interface Seen {
  removed: string[];
  purged: string[];
  expired: string[];
  evidence: string[][];
  order: string[];
}

function seen(): Seen {
  return { removed: [], purged: [], expired: [], evidence: [], order: [] };
}

function deps(due: DueRow[], s: Seen, opts: { failRemove?: boolean; failEvidence?: boolean } = {}): OpenViewOnceDeps {
  return {
    userIdFor: async () => null,
    isCronCaller: async (authorization) => authorization === "Bearer service-role",
    loadMessage: async () => ({ data: null, error: null }),
    isParticipant: async () => ({ data: false, error: null }),
    signUrl: async () => ({ data: null, error: "unused" }),
    recordView: async () => ({ data: { inserted: false, viewedAt: null }, error: null }),
    listDue: async () => ({ data: due, error: null }),
    removeObjects: async (paths) => {
      s.order.push("remove");
      if (opts.failRemove) return { error: "storage_down" };
      s.removed.push(...paths);
      return { error: null };
    },
    markPurged: async (ids) => {
      s.purged.push(...ids);
      return { error: null };
    },
    markExpired: async (ids) => {
      s.expired.push(...ids);
      return { error: null };
    },
    purgeUnsentEvidence: async (ids) => {
      s.order.push("evidence");
      if (opts.failEvidence) return { data: 0, error: "db_down" };
      s.evidence.push(ids);
      return { data: ids.length + 1, error: null };
    },
  };
}

function sweepRequest(): Request {
  return new Request("http://local/open-view-once", {
    method: "POST",
    headers: { Authorization: "Bearer service-role", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sweep" }),
  });
}

const DUE: DueRow[] = [
  { message_id: PHOTO_MSG, storage_path: `${CONV}/${PHOTO_OBJ}.jpg`, reason: "unsent_retention" },
  { message_id: PHOTO_MSG, storage_path: `${CONV}/${PHOTO_OBJ}_thumb.jpg`, reason: "unsent_retention" },
  { message_id: ONCE_MSG, storage_path: `${CONV}/once/${ONCE_OBJ}.jpg`, reason: "unsent_retention" },
];

Deno.test("#4456: due unsent files go, then their private copies", async () => {
  const s = seen();
  const response = await createOpenViewOnceHandler(deps(DUE, s))(sweepRequest());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(s.removed.sort(), DUE.map((row) => row.storage_path).sort());
  assertEquals(s.evidence.length, 1);
  assertEquals(s.evidence[0].sort(), [PHOTO_MSG, ONCE_MSG].sort());
  assertEquals(s.order, ["remove", "evidence"]);
  assertEquals(s.purged, []);
  assertEquals(s.expired, []);
  assertEquals(body.evidence_purged, 3);
  assertEquals(body.by_reason.unsent_retention, 3);
});

Deno.test("#4456: with nothing due the copies with no files are still dropped", async () => {
  const s = seen();
  const response = await createOpenViewOnceHandler(deps([], s))(sweepRequest());
  assertEquals(response.status, 200);
  assertEquals(s.evidence, [[]]);
});

Deno.test("#4456: a failed delete keeps every copy", async () => {
  const s = seen();
  const response = await createOpenViewOnceHandler(deps(DUE, s, { failRemove: true }))(sweepRequest());
  assertEquals(response.status, 500);
  assertEquals(s.evidence, []);
});

Deno.test("#4456: a failed drop fails the sweep", async () => {
  const s = seen();
  const response = await createOpenViewOnceHandler(deps(DUE, s, { failEvidence: true }))(sweepRequest());
  assertEquals(response.status, 500);
  assertEquals((await response.json()).error, "sweep_evidence_failed");
});

Deno.test("#4456: a non-canonical path is never deleted", async () => {
  const s = seen();
  const due: DueRow[] = [
    { message_id: PHOTO_MSG, storage_path: `${CONV}/../other/${PHOTO_OBJ}.jpg`, reason: "unsent_retention" },
    { message_id: PHOTO_MSG, storage_path: `https://cdn.example/${PHOTO_OBJ}.jpg`, reason: "unsent_retention" },
  ];
  const response = await createOpenViewOnceHandler(deps(due, s))(sweepRequest());
  assertEquals(response.status, 200);
  assertEquals(s.removed, []);
  assertEquals(s.evidence, [[]]);
});
