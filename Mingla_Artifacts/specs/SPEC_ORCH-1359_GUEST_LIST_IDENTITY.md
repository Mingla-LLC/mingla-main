# SPEC — ORCH-1359 [guest-list-sheet-identity-display]

**Phase:** SPEC (mingla-forensics) · **Investigation:** `investigations/INVESTIGATION_ORCH-1358-1359_GUEST_LIST_POLISH.md` (F-2..F-5)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` on branch `ORCH-1359-guest-sheet-polish`
**Ships with:** ORCH-1358 as ONE OTA release. **OTA-safe:** pure-JS RN/TS + ONE additive backend migration (CREATE OR REPLACE the existing RPC). No native module change.

---

## 1. Executive summary

Polish the consumer "Who's going" guest-list sheet (`EventGuestListSheet.tsx`):
- **(b)** Show just the guest's name — drop the second `@username` line.
- **(c)** In its place show the guest's public location (city), pulled from their profile, gated to the same rows that already expose identity. NET-NEW: adds one whitelisted column (`profiles.location`) to the `peer_list_event_guests` RPC + the `PeerGuestRow` type.
- **(e)** Give unlinked (no-app) guests a short, concise "not on the app" caption instead of a bare "Guest".
- **(d)** Tap-name → open the guest's public profile. A reusable peer-profile surface exists (`ViewFriendProfileScreen`) but reuse conflicts with a SEALED design invariant → **GATED behind a Seth decision** (Section 10 / investigation "SETH DECISION NEEDED"). Items (b)/(c)/(e) are fully shippable WITHOUT (d).

## 2. Scope & non-goals

**In scope (SHIPPABLE now):** items (b), (c), (e) — the RPC location column, the `PeerGuestRow` type, and the sheet's row copy/a11y.
**In scope (GATED on Seth decision D-A/B/C):** item (d) tap-name → profile.
**Non-goals:** NO change to the momentum card (ORCH-1358); NO change to add-friend/message actions; NO change to which rows are named vs anonymous vs unlinked (privacy classification is server-final and untouched); NO web change (names never render on web — I-1340); NO client-side privacy filtering; NO new profile screen (a surface already exists).
**Assumptions:** `profiles.location` is a self-authored public "City, Region, Country" string (verified F-3); display shows the city (first comma-segment), mirroring `ViewFriendProfileScreen.tsx:638`.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---------|---------|-----------------------|---------------|--------|
| 1 | Consumer iOS | YES | Row shows name + city; unlinked shows "Not on Mingla"; (d) name tap opens profile [gated]. | RPC, types, `EventGuestListSheet.tsx` (+ item-d files) | shared type + consumer component |
| 2 | Consumer Android | YES | Same. | same | Automatic (same RN component) |
| 3 | Buyer/anon Web | **NO** | Guest names NEVER render on web (I-1340). The RPC is authed-only; web uses the anon `pg_public_social_proof` (counts + avatars, no names). | — | not covered — by design |
| 4 | Business iOS | NO | No consumer guest sheet. | — | not covered |
| 5 | Business Android | NO | Same. | — | not covered |
| 6 | Admin Web | NO | Not applicable. | — | not covered |
| 7 | Business Web preview | NO | No guest sheet in preview. | — | not covered |

**Backend note:** the `peer_list_event_guests` RPC is shared infrastructure but is consumed ONLY by the consumer sheet (`socialProofService.fetchPeerGuestList`). Widening its payload is additive and affects no other caller.

## 4. Layered specification

### 4.1 Database — `peer_list_event_guests` RPC (item c)

**Migration file:** `supabase/migrations/20261229000000_orch_1359_peer_guest_location.sql` (version AFTER the frontier `20261228000000`; safe-migration protocol; DO NOT auto-apply — orchestrator/Seth applies via Management API then verifies with one live call).

**Change:** `CREATE OR REPLACE` (DROP IF EXISTS + CREATE, mirroring `20261225000000`) the function `public.peer_list_event_guests(uuid, integer, integer)`. The ONLY change to the body is adding `location` to the NAMED-row projection in BOTH the RSVP branch and the ticketed branch, and to the output JSON. **Every guard, the grant, the REVOKE, the branch markers, and the comment are preserved.**

In each branch's `visible` CTE, alongside `named_avatar_url`, add (SAME `CASE` guard — named rows only):
```
CASE WHEN b.linked_user_id IS NOT NULL
      AND p.visibility_mode IN ('public', 'friends')
     THEN p.location END        AS named_location,
