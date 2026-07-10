// ORCH-1338 [guest-read-backend] — T-13 happy-path structural regression test.
//
// Pins the per-entity SEPARATION contract (COMMS-0057 / ORCH-1206: the RSVP
// path NEVER merges into the ticket path) plus the guard-first ordering and
// the exact response shapes of the two ORCH-1338 read RPCs:
//   Function A — pg_public_social_proof(p_event_id)
//   Function B — peer_list_event_guests(p_event_id, p_limit, p_offset)
//
// The migration carries load-bearing branch markers
// ([ORCH-1338 FN-A RSVP-BRANCH-BEGIN] … END, etc.); this test partitions each
// function body on them AND verifies every guest-table token in the whole body
// falls inside its allowed span — so moving a read outside the markers fails.
//
// FAILS-ON-REVERT: deleting the migration file, merging the branches, moving a
// ticketed read into the RSVP branch (or vice versa), dropping a guard, or
// renaming a payload key makes this test FAIL.
//
// Run locally (repo root):
//   deno test --allow-read supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts
//
// Sibling adversarial suite (different angle — anti-scrape/leak):
//   orch_1338_social_proof_reads.antiScrape.adversarial.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql";

const migration = await Deno.readTextFile(MIGRATION_PATH);

/** Extract one function's full text (CREATE … $function$;). */
function fnBody(name: string): string {
  const re = new RegExp(
    `CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  );
  const m = migration.match(re);
  assert(m !== null, `function body found for ${name}`);
  return m[0];
}

/** Extract the [begin,end) span between two marker strings inside a body. */
function span(body: string, beginMarker: string, endMarker: string): {
  text: string;
  begin: number;
  end: number;
} {
  const begin = body.indexOf(beginMarker);
  const end = body.indexOf(endMarker);
  assert(begin >= 0, `marker present: ${beginMarker}`);
  assert(end > begin, `marker present + after begin: ${endMarker}`);
  return { text: body.slice(begin, end), begin, end };
}

/** All match indexes of a word-bounded token in a body. */
function tokenIndexes(body: string, token: string): number[] {
  const re = new RegExp(`\\b${token}\\b`, "g");
  const out: number[] = [];
  for (const m of body.matchAll(re)) out.push(m.index ?? -1);
  return out;
}

const fnA = fnBody("pg_public_social_proof");
const fnB = fnBody("peer_list_event_guests");

const A_RSVP = span(
  fnA,
  "[ORCH-1338 FN-A RSVP-BRANCH-BEGIN]",
  "[ORCH-1338 FN-A RSVP-BRANCH-END]",
);
const A_TICKETED = span(
  fnA,
  "[ORCH-1338 FN-A TICKETED-BRANCH-BEGIN]",
  "[ORCH-1338 FN-A TICKETED-BRANCH-END]",
);
const B_RSVP = span(
  fnB,
  "[ORCH-1338 FN-B RSVP-BRANCH-BEGIN]",
  "[ORCH-1338 FN-B RSVP-BRANCH-END]",
);
const B_TICKETED = span(
  fnB,
  "[ORCH-1338 FN-B TICKETED-BRANCH-BEGIN]",
  "[ORCH-1338 FN-B TICKETED-BRANCH-END]",
);

// --------------------------------------------------------------------------
// T-13 half 1 — the RSVP branches read event_rsvps ONLY.
// --------------------------------------------------------------------------

Deno.test("T-13a FN-A rsvp branch: SUM(1+plus_count) going+approved, no ticket-path tokens", () => {
  assert(
    A_RSVP.text.includes("FROM public.event_rsvps"),
    "rsvp count reads event_rsvps",
  );
  assert(
    A_RSVP.text.includes("SUM(1 + r.plus_count)"),
    "going formula is SUM(1 + plus_count) — byte-parity with pg_public_rsvp_by_slug",
  );
  assert(A_RSVP.text.includes("r.rsvp_status = 'going'"), "going filter");
  assert(
    A_RSVP.text.includes("r.approval_status = 'approved'"),
    "approved filter",
  );
  assertEquals(tokenIndexes(A_RSVP.text, "tickets").length, 0);
  assertEquals(tokenIndexes(A_RSVP.text, "ticket_types").length, 0);
  assertEquals(tokenIndexes(A_RSVP.text, "orders").length, 0);
});

Deno.test("T-13b FN-B rsvp branch: party_size = 1 + plus_count, no ticket-path tokens", () => {
  assert(B_RSVP.text.includes("FROM public.event_rsvps"));
  assert(
    B_RSVP.text.includes("(1 + r.plus_count) AS party_size"),
    "rsvp partySize honesty (T-16 static half)",
  );
  assertEquals(tokenIndexes(B_RSVP.text, "tickets").length, 0);
  assertEquals(tokenIndexes(B_RSVP.text, "ticket_types").length, 0);
  assertEquals(tokenIndexes(B_RSVP.text, "orders").length, 0);
});

// --------------------------------------------------------------------------
// T-13 half 2 — the ticketed branches never read event_rsvps.
// --------------------------------------------------------------------------

Deno.test("T-13c FN-A ticketed branch: absolute live-ticket count (F-3 fix), capacity NULL on any unlimited tier, no event_rsvps", () => {
  assert(
    A_TICKETED.text.includes("FROM public.tickets"),
    "going = tickets count (absolute, ORCH-0946 formula)",
  );
  assert(
    A_TICKETED.text.includes("t.status IN ('valid', 'used', 'transferred')"),
    "sold formula matches biz_ticket_checkout_create_session",
  );
  assert(
    A_TICKETED.text.includes(
      "(COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL)",
    ),
    "any unlimited/uncapped tier ⇒ capacity NULL",
  );
  assert(
    A_TICKETED.text.includes("SUM(tt.quantity_total)"),
    "finite capacity = Σ quantity_total",
  );
  assert(
    A_TICKETED.text.includes("tt.deleted_at IS NULL"),
    "deleted tiers excluded",
  );
  assertEquals(tokenIndexes(A_TICKETED.text, "event_rsvps").length, 0);
});

Deno.test("T-13d FN-B ticketed branch: one row per live-ticketed order, partySize = live-ticket count, no event_rsvps", () => {
  assert(B_TICKETED.text.includes("FROM public.orders"));
  assert(
    B_TICKETED.text.includes("COUNT(t.id)::integer AS party_size"),
    "ticketed partySize = order's live-ticket count (T-16 static half)",
  );
  assert(
    B_TICKETED.text.includes("t.status IN ('valid', 'used', 'transferred')"),
    "live-ticket predicate",
  );
  assertEquals(tokenIndexes(B_TICKETED.text, "event_rsvps").length, 0);
});

// --------------------------------------------------------------------------
// T-13e/f — NO guest-table token escapes its allowed span (markers cannot be
// gamed by moving code outside them).
// --------------------------------------------------------------------------

Deno.test("T-13e FN-A: every guest-table token lives inside its branch span", () => {
  for (const idx of tokenIndexes(fnA, "event_rsvps")) {
    assert(
      idx >= A_RSVP.begin && idx < A_RSVP.end,
      `event_rsvps@${idx} inside FN-A RSVP span`,
    );
  }
  for (const token of ["tickets", "ticket_types", "orders"]) {
    for (const idx of tokenIndexes(fnA, token)) {
      assert(
        idx >= A_TICKETED.begin && idx < A_TICKETED.end,
        `${token}@${idx} inside FN-A TICKETED span`,
      );
    }
  }
});

Deno.test("T-13f FN-B: every guest-table token lives inside its branch span", () => {
  for (const idx of tokenIndexes(fnB, "event_rsvps")) {
    assert(
      idx >= B_RSVP.begin && idx < B_RSVP.end,
      `event_rsvps@${idx} inside FN-B RSVP span`,
    );
  }
  for (const token of ["tickets", "ticket_types", "orders"]) {
    for (const idx of tokenIndexes(fnB, token)) {
      assert(
        idx >= B_TICKETED.begin && idx < B_TICKETED.end,
        `${token}@${idx} inside FN-B TICKETED span`,
      );
    }
  }
});

// --------------------------------------------------------------------------
// Guard-first ordering (SPEC §4.1.1 / §4.1.2) — guards precede data reads.
// --------------------------------------------------------------------------

Deno.test("guards-A: event resolve + gate extraction precede any guest read in FN-A", () => {
  const idxResolve = fnA.indexOf("e.visibility = 'public'");
  const idxGate = fnA.indexOf("privateGuestList");
  const idxFirstRead = Math.min(
    ...["FROM public.event_rsvps", "FROM public.tickets"]
      .map((t) => fnA.indexOf(t))
      .filter((i) => i >= 0),
  );
  assert(idxResolve >= 0 && idxGate >= 0 && idxFirstRead >= 0);
  assert(idxResolve < idxFirstRead, "public/deleted/status resolve first");
  assert(idxGate < idxFirstRead, "host gates read before any count/sample");
});

Deno.test("guards-A: FN-A page-parity status set (scheduled/live/ended/cancelled) + NULL contract", () => {
  assert(
    fnA.includes(
      "ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]",
    ),
    "status set byte-parity with pg_public_rsvp_by_slug (SC-8 page parity)",
  );
  assert(/IF NOT FOUND THEN\s*\n\s*RETURN NULL;/.test(fnA), "not-found → json null");
});

Deno.test("guards-B: FN-B guard order auth → event(scheduled|live) → private → clamp → reads", () => {
  const idxAuth = fnB.indexOf("'authentication_required'");
  const idxEvent = fnB.indexOf("'event_not_available'");
  const idxPrivate = fnB.indexOf("'guest_list_private'");
  const idxClamp = fnB.indexOf("LEAST(GREATEST(");
  const idxFirstRead = Math.min(
    ...["FROM public.event_rsvps", "FROM public.orders"]
      .map((t) => fnB.indexOf(t))
      .filter((i) => i >= 0),
  );
  assert(idxAuth >= 0 && idxEvent >= 0 && idxPrivate >= 0 && idxClamp >= 0);
  assert(idxAuth < idxEvent, "auth gate first");
  assert(idxEvent < idxPrivate, "event availability before privacy");
  assert(idxPrivate < idxClamp, "privacy before clamp");
  assert(idxClamp < idxFirstRead, "ALL guards before any guest-row read");
  assert(
    fnB.includes("ARRAY['scheduled'::text, 'live'::text]"),
    "FN-B restricted to scheduled/live (never ended/cancelled)",
  );
});

// --------------------------------------------------------------------------
// Response shapes (frozen API — socialProofTypes.ts mirrors these keys).
// --------------------------------------------------------------------------

Deno.test("shape-A: SocialProofSummary keys, camelCase, sample [] default", () => {
  for (
    const key of [
      "'eventId'",
      "'entityType'",
      "'goingCount'",
      "'capacity'",
      "'privateGuestList'",
      "'hideRemainingCount'",
      "'sample'",
    ]
  ) {
    assert(fnA.includes(key), `FN-A payload key ${key}`);
  }
  assert(
    /v_sample\s+json\s+:=\s+'\[\]'::json/.test(fnA),
    "sample defaults to []",
  );
});

Deno.test("shape-B: PeerGuestListPage + PeerGuestRow keys, pagination contract", () => {
  for (
    const key of [
      "'eventId'",
      "'entityType'",
      "'returned'",
      "'hasMore'",
      "'guests'",
      "'profileId'",
      "'displayName'",
      "'username'",
      "'avatarUrl'",
      "'isMinglaUser'",
      "'isAnonymous'",
      "'partySize'",
    ]
  ) {
    assert(fnB.includes(key), `FN-B payload key ${key}`);
  }
  // Fetch limit+1, return ≤ limit, hasMore exact (SC-7).
  assertEquals(
    (fnB.match(/LIMIT v_limit \+ 1 OFFSET v_offset/g) ?? []).length,
    2,
    "both branches fetch limit+1 with offset",
  );
  assert(fnB.includes("'hasMore', v_fetched > v_limit"), "hasMore = fetched > limit");
  assert(
    fnB.includes("'returned', LEAST(v_fetched, v_limit)"),
    "returned never exceeds the cap",
  );
  // Deterministic ordering: named rows first, then created_at/row-id tiebreak.
  assertEquals(
    (fnB.match(/is_named DESC, [cv]\.created_at ASC, [cv]\.row_id ASC/g) ?? [])
      .length,
    4,
    "stable ORDER BY (identity_present DESC, created_at, id) in both branches (query + window)",
  );
});

Deno.test("posture: both functions SECURITY DEFINER + STABLE + pinned search_path", () => {
  for (const body of [fnA, fnB]) {
    assert(body.includes("SECURITY DEFINER"));
    assert(body.includes("STABLE"));
    assert(body.includes("SET search_path = public"));
  }
});
