# INVESTIGATION — BIZ Cycle 17b (Refinement Pass mini-cycle 2 — TopBar IA reset)

**Cycle:** 17b (BIZ — second mini-cycle of Phase 5 Refinement Pass)
**Mode:** INVESTIGATE — consumer mapping + extraRightSlot API design + decomposition recommendation
**Generated:** 2026-05-05
**Confidence:** High overall — direct code reads on all 19 TopBar consumers + TopBar.tsx primitive

---

## 1. Layman summary

**Major finding that reshapes 17b scope:** I-37 was originally proposed as "TopBar default `[search, bell]` cluster always visible across ALL TopBar consumers." Forensics maps **19 TopBar instances across 12 files** and finds that **most back-route consumers intentionally suppress the default cluster** with `rightSlot={<View />}` or `rightSlot={null}` — that's deliberate, documented UX (back-route sub-pages stay focused on the task at hand; search/bell would be noise on Edit Brand or Audit Log).

**The honest scope of 17b is much narrower than first sketched:** I-37 should cover **`leftKind="brand"` consumers only** (3 production routes: home, events, account, plus 1 dev styleguide fixture). All `leftKind="back"` consumers are correctly out of I-37 scope and stay as-is.

**Net delta is small:** events.tsx is the ONLY primary tab using a custom inline cluster today. Adding `extraRightSlot` prop + migrating events.tsx + ratifying I-37 + adding CI grep gate = **~3-4 hrs structural work, not 6-8.** Dispatch's "structural-only" estimate was conservative.

**Search + bell wiring decision:** ~85% of the icon clicks today go nowhere; the existing TopBar default has had this TRANSITIONAL marker since Cycle 0a. Wiring them in 17b is **possible but ratchet-risky** — once shipped, ripping out is harder than not shipping. Forensics recommends **structural-only 17b** + carve out wiring as 17b-W if/when operator validates pain.

**Operator's founder-feedback sub-item 2 ("constant on top bar at all times") is satisfied by structural-only 17b** — search and bell are visually constant after 17b on every primary tab; whether they DO anything is a separate question. The icon-pair already shows on home + account today; events.tsx joins them post-17a tactical patch. 17b makes events.tsx switch from the tactical inline cluster to the proper `extraRightSlot` API and adds the CI rule preventing future regressions.

---

## 2. TopBar consumer table (19 instances across 12 files)

### 2a. `leftKind="brand"` consumers — I-37 scope (4 instances, 4 files)

| # | File:line | rightSlot pattern | Bucket | Behavior today | I-37 status |
|---|---|---|---|---|---|
| 1 | `app/(tabs)/home.tsx:152` | none (default) | A | `[search, bell]` defaults render | ✅ Already compliant |
| 2 | `app/(tabs)/account.tsx:155` | none (default) | A | `[search, bell]` defaults render | ✅ Already compliant |
| 3 | `app/(tabs)/events.tsx:391-417` | inline View cluster (17a tactical) | C | `[search, bell, +]` rendered inline | ⚠️ **Migrate to `extraRightSlot`** |
| 4 | `app/__styleguide.tsx:667` | none (default) | A | `[search, bell]` defaults render | ✅ Dev-only; compliant |

**Net I-37 migration scope:** 1 file (`events.tsx`).

### 2b. `leftKind="back"` consumers — out of I-37 scope (15 instances, 8 files)

