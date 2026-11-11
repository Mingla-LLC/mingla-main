// META-ORCH-1104 Phase 0 — support status transition logic (T-2.4 illegal transition).
//
// Run:
//   deno test --allow-read supabase/functions/support-set-status/statusLogic.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  isLegalTransition,
  isSupportStatus,
  resolvedAtForTransition,
  statusAfterCustomerMessage,
  waitingNeedsNextUpdate,
} from "./statusLogic.ts";

Deno.test("legal forward transitions per SPEC §2.1", () => {
  assert(isLegalTransition("new", "open"));
  assert(isLegalTransition("open", "pending"));
  assert(isLegalTransition("pending", "open"));
  assert(isLegalTransition("open", "resolved"));
  assert(isLegalTransition("resolved", "closed"));
  assert(isLegalTransition("closed", "open")); // reopen
  assert(isLegalTransition("open", "open")); // idempotent no-op
});

Deno.test("ADVERSARIAL: illegal transitions are rejected (T-2.4)", () => {
  // closed → resolved is not a legal step (must reopen to open first).
  assert(!isLegalTransition("closed", "resolved"));
  // closed → pending is illegal.
  assert(!isLegalTransition("closed", "pending"));
  // resolved → pending is illegal (reopen lands on open).
  assert(!isLegalTransition("resolved", "pending"));
});

Deno.test("resolved_at set on resolve/close, cleared on reopen", () => {
  assert(resolvedAtForTransition("resolved", null) !== null);
  assert(resolvedAtForTransition("closed", null) !== null);
  assertEquals(resolvedAtForTransition("open", "2026-01-01T00:00:00Z"), null);
  assertEquals(resolvedAtForTransition("pending", "2026-01-01T00:00:00Z"), null);
  // resolve keeps an existing resolved_at (idempotent).
  assertEquals(
    resolvedAtForTransition("resolved", "2026-01-01T00:00:00Z"),
    "2026-01-01T00:00:00Z",
  );
});

Deno.test("isSupportStatus type guard", () => {
  assert(isSupportStatus("new"));
  assert(isSupportStatus("closed"));
  assert(!isSupportStatus("archived"));
  assert(!isSupportStatus(42));
});

// #4382 — a customer reply reopens Waiting or Resolved; closed refuses.
Deno.test("#4382 customer reply: pending and resolved reopen, closed refuses", () => {
  assertEquals(statusAfterCustomerMessage("pending"), { ok: true, status: "open", reopened: true });
  assertEquals(statusAfterCustomerMessage("resolved"), { ok: true, status: "open", reopened: true });
  assertEquals(statusAfterCustomerMessage("open"), { ok: true, status: "open", reopened: false });
  assertEquals(statusAfterCustomerMessage("new"), { ok: true, status: "new", reopened: false });
  assertEquals(statusAfterCustomerMessage("closed"), { ok: false, error: "ticket_closed" });
});

// #4382 — Waiting needs a next-update time in the future.
Deno.test("#4382 Waiting needs a future next-update time", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  assert(waitingNeedsNextUpdate("pending", null, now));
  assert(waitingNeedsNextUpdate("pending", "2026-11-10T11:00:00Z", now));
  assert(!waitingNeedsNextUpdate("pending", "2026-11-11T12:00:00Z", now));
  assert(!waitingNeedsNextUpdate("resolved", null, now));
});
