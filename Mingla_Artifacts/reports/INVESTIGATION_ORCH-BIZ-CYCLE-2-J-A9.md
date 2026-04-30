# Investigation — J-A9 (Brand Team — list / invite / role / remove)

> **Mode:** Forensics INVESTIGATE-THEN-SPEC (greenfield spec preparation)
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A9
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A8 + polish bundle CLOSE (commit `2d0ec549`); Sheet RN-Modal portal landed (I-13); ConfirmDialog NOT yet portal-wrapped (HF-1 carry-over)
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A9_BRAND_TEAM.md`
> **Auditor turn:** 2026-04-29
> **Confidence:** **High** — designer handoff §5.3.9–§5.3.11 read verbatim; §5.1.6 (accept-invitation) read for boundary; §6.2.4 (Marcus accepts) + §6.3.4–§6.3.6 (Sara invites/changes/removes) read for journey nuance; J-A7/J-A8 patterns + Sheet portal + ConfirmDialog primitives + Brand v6 schema confirmed

---

## 1. Symptom Summary

Greenfield spec preparation. No bug. The J-A7 BrandProfileView Operations section currently renders a "Team & permissions" row with `[TRANSITIONAL]` Toast `"Team UI lands in J-A9."` ([BrandProfileView.tsx:108](mingla-business/src/components/brand/BrandProfileView.tsx#L108)). J-A9 builds the team UI — a list screen, an invite sheet, and a member detail screen.

**Expected post-J-A9 state:**
- Tap "Team & permissions" row on J-A7 → navigates to `/brand/[id]/team`
- Team list renders one card per active member (avatar + name + role pill + last-active) + greyed pending-invitation rows below + "Invite teammate" FAB at bottom-right
- Tap FAB → Sheet opens with email + role select + optional note + Send invitation
- After Send → Sheet closes → Toast "Invitation sent to {email}." → new pending row appears in list
- Tap any member row → navigates to `/brand/[id]/team/[memberId]` member detail screen
- Member detail: profile-style with Change role / Remove member CTAs (owner-self disabled)
- Tap Change role → Sheet picker with 5 role options + descriptions
- Tap Remove → ConfirmDialog destructive → on confirm, member removed from list
- Pending row overflow → Resend / Cancel actions
- Mobile + web parity per DEC-071 (web parity gated to Cycle 6/7 — mobile-only this cycle)

**Current state:**
- `app/brand/[id]/team/` directory does not exist
- `Brand` type lacks `members?` and `pendingInvitations?` fields
- Stub `STUB_BRANDS` (brandList.ts) has no team data
- BrandProfileView's Operations row #2 still fires Toast (no navigation handler prop yet)

---

## 2. Investigation Manifest

| File | Layer | Read | Notes |
|---|---|---|---|
| Dispatch `FORENSICS_BIZ_CYCLE_2_J_A9_BRAND_TEAM.md` | Spec input | ✅ | 8 architectural decisions surfaced + 5 carryover invariants |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A7.md` | J-A7 forensics baseline | ✅ | Operations row pattern + Edit-CTA wiring pattern |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A8.md` | J-A8 forensics baseline | ✅ | Schema bump pattern · ConfirmDialog discard pattern · I-12 host-bg invariant origin |
| `SPEC_ORCH-BIZ-CYCLE-2-J-A8_BRAND_EDIT.md` | J-A8 spec | ✅ | Form-dirty JSON.stringify · simulated-async 300ms · InlineToggle composition |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A8_BRAND_EDIT.md` | J-A8 impl baseline | ✅ (session) | Confirms BrandEditView shipped without backend coupling |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A8_POLISH.md` | J-A8 polish baseline | ✅ (session) | URL semantics · 220-country picker via Sheet · Icon set DEC-082 |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A8_SHEET_PORTAL_FIX.md` | I-13 origin | ✅ (session) | Sheet wrapped in RN Modal — overlay-portal contract |
| `INVESTIGATION_BIZ_CYCLE_2_J_A8_COUNTRY_PICKER_BROKEN.md` | I-13 evidence | ✅ (session) | StyleSheet.absoluteFill resolves against nearest positioned ancestor — root cause for invisible Sheets |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.9–§5.3.11 | Authoritative source | ✅ (line 1864-1881) | Team list · Invite sheet · Member detail |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.1.6 | Boundary check | ✅ (line 1746-1755) | Accept-invitation deep-link — OUT of scope (B1 needs real tokens) |
| `HANDOFF_BUSINESS_DESIGNER.md` §6.2.2 | Personas / roles | ✅ (line 1629-1631) | Roles: account_owner · brand_admin · event_manager · finance_manager · marketing_manager · scanner |
| `HANDOFF_BUSINESS_DESIGNER.md` §6.2.4, §6.3.4–§6.3.6 | Journey narrative | ✅ (line 3014-3120) | Sara invites Marcus / changes role / removes member |
| `HANDOFF_BUSINESS_DESIGNER.md` §7 copy bank | UX copy | ✅ (line 2330-2333) | "Invitation sent" / "Already on team" / "Remove confirm" copy strings |
| `mingla-business/src/store/currentBrandStore.ts` | Schema | ✅ (session) | Brand v6 — no team fields |
| `mingla-business/src/store/brandList.ts` | Stub data | ✅ (session) | 4 brands, no member arrays |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Entry-point owner | ✅ (session) | Operations row #2 has `toastMessage: "Team UI lands in J-A9."` |
| `mingla-business/src/components/brand/BrandEditView.tsx` | Reusable patterns | ✅ (session) | InlineToggle · InlineTextArea · 300ms simulated save · Toast/ConfirmDialog wiring |
| `mingla-business/app/brand/[id]/index.tsx` | Route pattern | ✅ (session) | Format-agnostic ID resolver · canvas.discover host-bg |
| `mingla-business/app/brand/[id]/edit.tsx` | Route pattern | ✅ (session) | Same as above + setBrands save handler |
| `mingla-business/src/components/ui/Sheet.tsx` | Kit primitive | ✅ (session) | RN Modal portal · 4-layer visual stack · snap-points peek/half/full |
| `mingla-business/src/components/ui/ConfirmDialog.tsx` | Kit primitive | ✅ (session) | simple/typeToConfirm/holdToConfirm — wraps `./Modal` (NOT Sheet's RN Modal — see HF-1) |
| `mingla-business/src/components/ui/Input.tsx` | Kit primitive | ✅ (session, J-A8 reference) | text/email/phone/number/password/search variants · phoneCountryIso wired |
| `mingla-business/src/components/ui/Icon.tsx` | Kit primitive | ✅ (session, J-A8 polish reference) | DEC-082 — phone, instagram, tiktok, x, facebook, youtube, linkedin, threads added; users + chevR + chart + bank + receipt + edit + plus + arrowL exist |
| `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` | Roadmap | ✅ | §3.1 row line 84, §4 row line 237, §5 row Cycle 2 line 271 |
| `Mingla_Artifacts/DECISION_LOG.md` | DEC entries | ✅ | DEC-071/079/080/081/082 binding |

`npx tsc --noEmit` baseline clean (verified post-J-A8-polish commit `2d0ec549`).

---

## 3. Findings (classified)

### 🔴 Root Causes — None (greenfield)

### 🟠 Contributing Factors — None

### 🟡 Hidden Flaws (spec MUST address)

#### H-A9-1 — Brand schema v6 lacks `members` and `pendingInvitations` fields

- File: [`mingla-business/src/store/currentBrandStore.ts:98-121`](mingla-business/src/store/currentBrandStore.ts#L98-L121)
- Current Brand v6 fields cover: id, displayName, slug, photo, role, stats, currentLiveEvent, bio, tagline, contact (with phoneCountryIso), links (with 6 social platforms), displayAttendeeCount
- **Missing for J-A9:** `members?: BrandMember[]` + `pendingInvitations?: BrandInvitation[]`
- §5.3.9 requires per-member rendering of avatar + name + role pill + last-active timestamp + overflow ⋯
- §5.3.10 requires pending invitations greyed in same list with Resend/Cancel
- §5.3.11 requires member detail with avatar, name, role, joined, last active
- **Spec mitigation:** schema bump v6 → v7 with two new types:
  - `BrandMember = { id, name, email, role, status: 'active', joinedAt, lastActiveAt?, photo? }`
  - `BrandInvitation = { id, email, role, invitedAt, note?, status: 'pending' }`
  - Both arrays optional on Brand; default to `[]` at read sites; passthrough migration v6 → v7 (new fields start undefined). Same migration pattern as J-A7's v2→v3 and J-A8's v3→v4/v5/v6.

#### H-A9-2 — J-A7 BrandProfileView's Operations row #2 is closure-scoped to a Toast

- File: [`mingla-business/src/components/brand/BrandProfileView.tsx:97-112`](mingla-business/src/components/brand/BrandProfileView.tsx#L97-L112)
- Current `OPERATIONS_ROWS[1]` data: `{ icon: "users", label: "Team & permissions", sub: "1 member", toastMessage: "Team UI lands in J-A9." }`
- The Pressable handler at line 354 does `() => fireToast(row.toastMessage)` — no navigation
- **Spec mitigation:** add `onTeam: (brandId: string) => void` prop to `BrandProfileViewProps`. Replace the closure for the Team row only (other rows remain TRANSITIONAL Toast). Sub-text becomes dynamic: `${members.length} member${members.length === 1 ? '' : 's'}`.
- Pattern mirrors J-A8's `onEdit` callback addition. Documented in J-A7 invariant for J-A10/A11/A12 reuse.

#### H-A9-3 — ConfirmDialog NOT wrapped in RN Modal portal (HF-1 carry-over)

- File: [`mingla-business/src/components/ui/ConfirmDialog.tsx:122`](mingla-business/src/components/ui/ConfirmDialog.tsx#L122)
- ConfirmDialog wraps `./Modal` (custom kit Modal), NOT React Native's native `Modal`. The kit's `./Modal` is mounted inline in the React tree — it does NOT portal to OS root.
- For J-A8 the ConfirmDialog appeared correctly because it was used at the screen-root level (sibling of the BrandEditView ScrollView, not nested inside it). The discard dialog mounts directly under the View tree at line 545 of BrandEditView.tsx.
- **For J-A9 the same root-level mount applies** — `BrandTeamView` will render the remove-member ConfirmDialog at the View tree's root level, not nested in the FlatList. So ConfirmDialog visibility will work. **BUT** if the dialog is mounted inside the BrandMemberDetailView ScrollView (or any positioned-ancestor parent), the same bug class as Sheet pre-portal-fix will surface.
- **Spec mitigation:** code comment + structural note in spec — ConfirmDialog mounts MUST be at the screen-View tree root level, NOT nested inside ScrollView/FlatList/positioned ancestor. Document this until a separate dispatch wraps ConfirmDialog in RN Modal portal (tracked as HF-1 in J-A8 polish — separate ORCH).
- **Risk class:** Medium — this is structural-pattern discipline, not a new bug class. The fix is "mount the dialog at root" (one-line discipline) until the kit primitive is upgraded.

#### H-A9-4 — Sheet must be mounted at screen-root for invite + role-picker (I-13)

- Two new Sheets in J-A9: BrandInviteSheet + RolePickerSheet
- Both mount on Member-detail / Team-list screens
- §5.3.10 (invite) and the role-picker (member detail) BOTH require Sheet — established pattern
- **Spec mitigation:** Sheet primitive already wraps in RN Modal (post-J-A8 polish portal fix). Both new Sheets inherit the I-13 invariant. NO additional work — just mount Sheet at screen-View root.

#### H-A9-5 — Host-bg cascade (I-12) on 2 new routes

- Two new routes: `app/brand/[id]/team/index.tsx` + `app/brand/[id]/team/[memberId].tsx`
- Both live outside `(tabs)/` → DO NOT inherit canvas.discover from tabs layout
- **Spec mitigation:** both route files MUST set `backgroundColor: canvas.discover` on host View. Same pattern as J-A7 + J-A8 routes. Code comment references invariant I-12.

#### H-A9-6 — Format-agnostic ID resolver (I-11) on `[memberId]` segment

- The new dynamic segment `[memberId]` is a NEW resolver — must follow same I-11 pattern as `[id]`
- Member IDs in stub are short (`m_lm_sara`, `m_lm_marcus` etc.) but future user-created member IDs may be UUID
- **Spec mitigation:** member-detail route uses `useLocalSearchParams<{id: string | string[]; memberId: string | string[]}>()` then `brand.members?.find(m => m.id === memberIdParam) ?? null` — same format-agnostic find as the brand resolver.

#### H-A9-7 — No Avatar primitive in Cycle 0a kit (DEC-079 closed kit)

- Cycle 0a 24 primitives + TopSheet do NOT include an Avatar/Initial primitive
- BrandProfileView (J-A7) renders a custom 84×84 hero avatar with initial inline. BrandEditView (J-A8) duplicates that pattern.
- §5.3.9 requires per-member avatar (smaller — likely 40×40 per Designer Handoff §3.4 PersonRow component reference at line 1344)
- **Spec mitigation:** compose inline (like InlineToggle / InlineTextArea pattern). 40×40 circular Pressable with first-letter initial in `accent.warm` over `accent.tint` background. If 3+ uses appear, candidate for `Avatar` primitive carve-out (DEC-079 additive style).

#### H-A9-8 — Roles enum needs to be defined; current Brand.role only has `'owner' | 'admin'`

- Current `BrandRole` type at `currentBrandStore.ts:38`: `export type BrandRole = "owner" | "admin"`
- §6.2.2 lists 5 invitable roles: brand_admin · event_manager · finance_manager · marketing_manager · scanner
- §5.3.10 says "Role select (5 options)"
- Cycle 1's BrandRole type is currently used only for the OWNER's relationship to the brand (am I the owner of this brand?), so it's appropriate as-is for the current-user view
- **Spec mitigation:** introduce a separate `BrandMemberRole` type for team members:
  ```typescript
  export type BrandMemberRole =
    | "owner"
    | "brand_admin"
    | "event_manager"
    | "finance_manager"
    | "marketing_manager"
    | "scanner";
  ```
  - Keep `BrandRole` as-is (it covers the brand-list current-user perspective)
  - `BrandMember.role` uses `BrandMemberRole` (full set)
  - `BrandInvitation.role` uses `Exclude<BrandMemberRole, "owner">` (you can't invite an owner — only one per brand)
- Naming separation prevents conflation between "current user's role on this brand" (Brand.role) and "this team member's role on this brand" (BrandMember.role).

### 🔵 Observations

#### O-A9-1 — Permissions matrix (§3.12) NOT in J-A9 scope

- Designer Handoff §3.12 references a "Permission matrix" component (Section 3.12 grid where rows are roles and columns are capability groups; line 1447)
- §5.3.11 doesn't show the matrix — only "change role" CTA
- Roadmap §3.1 line 84 says J-A9 = "Brand team (list / invite / accept / role / remove)" — no matrix
- **Decision:** matrix UI deferred. J-A9 ships role assignment via picker only; the permissions consequences ("Will lose: brand finances. Will keep: event creation." per §6.3.5) are documented in the role-picker copy but no live matrix surface.

#### O-A9-2 — "Last active" timestamp is stub-only

- §5.3.9 row format includes "last-active timestamp"
- Cycle 2 has no real session-tracking; lastActiveAt is purely display copy
- **Decision:** stub `lastActiveAt` per member with realistic relative timestamps ("2h ago", "yesterday", "3d ago"). Render via simple relative-time formatter (inline, no kit extension). When B1 lands, real lastActiveAt fills the field; the formatter stays.

#### O-A9-3 — Pending row "Resend" is no-op stub

- §5.3.10 + §5.3.9 say pending rows have Resend / Cancel buttons
- Cycle 2 has no email pipeline (B5 marketing infrastructure)
- **Decision:** Resend fires Toast `[TRANSITIONAL]` "Invite resent to {email}." (purely UI feedback). Cancel removes the invitation from the list (real state change).

#### O-A9-4 — Owner cannot demote / remove self (per §5.3.11)

- §5.3.11 explicit: "owner (cannot change own role; cannot remove self)"
- For Cycle 2 stub: every brand has exactly one owner. The owner is "you" (the founder).
- **Decision:** Member detail screen for owner-self disables Change Role + Remove buttons. Both render with disabled visual + tooltip-style helper text ("Owners can't be removed. Transfer ownership first." — even though transfer-ownership is post-MVP).

#### O-A9-5 — Multi-brand owner (across SL + LM + TLL + HR)

- All 4 stub brands are owned by the founder per Cycle 1 stub
- Other personas (Marcus, Ada, Liam, Sara) appear in §6 narrative but are not the same persona as the signed-in user
- **Decision:** stub team data treats the founder as the owner of all 4 brands. Member rows on team list use NEW persona names per brand for visual realism. Founder always sees themselves as the OWNER row pinned at the top.

#### O-A9-6 — Email validation deferred (frontend-first)

- §5.3.10 invite sheet has email Input
- Real validation (regex + uniqueness check) deferred to B1 backend cycle
- **Decision:** Invite-form validation in Cycle 2 is "non-empty + contains @". Same loose validation pattern as J-A8 contact email. Backend validates rigorously at B1.

#### O-A9-7 — "Optional note" textarea reuses InlineTextArea pattern

- §5.3.10 invite sheet has Optional note textarea
- BrandEditView (J-A8) shipped `InlineTextArea` for bio (multi-line, 120px min height)
- **Decision:** Lift `InlineTextArea` to a shared utility (or duplicate inline — see decision in spec §3.5). For J-A9 cycle simplest path is to duplicate inline; if duplication exceeds 2 instances after this cycle, DEC-079 additive carve-out for shared `InlineTextArea` becomes warranted.

#### O-A9-8 — Member-detail "joined" timestamp is required by §5.3.11

- Already in BrandMember.joinedAt schema
- Stub: realistic dates (2-12 months ago for owner/admin, more recent for newer members)
- Display format: "Joined Mar 2026" or "Joined 2 months ago" — inline relative-or-absolute formatter

#### O-A9-9 — FAB position vs sticky shelf precedent

- §5.3.9 says "+ Invite teammate FAB bottom-right"
- BrandProfileView (J-A7) uses a sticky bottom shelf for Edit/View public — both full-width
- J-A9 team list uses a FAB (floating circular button bottom-right)
- **Decision:** absolute-positioned circular Pressable bottom-right with safe-area inset bottom + spacing.lg. Composed inline (no `FAB` primitive in kit). Avoids overlapping with floating BottomNav by checking the route is outside `(tabs)/`. (Floating BottomNav is rendered ONLY inside (tabs)/_layout.tsx per Cycle 0a — non-tab routes don't show it, so no collision.)

#### O-A9-10 — Web parity gated to Cycle 6/7

- DEC-071 frontend-first
- Mobile + web parity required at end of Cycle 17 per BUSINESS_PROJECT_PLAN.md
- For Cycle 2 (mobile-only): Sheet primitive works on web (RN Modal portals to top-level `<div>` in react-native-web)
- ConfirmDialog uses kit's `./Modal` — verified works on web (per Cycle 1 + Cycle 0a smoke)
- FAB absolute positioning works on web
- **Decision:** Cycle 2 ships mobile-only experience; web direct-URL navigation works (e.g., `/brand/lm/team/m_lm_sara`) but UI optimisation for desktop wide-table view is Cycle 6/7 work.

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (handoff §5.3.9–§5.3.11)** | Team list (glass cards + FAB) · Invite sheet (email + 5-role select + note + Send) · Member detail (avatar + role + change/remove) |
| **Docs (handoff §5.1.6 boundary)** | Accept-invitation deep-link OUT of scope (B1 needs real tokens) |
| **Docs (handoff §6.2.2 roles)** | 5 invitable roles: brand_admin · event_manager · finance_manager · marketing_manager · scanner |
| **Docs (handoff §6.3.4–§6.3.6)** | Sara invites Marcus → toast → pending row · Sara changes Marcus role → diff-style description · Sara removes Marcus → ConfirmDialog destructive |
| **Docs (handoff §7 copy bank)** | "Invitation sent to {email}." / "{Name} is already on the team." / "Remove {Name} from {Brand}? They'll lose access immediately." |
| **Docs (roadmap §3.1 line 84)** | J-A9 = list / invite / accept / role / remove · routes `/brand/:id/team` + invite sheet + accept deep-link |
| **Schema** | Brand v6 — no team fields; needs v7 with members + pendingInvitations |
| **Code** | J-A7 + J-A8 baselines shipped; Operations row #2 wired to Toast-only |
| **Runtime** | N/A (greenfield, frontend-first) |
| **Data** | AsyncStorage v6 → must migrate to v7 |

**Layer agreement:** §5.3.9–§5.3.11 + §5.1.6 (boundary) + §6.2.2 (roles) + §6.3.4–§6.3.6 (journey nuance) + §7 (copy bank) + roadmap all align. Accept-invitation deep-link is a CLEAN deferral (real tokens require backend) — no contradictions.

---

## 5. Blast Radius

J-A9 ships:

| Surface | Change |
|---|---|
| `app/brand/[id]/team/index.tsx` (NEW) | Team list route |
| `app/brand/[id]/team/[memberId].tsx` (NEW) | Member detail route |
| `src/components/brand/BrandTeamView.tsx` (NEW) | List + FAB + sheet trigger composition |
| `src/components/brand/BrandInviteSheet.tsx` (NEW) | Sheet form (email + role + note + Send) |
| `src/components/brand/BrandMemberDetailView.tsx` (NEW) | Profile-style member screen + ConfirmDialog + role-picker Sheet |
| `src/store/currentBrandStore.ts` (MOD) | Brand v6 → v7 + new types BrandMember, BrandInvitation, BrandMemberRole, InviteRole |
| `src/store/brandList.ts` (MOD) | All 4 STUB_BRANDS get team arrays + pending invitations |
| `src/components/brand/BrandProfileView.tsx` (MOD) | Add `onTeam` prop · Operations row #2 navigates · sub-text reflects member count |
| `app/brand/[id]/index.tsx` (MOD) | Pass `onTeam` handler |

**Total:** 9 files (5 new + 4 modified). Comparable to J-A8's 6 files (J-A8 had fewer new components).

**Other Cycle 2 surfaces (no changes):**
- BrandEditView — unchanged
- Account tab brand-rows section — unchanged
- TopBar / Sheet / ConfirmDialog / Input / Icon kit primitives — unchanged
- Home tab / events tab — unchanged

---

## 6. Invariant Check (preview — full list in spec)

| ID | Risk | Status |
|---|---|---|
| I-1 | designSystem.ts not modified | ✅ preserved |
| I-3 | iOS / Android / web execute | ✅ verified — Sheet RN-Modal portal works on all 3 |
| I-4 | No `app-mobile/` imports | ✅ preserved |
| I-6 | tsc strict — explicit return types on new components | ⚠ implementor to verify |
| I-7 | TRANSITIONAL markers labeled | ⚠ Resend Toast · 300ms simulated invite-send delay · Optimistic UI mutation · Email pipeline absence |
| I-9 | No animation timings touched | ✅ Sheet/ConfirmDialog reuse existing animations |
| I-11 | Format-agnostic ID resolver — same pattern in `[memberId]` | ⚠ implementor to verify |
| I-12 | Host-bg cascade — both new routes set `backgroundColor: canvas.discover` | ⚠ implementor to verify |
| I-13 | Overlay-portal contract — Sheet (invite + role-picker) inherits RN Modal portal | ✅ Sheet primitive already wraps |
| DEC-071 | Frontend-first | ✅ no backend code |
| DEC-079 | Kit closure preserved (Avatar + relative-time formatter composed inline) | ✅ no new primitive added |
| DEC-080 | TopSheet untouched | ✅ J-A9 uses Sheet, not TopSheet |
| DEC-081 | No `mingla-web/` references | ✅ |
| DEC-082 | Icon set additive — `users` already exists; no new icons needed | ✅ confirmed in [Icon.tsx](mingla-business/src/components/ui/Icon.tsx) |

**Carry-over hidden flaws (not blocking J-A9):**
- **HF-1 (J-A8 polish)** — ConfirmDialog NOT wrapped in RN Modal portal. J-A9 mitigates structurally (mount at screen-root only) — same discipline as J-A8 worked. Separate ORCH dispatch eventually upgrades the primitive.
- **HF-2 (J-A8 polish)** — kit `./Modal` primitive (used by ConfirmDialog) NOT wrapped in RN Modal portal. Same mitigation.

---

## 7. Fix Strategy (direction only — spec carries detail)

1. **Schema bump v6 → v7** — currentBrandStore.ts: add `BrandMember` + `BrandInvitation` types; add `BrandMemberRole` (6-tuple) + `InviteRole = Exclude<BrandMemberRole, 'owner'>`; add `members?: BrandMember[]` and `pendingInvitations?: BrandInvitation[]` to Brand type. Persist v6 → v7 passthrough migration.
2. **Stub data update** — brandList.ts: each brand gets team arrays. LM = 3 active + 1 pending; TLL = 2 active + 0 pending; SL = 2 active + 1 pending; HR = 1 active (owner only — empty-state demo) + 0 pending.
3. **Build BrandTeamView** — list with sectioned active members + greyed pending rows + FAB. Compose Avatar40 + RelativeTime inline.
4. **Build BrandInviteSheet** — wraps Sheet primitive at screen root. Email Input + RoleSelectField (Pressable that opens nested role-picker Sheet) + Optional note (InlineTextArea inline) + Send invitation Button. Validation: non-empty + contains "@" + not already a member + not already invited (inline error per §5.3.10).
5. **Build BrandMemberDetailView** — profile-style with Avatar84 + name + role pill + joined + last-active + Change role CTA (opens RolePickerSheet) + Remove member CTA (opens ConfirmDialog destructive). Owner-self disables both CTAs with helper text.
6. **Build RolePickerSheet** — reusable Sheet with one row per role + role-name + role-description. Tap a row → calls onPick(role). Used by BrandInviteSheet and BrandMemberDetailView.
7. **Create routes** — `app/brand/[id]/team/index.tsx` (host-bg + format-agnostic resolver + onSave handlers for invite/remove/role-change persistence) + `app/brand/[id]/team/[memberId].tsx` (host-bg + nested format-agnostic resolver).
8. **Wire J-A7 Operations row** — modify BrandProfileView.tsx: add `onTeam` prop; replace Toast with `onTeam(brand.id)` for the team row only; sub-text becomes dynamic. Modify `app/brand/[id]/index.tsx` to pass handler. Remove `[TRANSITIONAL]` marker on the team row's toastMessage entry.

---

## 8. Regression Prevention

- **Operations row navigation pattern** — J-A7 BrandProfileView grows a second navigation prop (`onTeam`) on top of `onEdit`. As J-A10/A11/A12 land they'll add `onPayments`, `onPaymentsOnboard`, `onReports` etc. Document the pattern in BrandProfileViewProps interface comment so future cycles follow it.
- **`[TRANSITIONAL]` marker churn** — every cycle that lands its journey REMOVES its TRANSITIONAL marker from BrandProfileView. Net marker count goes DOWN over time. Implementor verifies by grep: J-A9 removes 1 marker (`"Team UI lands in J-A9."`).
- **Member-detail format-agnostic resolver** — establishes the pattern for nested dynamic segments (`/brand/[id]/team/[memberId]`). Future surfaces with nested IDs (`/event/[id]/orders/[orderId]`) follow same pattern.
- **ConfirmDialog mount discipline** — until HF-1 lands the portal upgrade, every consumer mounts ConfirmDialog at screen-View root, NOT nested in ScrollView/FlatList. Code comment in BrandMemberDetailView calls this out explicitly.
- **Sheet mount discipline** — Sheet primitive already portals via I-13; mount-anywhere is safe. Document in BrandInviteSheet for future contributors.
- **Roles type discipline** — `BrandRole` (current-user perspective) ≠ `BrandMemberRole` (team-member perspective). Naming separation enforced. Spec calls this out.

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-INV-A9-1 | Permissions matrix (§3.12 component) deferred. Roadmap doesn't currently track when matrix UI lands — likely §5.3.6 settings cycle or B1 backend RLS work. | Info | Track in roadmap audit |
| D-INV-A9-2 | Accept-invitation deep-link (`/invitation/:token`, §5.1.6) gated to B1 (real tokens needed). Roadmap line 84 lists "accept" in J-A9 scope but it's a clean deferral — accept logic is server-side. | Info | Roadmap correction in next SYNC |
| D-INV-A9-3 | If 3+ Avatar uses appear (currently J-A7 hero + J-A8 hero + J-A9 team rows + J-A9 detail = 4), Avatar primitive carve-out (DEC-079 additive style) becomes warranted. Track usage count for next kit-closure decision. | Info | Watch-point |
| D-INV-A9-4 | If 3+ InlineTextArea uses appear (J-A8 bio + J-A9 invite note = 2 already; future J-A10 stripe-onboard support note? J-A12 reports description?), candidate for shared `TextArea` primitive. | Info | Watch-point |
| D-INV-A9-5 | Relative-time formatter ("2h ago", "yesterday") composed inline. If 3+ uses, candidate for `formatRelativeTime` utility in `src/utils/`. | Info | Watch-point |
| D-INV-A9-6 | FAB pattern (absolute bottom-right circular Pressable) composed inline. If 3+ FAB uses appear (J-A9 team + ?? + ??), candidate for `FAB` primitive. | Info | Watch-point |
| D-INV-A9-7 | Owner cannot transfer ownership (§5.3.11 implies "Transfer ownership first" but transfer-ownership UI is post-MVP). Stub helper text uses this language even though no transfer flow exists. | Info | Track for B1 transfer-ownership ORCH |
| D-INV-A9-8 | "Last active" timestamp on members is purely stub. Real session-tracking lands when B1 wires up auth.users.last_sign_in_at + cross-domain heartbeat. | Info | Track for B1 |
| D-INV-A9-9 | Email-already-on-team check is local-array `.find()` in Cycle 2. Real backend check (cross-brand uniqueness, RLS-respecting) lands at B1. | Info | Track for B1 |

---

## 10. Confidence

**HIGH.** Designer Handoff §5.3.9–§5.3.11 + §5.1.6 + §6.2.2 + §6.3.4–§6.3.6 + §7 copy bank read end-to-end; J-A7/J-A8 patterns + Sheet portal + ConfirmDialog primitives confirmed; Brand v6 schema gap quantified per-field; carve-outs from J-A6/J-A7/J-A8/J-A8 polish all cross-referenced; kit primitive APIs verified (Sheet snap-points, ConfirmDialog variants, Input variants, Icon set). Runtime verification deferred (greenfield, frontend-first).

---

## 11. Hand-off

Spec follows in `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A9_BRAND_TEAM.md`. Both files referenced in chat reply for orchestrator REVIEW.

---

**End of J-A9 investigation.**