| # | File:line | rightSlot pattern | Why intentional |
|---|---|---|---|
| 5 | `app/__styleguide.tsx:672` | none (default) | Dev-only fixture |
| 6 | `app/event/[id]/index.tsx:394` (loading branch) | none (default) | Loading skeleton — falls back to default; rare runtime |
| 7 | `app/event/[id]/index.tsx:625` (ready branch) | inline View [share + moreH] | Page-specific actions: Share + Manage |
| 8 | `app/brand/[id]/team.tsx:207-210` (loading branch) | `null` | Explicit suppression — loading state has no actions |
| 9 | `app/brand/[id]/team.tsx:230-244` (ready branch) | conditional `<Pressable>` Plus icon (invite gate) | Page-specific: invite team member; rank-gated |
| 10 | `app/brand/[id]/audit-log.tsx:105-108` | `null` | Explicit suppression — read-only viewer, no actions |
| 11 | `src/components/brand/BrandProfileView.tsx:350` (loading) | `<View />` | Empty placeholder for layout balance |
| 12 | `src/components/brand/BrandProfileView.tsx:381-384` (ready) | `<View />` | Empty placeholder — Brand Profile uses sticky shelf for actions, not top-bar |
| 13 | `src/components/brand/BrandPaymentsView.tsx:195-198` (loading) | `<View />` | Empty placeholder |
| 14 | `src/components/brand/BrandPaymentsView.tsx:239-242` (ready) | `<View />` | Empty placeholder |
| 15 | `src/components/brand/BrandFinanceReportsView.tsx:258-261` (loading) | `<View />` | Empty placeholder |
| 16 | `src/components/brand/BrandFinanceReportsView.tsx:302-318` (ready) | inline View [download icon decorative] | Decorative-only icon per W-A12-2 (Const #1 — `<View />` not Pressable so no dead tap) |
| 17 | `src/components/brand/BrandEditView.tsx:293` (loading) | `<View />` | Empty placeholder |
| 18 | `src/components/brand/BrandEditView.tsx:339` (ready) | `saveButton` JSX | Page-specific: Save action |
| 19 | `app/checkout/[eventId]/*` | (NOT FOUND in grep) | Checkout has its own CheckoutHeader, doesn't use TopBar |

**Net back-route status:** all 15 instances intentionally diverge from the default cluster. They are NOT I-37 violations.

### 2c. Bucket distribution summary

- **Bucket a** (no rightSlot, uses default): 4 instances (home, account, styleguide-brand, styleguide-back-loading)
- **Bucket b** (single-icon replace): 1 instance (BrandEditView saveButton)
- **Bucket c** (multi-icon View replace): 4 instances (events.tsx 17a tactical + event/[id] ready + team.tsx ready + BrandFinanceReports ready)
- **Bucket d** (`null` or `<View />` explicit suppress): 10 instances

---

## 3. `extraRightSlot` API design

### 3a. Recommended `TopBarProps` addition

```ts
export interface TopBarProps {
  leftKind: TopBarLeftKind;
  title?: string;
  onBack?: () => void;
  /**
   * Right slot content. If defined, REPLACES the default `[search, bell]` cluster.
   * Use this when the entire right slot needs custom content (e.g., back-route
   * sub-pages with page-specific actions like Save / Share / Manage / Invite, or
   * intentional suppression via `null` or `<View />` placeholder).
   *
   * Per I-37: `leftKind="brand"` consumers MUST NOT pass `rightSlot` —
   * use `extraRightSlot` to ADD icons after the default cluster instead.
   */
  rightSlot?: React.ReactNode;
  /**
   * Optional icons composed AFTER the default `[search, bell]` cluster.
   * Renders inside the same flex row, gap=spacing.sm, in source order.
   * Use this for primary-tab page-specific extras (e.g., events tab `+`).
   *
   * Per I-37: ONLY honored when `rightSlot` is undefined (rightSlot wins
   * if both passed — but I-37 forbids that combination on `leftKind="brand"`).
   */
  extraRightSlot?: React.ReactNode;
  unreadCount?: number;
  onBrandTap?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}
```

### 3b. Render logic change

Replace existing `TopBar.tsx:184` from:
```tsx
{rightSlot ?? <DefaultRightSlot unreadCount={unreadCount} />}
```

With:
```tsx
{rightSlot !== undefined ? rightSlot : (
  <View style={styles.rightCluster}>
    <DefaultRightSlotInner unreadCount={unreadCount} />
    {extraRightSlot}
  </View>
)}
```

Where `DefaultRightSlotInner` is the search + bell IconChrome pair WITHOUT the wrapping `<View>` (so the parent flex row composes everything in one container).

### 3c. Alternative considered + rejected

**Option A — deprecate `rightSlot` entirely:** rejected. Back-routes legitimately need replacement (Edit Brand → Save button is the right slot; bell + search would be noise during the focused edit task). Forcing every back-route consumer to migrate to `extraRightSlot` would either (a) make the back-route show the default cluster they don't want, or (b) require a new "suppressDefault" prop, doubling complexity.

**Option B — keep `rightSlot` as escape-hatch (RECOMMENDED):** preserves all 15 back-route consumers as-is, requires zero migration effort there. CI gate enforces I-37 only on `leftKind="brand"` consumers.

### 3d. Type-safety concern

If a consumer passes BOTH `rightSlot` and `extraRightSlot`, render logic prefers `rightSlot`. CI gate flags this combination on `leftKind="brand"` as a violation. For TypeScript-level prevention, consider discriminated-union typing:

```ts
type TopBarRightSlotProps =
  | { rightSlot?: React.ReactNode; extraRightSlot?: never }
  | { rightSlot?: never; extraRightSlot?: React.ReactNode };
```

Tradeoff: cleaner type-level enforcement vs more verbose interface. **Recommendation: defer to SPEC time** — implementor's call based on whether the discriminated union breaks anything in existing callers.

---

## 4. Search + bell wiring analysis (W1-W8 matrix)

### 4a. Search icon wiring options

| Option | Description | Effort | Dependencies | Ratchet risk |
|---|---|---|---|---|
| **W1** | Stay decorative TRANSITIONAL (current) | 0 hrs | None | None — preserves status quo |
| **W2** | Open new search screen `app/search.tsx` | ~6-8 hrs | None backend; reads existing Zustand stores (drafts + live events + brand list) | Medium — new route + design tokens + accessibility |
| **W3** | Inline search-filter on current tab (events tab → filter list by query) | ~4-5 hrs | None | Low — but only useful on events tab; what does search do on home/account? |
| **W4** | Toast "Coming soon" on tap | 0.5 hrs | None | **REJECTED** — Const #1 dead-tap + Const #9 fabrication-adjacent |

### 4b. Bell icon wiring options

| Option | Description | Effort | Dependencies | Ratchet risk |
|---|---|---|---|---|
| **W5** | Stay decorative TRANSITIONAL (current) | 0 hrs | None | None — preserves status quo |
| **W6** | Open new notifications screen `app/notifications.tsx` reading existing data | ~8-10 hrs | None backend; reads `eventEditLogStore` + `brandTeamStore.pendingInvitations` + `scannerInvitationsStore.pending` | High — defines what "notification" means for organisers; sets B-cycle direction prematurely |
| **W7** | Bell badge from existing data only (no click action) | ~2 hrs | None backend; computes count from same 3 stores | Low — additive; click stays decorative until W6 ships |
| **W8** | Pure status quo (decorative + no badge) | 0 hrs | None | None |

### 4c. Available local data sources (no B-cycle dependency)

Verified by grep + read of stores:

- **`eventEditLogStore`** — every event-edit action recorded with timestamp + actor; could surface "Tunde edited Slow Burn vol. 4" entries (already used by Cycle 9c activity feed)
- **`brandTeamStore`** — pending team invitations the operator received (vs sent — distinguish needed)
- **`scannerInvitationsStore`** — pending scanner invitations the operator received
- **`useDraftsForBrand`** — drafts the operator has in progress (could surface "Don't forget your draft" reminder, but borderline)

**Real notification feed (push from backend events) requires B-cycle** — OneSignal SDK + edge functions writing to a notification table. That's not 17b territory.

### 4d. Decomposition recommendation (Forensics opinion)

**RECOMMENDED: 17b structural-only (W1 + W5).** Rationale:

1. The founder feedback was "constant on the top bar at all times" — that's a **layout** ask (visual presence), not a **functional** ask (clickable). Structural-only delivers visual presence on every primary tab.
2. Wiring search/bell in 17b before operators have used the new top-bar shape risks shipping the wrong UX — better to ship structural, watch operator behavior, then wire based on observed need (could shift the W-decision toward W3 inline-filter on events tab if operators ask for it most).
3. Effort delta is significant: structural-only ~3-4 hrs vs structural + W6 ~14-18 hrs. Three-to-four hours is shippable in one session; 18 hrs spans 2-3 sessions and increases scope risk.
4. Ratchet effect — once W6 ships, operators expect notifications to keep working; B-cycle then has to backfill a notification feed against a hard UX commitment. Structural-only preserves freedom to design the notification feed properly when B-cycle backend lands.

**Operator can override** if they have a specific search/bell pain point that warrants 17b-now.

---

## 5. events.tsx 17a tactical cleanup plan

### 5a. Lines to subtract

**File:** `mingla-business/app/(tabs)/events.tsx`

**Subtract 1:** rightSlot prop block (lines 393-416, ~24 lines).
Current:
```tsx
rightSlot={
  // [TRANSITIONAL] events.tsx renders search + bell + plus inline because
  // TopBar's rightSlot prop replaces (not composes) the default cluster.
  // EXIT: 17b structural rework adds an `extraRightSlot` prop to TopBar;
  // events.tsx switches to passing only the `+` icon via the new prop.
  // Per D-CYCLE17A-FOR-1 + proposed I-37. Cycle 17a tactical fix —
  // 17b TopBar refactor will delete topBarRightCluster style entry below.
  <View style={styles.topBarRightCluster}>
    <IconChrome icon="search" size={36} accessibilityLabel="Search" />
    <IconChrome
      icon="bell"
      size={36}
      accessibilityLabel="Notifications"
    />
    {canCreateEvent ? (
      <IconChrome
        icon="plus"
        size={36}
        onPress={handleBuildEvent}
        accessibilityLabel="Build a new event"
      />
    ) : null}
  </View>
}
```

**Replace with** (~6 lines):
```tsx
extraRightSlot={
  canCreateEvent ? (
    <IconChrome
      icon="plus"
      size={36}
      onPress={handleBuildEvent}
      accessibilityLabel="Build a new event"
    />
  ) : null
}
```

**Subtract 2:** `topBarRightCluster` style block (lines 632-638, ~7 lines including comment). DELETE entirely. The new TopBar's own `rightCluster` style takes over.

**Subtract 3:** TRANSITIONAL marker comment lines 394-399 (6 lines). DELETE — anchor is satisfied.

### 5b. Net delta

- events.tsx: -25 LOC subtracted, +6 LOC added → **net -19 LOC**
- TopBar.tsx: +5 LOC for `extraRightSlot` prop + render branch
- 0 imports change in events.tsx
- 0 behavioral change for users (cluster renders identically)

### 5c. Verification check

- Pre-change: `[search, bell, +]` cluster (when canCreateEvent), `[search, bell]` (when not)
- Post-change: identical visual outcome via `extraRightSlot` composition

---

## 6. CI grep gate design

### 6a. Workflow file location

**NEW file:** `.github/workflows/strict-grep-mingla-business.yml`

Per 17a SPEC-DISCOVERY-1, no strict-grep CI gate exists yet. 17b is the first one.

### 6b. Gate logic (pseudo-grep)

For every `<TopBar` JSX usage in `mingla-business/`:
1. Extract the `leftKind=` value
2. Check whether `rightSlot=` appears in the same JSX block
3. If `leftKind="brand"` AND `rightSlot=` is present (and not `extraRightSlot=`) → FAIL CI

Implementation approach: Node script using `@babel/parser` + AST traversal (more robust than naive regex against multi-line JSX).

**Alternative simpler approach:** ripgrep multi-line capture per-file:
```bash
rg --multiline --pcre2 '<TopBar[^>]*leftKind="brand"[^>]*\srightSlot=' mingla-business/app/ mingla-business/src/
```
If any match → FAIL CI. Simple but may false-positive on `<TopBar leftKind="brand"` then later `extraRightSlot=` with `rightSlot=` mentioned in a comment.

**Recommendation:** start with the AST-based approach for accuracy. ~150 LOC TypeScript or Node script. Run on `pull_request` triggered for the `Seth` and `main` branches.

### 6c. Failure mode

- **FAIL CI** (red X on PR) if any violation found
- Output line numbers + file path so the implementor knows exactly where
- Allowlist via inline comment `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>` (mirrors 17a's `canManualCheckIn` pattern)

### 6d. Coverage expansion

Future strict-grep gates can extend the same workflow file:
- `canManualCheckIn` allowlist enforcement (currently preventive comments only — gate doesn't exist)
- I-32 SQL parity grep (mentioned in Cycle 13a but not implemented)
- I-36 ROOT-ERROR-BOUNDARY grep gate (proposed at Cycle 16a but not implemented)

17b's gate workflow becomes the **scaffolding** for future invariant enforcement gates. SPEC time decision: write 17b's gate to be additive-friendly (each invariant = its own gate function in the same workflow).

### 6e. Estimated effort

- Workflow YAML + Node script + 3-4 tests: ~2-3 hrs
- Documentation in `INVARIANT_REGISTRY.md` cross-reference: ~15 min

---

## 7. I-37 invariant text draft

Following the format of existing entries (I-32, I-35, I-36):

```markdown
### I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS — `leftKind="brand"` TopBar consumers MUST render the default `[search, bell]` cluster (mingla-business — Cycle 17b — DRAFT, flips to ACTIVE post-Cycle-17b CLOSE)

**Statement:** Every `mingla-business` `<TopBar>` consumer with `leftKind="brand"` (primary tab routes — currently `home.tsx`, `events.tsx`, `account.tsx`, plus dev `__styleguide.tsx` fixtures) MUST render the default `[search, bell]` cluster on the right side of the top bar. Page-specific extras (e.g., the `+` icon on events tab) MUST compose via the NEW `extraRightSlot` prop, NOT replace via `rightSlot`.

**Scope:** `leftKind="brand"` consumers ONLY. `leftKind="back"` consumers (sub-route pages like Edit Brand, Audit Log, Brand Payments, Event Detail) are OUT of scope — they intentionally suppress the default cluster via `rightSlot={null}` or `rightSlot={<View />}` for focused-task UX.

**Why this exists:** Pre-17a, events.tsx replaced the default cluster with a single `+` icon, removing search + bell from that tab. Founder feedback 2026-05-04: search + bell + `+` should all be present together. 17a tactical fix was an inline cluster within `rightSlot={<View>...</View>}`. 17b structural fix introduces `extraRightSlot` prop and codifies the rule.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` — fails CI on PR if any `<TopBar leftKind="brand">` consumer passes `rightSlot=` (instead of `extraRightSlot=`). Allowlist via inline comment with documented reason.

**EXIT condition:** None — permanent invariant. If the design system ever pivots to per-tab top-bar variations, supersede via NEW invariant; do not silently relax.

**Cross-reference:** Cycle 17a §A.1 tactical fix (events.tsx:393-417) deleted at 17b CLOSE; Cycle 17b SPEC binding contract; D-CYCLE17A-FOR-3 anchor; founder feedback FOUNDER_FEEDBACK.md 2026-05-04 sub-item 2.
```

---

## 8. Decomposition recommendation

### 8a. Three options

| Option | Scope | Effort | Sessions |
|---|---|---|---|
| **17b structural-only (RECOMMENDED)** | Add `extraRightSlot` + migrate events.tsx + I-37 + CI gate. Search + bell stay inert (W1+W5). | **~4-5 hrs** | 1 session |
| **17b structural + badge (W7)** | Above + bell shows badge from `eventEditLogStore` recent + invites pending count. Click stays inert. | ~6-7 hrs | 1 session |
| **17b structural + full screens (W2+W6)** | Above + new `app/search.tsx` + `app/notifications.tsx` routes wired with click actions. | ~14-18 hrs | 2-3 sessions |

### 8b. Why structural-only

1. **Founder ask is layout, not function** — "constant on top bar at all times" reads as visual presence, satisfied by structural-only.
2. **Ratchet risk is real** — wiring search/bell now defines what they DO; that's harder to walk back than not shipping.
3. **No empirical operator demand** — current TopBar default cluster has been render-only since Cycle 0a (Cycle 1+ wires marker exists). Operators have used the app through 16 cycles without flagging "I want to tap the bell." If they had, that signal would already be in `FOUNDER_FEEDBACK.md` or operator-driven cycles.
4. **B-cycle alignment** — real notification feed needs OneSignal SDK + edge fn + notification table. Structural-only preserves architectural freedom; W6 forces a UX commitment before backend exists.
5. **Effort proportionality** — 4-5 hrs structural delivers 80% of founder-feedback resolution (visual constancy). The remaining 20% (clickable actions) costs 3-5x more effort and locks future decisions.

### 8c. Carve-out for later

If structural-only ships and operators subsequently surface "I want to tap the bell to see what changed since I last opened the app," queue **17b-W** as a follow-up mini-cycle:
- Forensics on real operator demand for search vs notifications
- Decision tree W2/W3 vs W6/W7 based on observed pain
- Ships as separate cycle with its own SPEC + IMPL + tester

This sequencing matches the operator's `FOUNDER_FEEDBACK.md` pattern — log feedback, evaluate when validated, ship when justified.

---

## 9. Operator decisions queued (D-17b-1 through D-17b-8)

| ID | Decision | Forensics recommendation | Notes |
|---|---|---|---|
| **D-17b-1** | Decomposition strategy: structural-only, structural + badge (W7), or structural + full screens (W2+W6)? | **Structural-only** | Founder ask is layout; ratchet risk; ~4-5h vs 14-18h |
| **D-17b-2** | `rightSlot` fate: deprecate entirely, or keep as escape-hatch for back-routes? | **Keep as escape-hatch** | 15 back-route consumers legitimately need replace pattern |
| **D-17b-3** | Search icon tap action: stay decorative (W1), new screen (W2), inline filter (W3)? | **W1 (decorative)** | If operator validates pain post-ship → 17b-W |
| **D-17b-4** | Bell icon tap action: stay decorative (W5), new screen (W6), badge-only (W7), pure status quo (W8)? | **W5 (decorative)** | Same logic as D-17b-3 |
| **D-17b-5** | CI grep gate: new dedicated workflow OR extend existing? Failure mode fail-CI OR warning? | **NEW workflow `strict-grep-mingla-business.yml`, fail-CI** | First strict-grep gate; scaffolds future I-32/I-34/I-36 enforcement |
| **D-17b-6** | I-37 coverage scope: `leftKind="brand"` only OR every TopBar consumer? | **`leftKind="brand"` only** | Back-routes intentionally suppress; treating as violation breaks UX |
| **D-17b-7** | Search data source if W2/W3 ships | N/A — defer (W1 recommended) | Skip if D-17b-3 is W1 |
| **D-17b-8** | Bell data source if W6/W7 ships | N/A — defer (W5 recommended) | Skip if D-17b-4 is W5 |

---

## 10. Confidence per area

| Area | Confidence | Why |
|---|---|---|
| Consumer mapping (19 instances across 12 files) | **High** | Direct grep + read of every match |
| `extraRightSlot` API design | **High** | Mirrors existing TopBar.tsx style + minimal additive surface |
| events.tsx tactical cleanup line-precise plan | **High** | Verified directly; lines 393-417 + 632-638 + 394-399 |
| CI grep gate workflow location | **Medium-High** | No existing pattern to mirror in this repo; recommendation is reasonable but fresh ground |
| W1-W8 effort estimates | **Medium** | Search/bell screens haven't been scoped before; estimates are rough |
| Recommended decomposition (structural-only) | **High** | Anchored in founder-feedback parsing + ratchet-risk reasoning + effort-proportionality |
| Available local data sources for bell W7 | **Medium** | 3 stores identified; haven't read their full APIs to confirm count derivation is straightforward |
| I-37 text draft | **High** | Matches I-32/I-35/I-36 format verbatim |

---

## 11. Discoveries for orchestrator

**D-CYCLE17B-FOR-1 — `<View />` placeholder pattern in back-routes is widespread.**
10 of 19 TopBar consumers use `rightSlot={<View />}` for layout balance on back-routes. This is intentional but undocumented as a pattern. **Recommendation:** add a JSDoc note in `TopBar.tsx` near the `rightSlot` prop describing the documented patterns:
- Primary tabs (`leftKind="brand"`) → use `extraRightSlot`
- Back-routes → `rightSlot={<View />}` for empty placeholder OR `rightSlot={<custom-action>}` for page-specific OR `rightSlot={null}` for no slot at all

**D-CYCLE17B-FOR-2 — `BrandFinanceReportsView.tsx:305-318` decorative download icon could become Pressable post-B-cycle.**
Current code uses `<View accessibilityRole="image" ...>` with download Icon — explicit non-Pressable to avoid Const #1 dead-tap (Pressable disabled still announces as button to screen readers). When B-cycle wires real CSV-via-Resend export, this becomes a real Pressable. **Out of 17b scope** but log for B-cycle.

**D-CYCLE17B-FOR-3 — `BrandEditView.tsx:339` saveButton is a back-route bucket-b consumer.**
Single Pressable wrapping a Save text button. Replaces default cluster on a back-route — intentional for focused edit task. NOT a 17b violation. Documenting because it's the only single-icon `rightSlot=` replace pattern outside events.tsx tactical cluster.

**D-CYCLE17B-FOR-4 — `app/event/[id]/index.tsx:625-640` event-detail share + moreH cluster is the only "extras-on-back-route" pattern.**
Back-route consumer with multi-icon cluster (Share + Manage). Could theoretically migrate to `extraRightSlot` if I-37 ever extended to back-routes. Currently out of scope — NOT a 17b concern.

**D-CYCLE17B-FOR-5 — `app/checkout/[eventId]/*` uses `CheckoutHeader`, not `TopBar`.**
Buyer-facing checkout routes have their own header primitive per anon-tolerant routing. NOT a 17b concern. Documented for completeness.

**D-CYCLE17B-FOR-6 — Three pre-existing strict-grep gate proposals never implemented.**
Cycle 13a I-32 (rank parity), Cycle 13b I-34 (canManualCheckIn decommission), Cycle 16a I-36 (ROOT-ERROR-BOUNDARY) all proposed CI grep gates but the gates were never created. 17b's `strict-grep-mingla-business.yml` workflow is the first. **Recommendation:** at 17b SPEC time, scaffold the workflow to make adding I-32/I-34/I-36 gates trivial post-17b — e.g., one Node script per invariant, central runner. Don't IMPL all four in 17b (scope creep), but design for additive-friendliness.

**D-CYCLE17B-FOR-7 — TopBar header comment at lines 11-22 is informationally dense + worth shortening.**
Current header documents Cycle 0a vs Cycle 1+ behaviors with TRANSITIONAL marker. Once `extraRightSlot` ships, the header would benefit from a refresh that documents the 3 patterns (default, replace, compose) cleanly. **Out of 17b core scope** but a small polish item that natural-fits the same SPEC.

---

## 12. Cross-references

- 17b dispatch: `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- 17a investigation (Item A six-field root cause + D-CYCLE17A-FOR-1 anchor): `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17A_QUICK_WINS.md`
- 17a SPEC (§A.1 tactical fix — anchors 17b cleanup): `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md`
- 17a IMPL report: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17A_QUICK_WINS_REPORT.md`
- 17a QA report: `Mingla_Artifacts/reports/QA_BIZ_CYCLE_17A_QUICK_WINS_REPORT.md`
- Master inventory: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17_REFINEMENT_PASS.md`
- TRANSITIONAL anchor in code: `mingla-business/app/(tabs)/events.tsx:393-399`
- TopBar primitive: `mingla-business/src/components/ui/TopBar.tsx`
- Founder feedback (sub-item 2): `Mingla_Artifacts/FOUNDER_FEEDBACK.md` 2026-05-04 entry
- Operator decisions previously locked: D-17-12 (constant top-bar wire-up → 17b core scope)
- Memory rules consulted:
  - `feedback_layman_first` — layman summary leads
  - `feedback_no_summary_paragraph` — drops trailing prose
  - `feedback_implementor_uses_ui_ux_pro_max` — applies at 17b SPEC time (TopBar visual changes)
  - `feedback_sequential_one_step_at_a_time` — 17b before 17c

---

**END OF INVESTIGATION — NO SPEC PRODUCED.**

**Next operator action:** review §9 D-17b-1..8 plain-English questions; lock decomposition (DEC-101+); orchestrator authors `SPEC_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` against the locked scope.
