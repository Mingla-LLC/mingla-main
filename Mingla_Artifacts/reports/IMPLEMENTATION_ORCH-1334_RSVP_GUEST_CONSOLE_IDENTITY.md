# IMPLEMENTATION — ORCH-1334 [rsvp-guest-console-identity-gap]

**Phase:** IMPLEMENT (single pass). No deploy, no merge, no PR, no migration apply.
**Worktree:** `~/Desktop/mingla-orchs/1334-[rsvp-guest-identity]/` on branch `1334-rsvp-guest-identity` (rebased on origin/main at start).
**Binding SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1334_RSVP_GUEST_CONSOLE_IDENTITY.md` (`24a1d3a74`).
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1334_RSVP_GUEST_CONSOLE_IDENTITY.md` (`9f4604fa9`).
**Comms:** read the ledger; no BLOCK addressed to me/ORCH-1334/ALL. Honored the two directly-relevant WARN rows — **COMMS-0040** (public-RSVP standardization: touched NONE of `RsvpPublicBody.tsx` / `preview.tsx` / `RsvpMomentumDecision.tsx` / `ConsumerEventDetailScreen.tsx` / `PublicEventPage.tsx` / `packages/offering-rendering/*` / `rsvpEvents.ts` / `public-submit-rsvp`) and **COMMS-0057/ORCH-1206** (no RSVP↔ticket merge: parity via shared FIELD SEMANTICS only; RPCs stay separate; write path untouched). No new discovery requiring a COMMS write.

---

## 1. Summary (plain English)

When someone RSVPs from inside the Mingla app, the host's guest list showed "Guest / App guest" even though we know exactly who they are. The write path deliberately stores a `guest_name='Guest'` sentinel and the identity is meant to be inherited from the person's profile — but the three READ queries never looked up the profile. This fix resolves each app member's real name, photo, and contact from `profiles` at READ time inside guard-protected functions, adds a source tag ("On Mingla" vs "RSVP'd on web"), makes each console row tappable, and adds a guest-detail sheet. The write path is untouched — the `'Guest'` literal simply never surfaces once reads resolve identity. Every existing RSVP row is fixed at once with zero backfill.

Validated the core read-logic on the LIVE production DB (read-only) against a real RSVP event: 3 app rows whose stored name is `'Guest'` resolved to real names ("Seth O", "rambleawaypod U", "sethogievabelgium Gotham") with username/email/phone and `source='app'`; the 1 web row echoed its typed name/email with `source='web'`; and the null-phone COALESCE returned NULL (never fabricated).

---

## 2. SPEC success-criteria coverage

Single commit for all code: **`<COMMIT_HASH>`** (this branch — see `git log -1`).

| SC | Criterion | How verified | Result |
|----|-----------|--------------|--------|
| SC-1 | Host RPC resolves app identity (display_name≠'Guest', source='app', email non-null, avatar/username when on file) | Live-DB read-logic probe (MCP) on event `8b84539d…` returned real names + email + `source='app'`; migration §4B; live-fire T-1 | ✓ (live-verified) |
| SC-2 | Host RPC honest null phone | Live probe: `COALESCE(NULLIF(btrim(NULL),''),NULLIF(btrim(NULL),''))` → NULL; migration phone expr; live-fire T-2 | ✓ (live-verified) |
| SC-3 | Host RPC web parity (typed values, source='web') | Live probe web row = typed name/email, `source='web'`; live-fire T-3 | ✓ (live-verified) |
| SC-4 | Host guard rejects rank < event_manager | Guard-first `RAISE EXCEPTION 'insufficient_event_permission'`; live-fire T-4 (tester-run post-apply) | ✓ (source + test written) |
| SC-5-iOS / SC-5-Android | Console row: avatar + real name + source badge; whole body tappable → sheet; iOS glass / Android opaque | `RsvpGuestConsole.tsx` redesign (`ROW_BG` Platform.select, `GuestAvatar`, `SourceBadge`, press-isolated `rowBody`) | ✓ (implemented, unverified on device) |
| SC-6 | Actions intact, no dead taps | `rowBody` `Pressable` is a SIBLING of the trailing action cluster; buttons keep own `onPress`; testIDs preserved | ✓ (implemented; tester runtime) |
| SC-7 | Detail sheet: identity + time + plus-ones + status + contact (email always, phone when present, omit null) | `RsvpGuestDetailSheet.tsx` §4E blocks | ✓ (implemented, unverified on device) |
| SC-8 | Admin attendee list: real name + source badge, resolved email, actions/counts unchanged | `OfferingDetailView.jsx` label/badge/email; migration §4C; strict-grep gates pass | ✓ (implemented) |
| SC-9 | Consumer twin self-identity (own real name, NO email/phone columns) | Migration §4D CREATE OR REPLACE, same column set, both branches resolve display_name; source-test asserts no `email`/`phone` in the fn body | ✓ |
| SC-10 | Write path untouched | No edit to `submit_event_rsvp` / `public-submit-rsvp` / `rsvpDeckService.ts` / `rsvpEvents.ts`; source-test asserts `submit_event_rsvp` absent from migration code | ✓ |
| SC-11 | Append-only maybe test stays green | `rsvpMaybeMigration.orch1150r2.test.ts` → **7/7 PASS** (immutable `20261012` file untouched) | ✓ (run) |