```
In each branch's `json_build_object(...)`, add `'location', n.named_location,` (place it after `'avatarUrl'`, before `'isMinglaUser'`).

**Whitelist update (comment + reality):** the column whitelist comment (`...sql:279-280` equivalent) becomes: `id, display_name, username, avatar_url, location, visibility_mode`. `location` is emitted ONLY on named rows; anonymous (private/blocked→excluded) and unlinked rows carry `location = NULL`. No other column is added. `is_blocked_by`, the auth/event/private/row-cap guards, the `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated`, and `NOTIFY pgrst` are unchanged.

**Privacy proof (I-1340 / I-1338):** because `named_location` reuses the exact identity `CASE` guard (`visibility_mode IN ('public','friends')` AND linked AND not-blocked), location surfaces on the SAME rows that already surface `display_name` — no new row is deanonymized. `profiles.location` is already world-readable to authed users and already shown on `ViewFriendProfileScreen`; this adds no exposure beyond the existing profile view. Rule #9: absent location → `NULL` → client shows nothing.

### 4.2 Types — `packages/offering-rendering/socialProofTypes.ts` (item c)

Add one field to `PeerGuestRow` (after `avatarUrl`):
```
/** Public city/location from profiles.location — NAMED rows only (null otherwise). */
location: string | null;
```
Update the row-mapping doc comment (lines 57-66) to note `location` is non-null only on named rows (same gate as the other identity fields). The payload key is camelCase-identical to the RPC (`location`) — no client mapping layer (per the frozen-contract rule). No other type changes; `socialProofService.ts` and `useEventGuestList.ts` need NO change (they pass the payload through).

### 4.3 Component — `EventGuestListSheet.tsx` (items b, c, e)

**4.3.1 Add a city helper** (module scope, near `initialsFor`):
```
const cityFor = (loc: string | null): string | null => {
  if (loc === null) return null;
  const city = loc.split(",")[0].trim();   // mirror ViewFriendProfileScreen:638
  return city.length > 0 ? city : null;
};
```

**4.3.2 Rewrite `line2`** (currently `EventGuestListSheet.tsx:453-461`) to:
```
const line2 = item.isYou
  ? "You"                                   // self unchanged
  : item.isNamed
    ? cityFor(guest.location)               // (b) drop @username → (c) city, or null if absent (rule 9)
    : guest.isMinglaUser
      ? "Keeping it low-key"                // anon-Mingla-private UNCHANGED
      : "Not on Mingla";                    // (e) unlinked no-app indicator
```
- **(b):** the `@${username}` / "On Mingla" branch is removed. `line1` (the name, line 452, `displayName ?? username ?? "Guest"`) is untouched — name source-of-truth and empty/anonymous fallbacks stay correct.
- **(c):** named rows show the city; when `guest.location` is null/empty, `line2` is `null` → the row renders name-only (no fabrication).
- **(e):** unlinked rows (`isMinglaUser===false`) now show "Not on Mingla" (was `null`). The anon-Mingla-private case keeps "Keeping it low-key" — the two cases stay visually distinct and no identity leaks.

**4.3.3 Update `a11yLabel`** (currently lines 485-493) to match:
```
const a11yLabel = item.isYou
  ? `${name}, you`
  : item.isNamed
    ? (cityFor(guest.location) !== null ? `${name}, ${cityFor(guest.location)}` : name)
    : guest.isMinglaUser
      ? "Someone, keeping it low-key"
      : "Guest, not on Mingla";
```

**4.3.4 Unchanged:** the initials-disk avatar fallback (`guest.displayName ?? guest.username ?? "Guest"`, line 433), the glyph disk for unlinked/anonymous (lines 440-445), the transient `rowHint` line (which still overrides `line2` when a hint is showing), row banding/sort, and all action buttons. The `rowSub` style is reused for the new `line2`.

### 4.4 Item (d) — tap-name → public profile (GATED — DO NOT IMPLEMENT until Seth ratifies)

**Blocked-on:** Seth choosing D-A / D-B / D-C AND ratifying the supersession of DRAFT invariant `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY`. The implementor MUST NOT build (d) until the orchestrator confirms. Full option analysis in the investigation ("SETH DECISION NEEDED"). Recommended = **D-B**. When ratified, the contract is:

- **Reuse** `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` (peer `userId` → full public profile incl. location; already handles strangers). Do NOT build a new profile screen.
- **Make the NAME tappable on NAMED, non-You rows only.** Wrap `line1` (or its `Text`) in a `Pressable` with `hitSlop`, `accessibilityRole="button"`, `accessibilityLabel={\`View ${name}'s profile\`}`, testID `orch-1359-guest-sheet-open-profile-${item.key}`. Anonymous/unlinked/You rows stay non-pressable (they carry no `profileId` — deanonymization guard). The row container itself stays non-pressable (only the name is the target).
- **Close-before-navigate** (extends `I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE`): `onClose()` fires BEFORE opening the profile (the RN-Modal sheet must unmount first or it z-covers the overlay).
- **D-B wiring (recommended):** add prop `onOpenProfile?: (userId: string) => void` to `EventGuestListSheetProps` (mirror the existing optional `onOpenConversation?` seam). Handler: `if (profileId !== null) { onClose(); onOpenProfile?.(profileId); }`. Each `Consumer{Event,Trip,Experience}DetailScreen` holds `const [profileUserId, setProfileUserId] = useState<string|null>(null)`, passes `onOpenProfile={setProfileUserId}`, and renders `{profileUserId ? <ViewFriendProfileScreen userId={profileUserId} onBack={() => setProfileUserId(null)} onMessage={...existing DM rail...} /> : null}` as an overlay sibling ABOVE the body but BELOW nothing (the sheet is closed by then).
- **D-A wiring (alternative):** add `registerOpenProfileSink`/`hasOpenProfileSink`/`openProfileInApp(userId)` to `deepLinkService.ts` byte-mirroring the DM sink (lines 378-413); register in `app/index.tsx` (`dismissAll()` → `setViewingFriendProfileId(userId)`); sheet default path `onClose(); openProfileInApp(profileId)`.
- **New invariant (propose DRAFT):** `I-PROPOSED-1359-GUEST-NAME-OPENS-PROFILE` — "the guest name (named non-You rows only) opens the peer `ViewFriendProfileScreen` via close-before-navigate; the row container stays non-pressable; anonymous/unlinked rows expose no profile affordance." This SUPERSEDES `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY` (orchestrator flips at CLOSE).

## 5. Success criteria

- **SC-1 (b):** A named guest row shows the name only — no `@username` line. iOS + Android.
- **SC-2 (c):** A named guest whose `profiles.location = "Austin, Texas, United States"` shows "Austin" on line 2. iOS + Android.
- **SC-3 (c, rule 9):** A named guest with `location = NULL` shows name only (line 2 absent) — no placeholder, no fabrication.
- **SC-4 (c, privacy):** An anonymous (private-visibility) row and an unlinked row both receive `location = NULL` from the RPC (server-verified) and render no location. A blocked guest is absent entirely (unchanged).
- **SC-5 (e):** An unlinked guest (`isMinglaUser=false`) shows line1 "Guest" + line2 "Not on Mingla"; an anon-Mingla-private guest (`isMinglaUser=true, isAnonymous=true`) still shows "Someone" + "Keeping it low-key" — the two remain distinct.
- **SC-6 (backend):** `peer_list_event_guests` returns the new `location` key on named rows and `null` elsewhere; all four guards + the `authenticated`-only grant + anon-revoke are intact (live-fire verify: one authed call returns location on a public/friends guest; the RPC still RAISEs `guest_list_private` when the host gate is on).
- **SC-7 (d) [gated]:** Tapping a named guest's name closes the sheet and opens `ViewFriendProfileScreen` for that userId; anonymous/unlinked/You names are not tappable. Only asserted if (d) is ratified this batch.

## 6. Invariants

- **Preserve** `I-PROPOSED-1338-GUARD-FIRST-PEER-READS` (ACTIVE) — guard order, whitelist discipline (now +`location`), `authenticated`-only grant, anon-revoke, table RLS untouched. Test: `orch_1338_social_proof_reads*.test.ts` + a new location assertion.
- **Preserve** `I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED` (ACTIVE) — location on named rows only; private/anon/unlinked → null; no fabrication; no client re-filter. Test: extend `orch_1340_guest_identity_privacy*.test.ts` / the antiScrape server suite.
- **Preserve** `I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE` (DRAFT) — item (d) [gated] extends it (close before profile-open).
- **Supersede (item d, gated)** `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY` (DRAFT) with the proposed `I-PROPOSED-1359-GUEST-NAME-OPENS-PROFILE` (DRAFT). Orchestrator flips at CLOSE only if (d) ships.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (b) | Named row copy | named guest w/ username | line2 is NOT `@username` | component |
| T-2 (c) | Location shown | named guest, location "London, England, UK" | line2 === "London" | component |
| T-3 (c) | No location | named guest, location null | line2 absent (name only) | component |
| T-4 (e) | Unlinked caption | `isMinglaUser:false` | line1 "Guest", line2 "Not on Mingla" | component |
| T-5 (e) | Distinct from anon-private | `isMinglaUser:true, isAnonymous:true` | line1 "Someone", line2 "Keeping it low-key" | component |
| T-6 (c/server) | RPC location on named | authed call, public-visibility linked guest | row.location === profiles.location | migration/deno |
| T-7 (c/server) | RPC null on private/unlinked | private + unlinked guests | row.location === null | migration/deno |
| T-8 (c/server) | Gate intact | host privateGuestList=on | RPC RAISEs `guest_list_private` (no rows) | migration/deno |
| T-9 (d) [gated] | Name tap | named non-You row | onClose then onOpenProfile(profileId) | component |
| T-10 (d) [gated] | Anon not tappable | anonymous/unlinked/You row | no profile affordance | component |

## 8. Implementation order

1. **DB:** write `20261229000000_orch_1359_peer_guest_location.sql` (CREATE OR REPLACE with `location` on named rows, both branches). Regen/adjust deno tests.
2. **Types:** add `location: string | null` to `PeerGuestRow`.
3. **Component (b/c/e):** add `cityFor`, rewrite `line2` + `a11yLabel` in `EventGuestListSheet.tsx`.
4. **Tests:** T-1..T-8.
5. **Item (d) [only if ratified]:** the D-B (or D-A) wiring + T-9/T-10 + the new DRAFT invariant.
6. Orchestrator applies the migration via Management API and verifies with one live call (SC-6).

## 9. Regression prevention (fails-on-revert)

- **Server:** a deno assertion that a named public/friends guest row carries `location` equal to the seeded `profiles.location`, AND that a private-visibility guest's row has `location === null`. MUST fail if `named_location` is dropped from the RPC or if the `CASE` guard is loosened to emit location on non-named rows. Protective comment: `// ORCH-1359 — location is identity-gated (named rows only); do not emit on anon/private/unlinked rows.`
- **Client:** a component assertion that (i) named rows never render `@username`, (ii) `location==="City, ..."` renders "City", (iii) unlinked rows render "Not on Mingla" while anon-Mingla rows render "Keeping it low-key". MUST fail on revert of the `line2` rewrite.

## 10. Open questions

- **OQ-1 (item d) — BLOCKER for (d) only:** Seth must (a) ratify superseding the SEALED DRAFT invariant `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY` (which explicitly excluded profile-open-from-the-sheet), and (b) pick the mechanism: **D-A** (shell sink, leaves the detail page), **D-B** (detail-local overlay, stays in context — RECOMMENDED), or **D-C** (defer (d), ship b/c/e now). Items (b)/(c)/(e) proceed regardless.
- **OQ-2 (non-blocking):** display the city (first comma-segment, per `ViewFriendProfileScreen`) vs the full "City, Region, Country" string. This spec uses **city** for row density; confirm at review if the full string is wanted (one-line change).

## 11. Downstream routing

Next = **mingla-implementor** (consumer + backend), same worktree, batched with ORCH-1358, for items (b)/(c)/(e) immediately; item (d) only after OQ-1 is answered. Then mingla-tester (device runtime + RPC live-fire per SC-6/SC-7 — headless is insufficient for the RPC). Then orchestrator CLOSE = ONE per-platform OTA (ios+android) + apply the `20261229000000` migration via Management API + verify + registry flips (I-1359 DRAFT→ACTIVE if (d) shipped; supersede I-1341-ACTIONS-ONLY).

## Allowlist (implementor may touch)

- `supabase/migrations/20261229000000_orch_1359_peer_guest_location.sql` (new)
- `supabase/migrations/__tests__/` — the `orch_1338`/`orch_1340` deno suites (extend for location) or a new `orch_1359_*` test
- `packages/offering-rendering/socialProofTypes.ts` (`PeerGuestRow.location` + comment)
- `app-mobile/src/components/EventGuestListSheet.tsx` (`cityFor`, `line2`, `a11yLabel`; item-d name Pressable ONLY if ratified)
- `packages/offering-rendering/__tests__/` + consumer test dir — new/extended tests
- **[item d, gated only]** `app-mobile/src/services/deepLinkService.ts` (D-A) OR `app-mobile/src/screens/{Event,Trip,Experience}/Consumer*DetailScreen.tsx` (D-B); `app-mobile/app/index.tsx` (D-A registration)

## DO-NOT-TOUCH

- The RPC's guards, guard ORDER, branch markers, `REVOKE`/`GRANT`, `is_blocked_by`, `NOTIFY pgrst`, table RLS — change ONLY the named-row `location` projection.
- The anon `pg_public_social_proof` RPC and `SocialProofSummary` (no names/location on the anon path — buyer-web).
- The add-friend / message actions, banding/sort, skeleton/empty/gated/error states, and the momentum card (ORCH-1358).
- Which rows are named/anonymous/unlinked (server-final classification).
- Any web surface (names never render on web).
- `Linking.openURL` for item (d) navigation — `mingla://` is not a registered scheme (COMMS-0093); use the in-app rail (D-A sink) or the local overlay (D-B).