---

## 3. Files changed (7 — exactly the SPEC allowlist)

| File | Δ | Kind |
|------|---|------|
| `supabase/migrations/20261224000000_orch_1334_rsvp_guest_identity.sql` | +318 | NEW (3 RPC changes) |
| `supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.ts` | +145 | NEW (Deno source-contract, implementor happy-path) |
| `supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.sql` | +160 | NEW (live-fire T-1..T-4, tester-run post-apply) |
| `mingla-business/src/services/rsvpApprovals.ts` | +34 | type + row + mapper extension |
| `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx` | +359 / −80 | row redesign + press-isolation + sheet wiring |
| `mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx` | +394 | NEW detail sheet |
| `mingla-admin/src/pages/OfferingDetailView.jsx` | +22 / −? | label + source badge + resolved email |

Total: 1352 insertions, 80 deletions. Nothing outside the allowlist; no DO-NOT-TOUCH files.

---

## 4. Data-model changes applied

No table/column/index/RLS changes. Three RPC bodies re-defined (migration `20261224000000`):
- **`host_list_rsvp_guests(uuid)`** — DROP+CREATE. `LANGUAGE sql SECURITY INVOKER` → **`LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public`**. Guard-first (`biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank('event_manager')` else `RAISE EXCEPTION 'insufficient_event_permission'`). `LEFT JOIN public.profiles p ON p.id = r.user_id`. Existing 12 columns byte-identical + ORDER BY CASE (incl. `maybe` bucket) byte-identical; **+6** columns: `display_name, username, avatar_url, email, phone, source`. GRANT authenticated. Whitelisted columns only (no `SELECT p.*`).
- **`admin_list_event_rsvps(uuid,int,int)`** — CREATE OR REPLACE (jsonb, no DROP). `is_admin_user()` guard kept as first statement. `LEFT JOIN public.profiles` in the `ranked` CTE (aliased `profile_*`); same 6 keys appended per row. Counts/total/pagination/`plus_guests` unchanged. REVOKE anon/PUBLIC + GRANT authenticated re-asserted.
- **`fetch_user_going_rsvps(uuid)`** — CREATE OR REPLACE (RETURNS TABLE column set/order UNCHANGED, no DROP). Only the `display_name` EXPRESSION changes: `LEFT JOIN public.profiles` on BOTH branches (`pr.id=r.user_id` primary; `pg.id=g.matched_user_id` guest), resolved via COALESCE. **NO email/phone/contact columns added.** Self-scoping WHERE clauses byte-identical. GRANT authenticated, service_role.

`NOTIFY pgrst, 'reload schema';` at end.

**Migration monotonicity/drift:** slot `20261224000000` is strictly greater than the max committed (`20261223000000`), collision-free across sibling worktrees, and equal-frontier with the remote head (`SELECT max(version) FROM supabase_migrations.schema_migrations` = `20261223000000`) — no remote-only drift. Profiles columns (`display_name/username/avatar_url/email/phone`, all `text`) confirmed present live. No pre-flight `RAISE` guard against existing data (the only guard is an authorization guard) → no data-abort risk on apply.

---

## 5. Edge functions touched

**None.** No edge-function deploy required for this ORCH.

---

## 6. Regression tests added + fails-on-revert proof

- **Implementor happy-path (runnable):** `supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.ts` — Deno source-contract (matches the proven `orch_1203` pattern). **11/11 PASS** (`deno test --allow-read`). Asserts: host DEFINER + guard predicate + `RAISE 'insufficient_event_permission'`; `LEFT JOIN public.profiles`; the display_name/email/phone COALESCEs; the `source` CASE; the preserved `maybe` bucket; no `SELECT p.*`; admin guard + profiles join + source key; consumer both-branch resolution AND no `email`/`phone` in the consumer fn body AND retained self-scopes; write-path function absent; `NOTIFY`.
- **fails-on-revert (true LINE DELETION, not comment-out):** deleted the guard `RAISE EXCEPTION 'insufficient_event_permission';` line AND the host display_name COALESCE line → **2 assertions went RED** (`host RPC guards FIRST…`, `host RPC resolves identity…`), 9 passed. Restored → **11/11 PASS** again. **`fails-on-revert verified at <COMMIT_HASH>`** (this branch; `/tmp` backup used for the temporary deletion, restored byte-identical — `grep -c` confirms both fix lines present = 1 each).
- **Live-fire (tester-run post-apply):** `supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.sql` — self-contained `BEGIN;…ROLLBACK;` fixtures (brand+event+profiles+event_rsvps; no auth.users FK on this DB, verified) impersonating the host via `set_config('request.jwt.claim.sub', …)`: T-1 (app identity resolves), T-2 (null phone → NULL), T-3 (web parity), T-4 (non-host → `insufficient_event_permission`). NOT run by the implementor (no prod apply); the core read-logic of T-1/T-2/T-3 was independently validated as a pure SELECT against LIVE data (see §1).
- **SC-11 append-only:** `rsvpMaybeMigration.orch1150r2.test.ts` → **7/7 PASS** (immutable file untouched). Both new test files are additive (append-only gate satisfied); both appear in `git diff origin/main…HEAD --name-only`.

---

## 7. Old → New receipts

### migration `20261224000000_orch_1334_rsvp_guest_identity.sql` (NEW)
- **Before:** the three read RPCs returned raw `event_rsvps` columns; `host_list_rsvp_guests` was `SECURITY INVOKER` with no profiles join.
- **Now:** guard-first DEFINER host RPC + admin + consumer resolve identity/provenance from `profiles` at read time; +6 host/admin columns; consumer identity-only.
- **Why:** SC-1..SC-4, SC-8, SC-9, SC-10 — read-time fix, zero backfill, write path untouched.

### `rsvpApprovals.ts`
- **Before:** `RsvpGuest`/`RsvpGuestRow`/`rowToGuest` carried 12 fields.
- **Now:** +`displayName, username, avatarUrl, email, phone, source` (+`RsvpSourceValue` type). Mapper has defensive fallbacks so pre-migration cached rows never crash the mapper.
- **Why:** carry the resolved identity to the console + sheet. ~+34 lines.

### `RsvpGuestConsole.tsx`
- **Before:** each row was a plain `View` with name + `guestEmail ?? guestPhone ?? "App guest"`; not tappable.
- **Now:** shared `renderRow` helper — a press-isolated `Pressable` body (40px `GuestAvatar` + name + `SourceBadge` + contact meta) that opens the sheet, SIBLING to the trailing action/status cluster (Constitution #1). Actions, bulk-approve, confirm-remove, toast preserved; copy uses `displayName`. Inline `hashStringToHue`/`getInitials` (byte-for-byte per §4E-10). Android opaque `ROW_BG`/pressed fallback.
- **Why:** SC-5, SC-6. ~+359/−80.

### `RsvpGuestDetailSheet.tsx` (NEW)
- **Now:** shared `Sheet` (snapPoint 0.62; spring/timing/reduced-motion inherited). WHO / WHERE-FROM / STATUS / PLUS-ONES / CONTACT blocks; 64px avatar; state-gated actions (Pending→Approve/Deny, Going→Remove, else none); phone row OMITTED when null; email always for app.
- **Why:** SC-7. ~+394.

### `OfferingDetailView.jsx`
- **Before:** row label `guest_name || guest_email || rsvp_id`; `{!user_id && <Badge>guest</Badge>}`; email `{guest_email}`.
- **Now:** label prefers `display_name`; a source `Badge` ("On Mingla" `info` / "RSVP'd on web" `outline`) shown for every row; email prefers resolved `email || guest_email`; deny/remove dialog labels use the resolved `rowLabel` for consistency.
- **Why:** SC-8. ~+22.

---

## 8. Cross-surface impact

| Surface | Affected | User-visible | Parity |
|---------|----------|--------------|--------|
| Consumer iOS | Partial (twin) | own "Going" pass shows real name, no other-guest contact | Manual (RPC only, no client edit) |
| Consumer Android | Partial (twin) | same | Manual (same RPC) |
| Buyer/anon Web | No | — | host console is authed host-only |
| Business iOS | **Primary** | avatar + real name + source badge; tappable row → detail sheet; actions intact | Manual |
| Business Android | **Primary** | same + opaque-glass fallback | Manual (`Platform.select`) |
| Admin Web | Yes | real name + source badge + resolved email | Manual |
| Business Web preview | Yes | identical (shared RN component); DEFINER keys off JWT | Automatic (shared RN code) |

Business iOS/Android/web-preview parity is AUTOMATIC (one `RsvpGuestConsole`/`RsvpGuestDetailSheet` shared across all three). Admin + consumer twin are separate manual paths (each covered by the single migration + its own view/no-edit).

---

## 9. Smoke result

- **Live-DB read-logic (MCP, read-only prod):** the host RPC's exact SELECT run against real event `8b84539d…` resolved all 3 app rows from `'Guest'` → real names + email + `source='app'`, the web row → typed values + `source='web'`; null-phone COALESCE → NULL. This is the strongest available evidence for SC-1/2/3 without applying DDL to prod.
- **Deno source-contract:** 11/11 PASS; fails-on-revert proven by line deletion (2 RED) + restore (11 PASS).
- **Append-only maybe test:** 7/7 PASS (SC-11).
- **Gates:** `tsc` clean for all three touched TS files (repo-wide `tsc` has ~pre-existing unrelated errors — none in `components/rsvp/*` or `services/rsvpApprovals.ts`); `eslint` on the 3 TS files exit 0; admin JSX compiles via esbuild (no syntax error); strict-grep `i-offerings-read-only` PASS + `i-admin-gate-first-statement` PASS (both list `admin_list_event_rsvps` as compliant).
- **NOT run:** business-app simulator/device runtime (row press-isolation, sheet open/dismiss, contact omission, Android opaque fallback) — **unverified on device**; the live-fire `.test.sql` T-1..T-4 (no prod apply). Both are the tester's per §11.

---

## 10. Known issues / deferred

- **UI runtime unverified.** Row press-isolation (SC-6), sheet motion/blocks (SC-7), Android opaque fallback, and badge legibility need a business-sim / physical-device run (tester). No `[TRANSITIONAL]` code shipped.
- **Web badge AA fallback applied (intentional deviation — see §12).**
- **OQ-2 (consumer self-guard):** `fetch_user_going_rsvps` still does NOT enforce `p_user_id = auth.uid()` server-side — per SPEC, OUT of scope (deferred to a hardening ORCH; touching it risks `service_role`/CI callers).

---

## 11. Operator action required

1. **Apply the migration (orchestrator/operator — NOT the implementor), from a linked context:**
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1334-[rsvp-guest-identity]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (The worktree is not `supabase link`-ed; run from a linked checkout, or link first. Slot `20261224000000` > remote head `20261223000000`; standard `db push`, no `--include-all`.)
2. **After apply, run the live-fire tests (tester):**
   ```bash
   cat supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.sql | /Users/sethogieva/bin/supabase db remote sql --linked
   ```
   Expect `T-1..T-4 PASS` notices, no exception.
3. **Edge functions:** none to deploy.
4. **Invariants (orchestrator at CLOSE):** flip DRAFT→ACTIVE — `I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD`, `I-PROPOSED-1334-RSVP-GUEST-CONTACT-WHITELIST`, `I-PROPOSED-1334-RSVP-CONSUMER-SELF-IDENTITY-ONLY`.

---

## 12. Discoveries for Orchestrator

1. **Web source-badge contrast: SPEC token missed AA; applied the SPEC-authorized fallback.** SPEC §4E-4 lists `semantic.info` `#3b82f6` for the "RSVP'd on web" badge text with a conditional "lighten to `#7ab0ff` if AA fails on the tinted fill." Build-time computation: `#3b82f6` on `semantic.infoTint` over the dark canvas ≈ **4.28:1 (< AA 4.5:1)** → I used the authorized **`#7ab0ff`** variant (≈ 7.1:1). This is the SPEC's own conditional, not a free deviation. **The "On Mingla" badge** uses the SPEC's brand token `accent.warm` `#eb7825` on `accent.tint` as written; my build-time estimate for that pairing is ~**4.0–4.4:1** depending on the composited background — marginally under AA 4.5:1, though the badge word carries the meaning (not color-only) and a strong `accent.border` delimiter is present. Flagging for the designer/tester to adjudicate whether the "On Mingla" text should also lighten; I built the SPEC's explicit brand token rather than deviate unilaterally.
2. **Profiles are effectively world-readable** (standing privacy posture from the investigation — anon can read 'friends'-visibility). Not an ORCH-1334 defect; the DEFINER fix does not depend on it. Carried forward.
3. **RSVP console still lacks search / CSV export / check-in surfacing** (SPEC §2 non-goal #6) — candidate follow-up ORCHs.
4. **Migration `.test.ts` source-contract files under `supabase/migrations/__tests__/` are NOT auto-globbed by CI** — they run only when explicitly listed in a `DENO_TEST_FILES` array in `.github/workflows/supabase-migrations-and-stripe-deno.yml`. If the orchestrator wants `orch_1334_rsvp_guest_identity.test.ts` enforced in CI, register it there (the CI `migrations` job DOES apply the migration to an ephemeral Postgres, which validates apply). Not done here (out of the file allowlist).

---

## Verdict

**Implemented and (backend) live-verified; UI implemented, unverified on device.** All in-scope layers built per SPEC; happy-path regression green with fails-on-revert proof; all runnable gates green; changeset == allowlist. Ready for **REVIEW → tester** (business-sim + live-fire SQL).
