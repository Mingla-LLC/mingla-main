# SPEC — META-ORCH-1074 Sub-D [Business notification copy & default-prefs]

**Date:** 2026-06-04
**Mode:** COPY (product/copy artifact — NO code)
**Owner:** mingla-product+claude
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]/` on branch `META-ORCH-1074-business-notifications`
**Feeds:** Sub-A payloads (`title`/`body`/`deepLink` per `notifyBrandManagers` call) + Sub-C settings (default-prefs matrix + per-type pref rows).
**Inputs (read, built upon, not re-derived):**
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` (§3.A.5 trigger payloads, §6 copy contract — the parent spec)
- `Mingla_Artifacts/reports/TAXONOMY_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` (event catalog, recipients, deep-links)
- `.claude/skills/mingla-product/references/canonical-voice.md` (Mingla Business voice — "Your Place Deserves to Be Found")
- `mingla-business/src/constants/stripeNotificationTemplates.ts` (`NotificationTemplate` shape + `{var}` interpolation convention to mirror)
- `mingla-business/app/account/notifications.tsx` (the 4 coarse master categories to nest under)

**Comms-ledger acks (this turn):** COMMS-0019 (FYI — this is the renumbered META-ORCH-1074 business-notifications session; no action). Read; no BLOCK/WARN addressed to `mingla-product` or this ORCH.

---

## 0. Scope correction vs the parent spec (operator-locked 2026-06-04)

The parent SPEC and Taxonomy list **12** v1 types including `business.new_follower`. **Sub-D is locked to 11 types — `business.new_follower` is DROPPED** (operator decision 2026-06-04, resolving parent §7 Q2 in favor of full descope, not "ship inert"). The follower model is deferred to a future ORCH. This spec does NOT define copy or a pref row for `new_follower`; Sub-A does NOT build its trigger; Sub-C does NOT render its pref row.

Other operator locks folded in here:
- **Low-inventory threshold = 10% remaining** (parent §7 Q3 resolved). Copy uses the absolute `{remaining}` count in the string but the fire-condition is "crossed ≤10% of capacity and >0."

**The 11 LOCKED v1 types:**
`business.order_paid`, `business.event_sold_out`, `business.refund_processed`, `business.dispute_opened`, `business.dispute_action_needed`, `business.payout_paid`, `business.account_status_changed`, `business.new_review`, `business.claim_decision`, `business.low_inventory`, `business.team_member_joined`.

---

## 1. Voice contract (Mingla Business)

Audience: **brand owners and their teams** — restaurants, bars, venues, cafés, AND experience / trip / adventure organizers (cooking-class hosts, tour operators, day-trip planners). Founder-led, operator-respecting, "you shouldn't need to become a full-time marketer." Copy here morphs that voice into the push/inbox format:

- **Warm but professional.** Plain English, no jargon, no hype, no emoji-spam.
- **Money wins feel good.** A sale, a sold-out event, a payout may carry a single tasteful celebratory touch ("Nice work."). At most ONE emoji on the two pure-celebration types (`order_paid`, `event_sold_out`); none elsewhere. Risk/trust copy carries zero emoji.
- **Risk events are calm and action-oriented, never alarming.** Disputes, account changes, refunds read as "here's what happened, here's the one thing to do" — never red-alert panic. Mirror the existing `stripe.*` template register (`stripeNotificationTemplates.ts`), which is already calm + directive.
- **Kind-aware nouns.** Listings can be events, trips, or experiences. Copy uses the neutral `{eventTitle}` slot (the listing's title regardless of kind) so it reads correctly for an event night, a 3-day trip, or a cooking class. No copy says the literal word "event" where a trip/experience could be the subject — it uses the title.
- **Char budgets (mirror `stripeNotificationTemplates`):** push title ≤ ~40 chars (scannable on a lock screen — looser than the legacy ≤30 to fit `{brandName}`), push body ≤ ~120 chars. In-app title/body may be slightly richer. Every `{var}` has a sensible literal fallback (never show a raw `{var}`).

---

## 2. Currency-aware formatting rule (LOCKED — applies to every money slot)

Mingla charges each seller in their OWN currency; never hardcode `£`/`$`/`€`. The copy strings carry a **pre-formatted** `{amount}` string slot (same convention as `stripeNotificationTemplates.ts` `{amount}`), NOT a raw cents integer. Sub-A is responsible for formatting cents → a localized currency string at dispatch time:

- Sub-A formats `{amount}` from `(amountCents, currency)` using the brand's `currency` (the `notifications`/order/payout currency column — already present per the all-in pricing engine, memory `project_orch_1034_currency_de_gbp_scope`). Use `Intl.NumberFormat(undefined, { style:"currency", currency })` semantics (or the existing money-formatter shared in the edge layer) so e.g. `1500, "USD"` → `"$15.00"`, `1500, "NGN"` → `"₦1,500.00"`, `1500, "GBP"` → `"£15.00"`.
- The copy templates therefore reference `{amount}` (string), never `{totalCents}` or `{currency}` directly. `currency` and `*Cents` remain in the `data` payload for the inbox/analytics, but the human strings only ever interpolate the formatted `{amount}`.
- **No `?? "GBP"` fallback** in this copy path (memory: ORCH-1034 banned GBP fallbacks). If `currency` is missing at format time that is a Sub-A data bug, not a copy concern — flag, don't paper over with £.

---

## 3. Per-type copy + data slots + deep-link + recipients (the 11)

Notation: deep-link expressed as the `mingla-business://…` URI convention from parent §4.B.4 (the `deep_link` column value; Sub-B's `processNotification` parses it). Recipient roles per Taxonomy §D + parent §3.A.3. Data slots name the variable + its source so Sub-A can populate the `notifyBrandManagers` `data`/`vars`.

Severity maps to the existing `NotificationTemplate.severity` union (`blocking` | `warning` | `info`) — drives inbox sort + emphasis.

---

### 3.1 `business.order_paid` — "You made a sale"
- **Severity:** info · **Master category:** Order activity
- **Push title:** `New sale 🎉`
- **Push body:** `{eventTitle}: {amount} just came in.`
- **In-app title:** `You made a sale`
- **In-app body:** `{qty} × {eventTitle} — {amount}. Tap to see the order.`
- **Data slots:**
  - `{eventTitle}` ← `events.title` (resolved from `eventId`). Fallback: `your listing`.
  - `{amount}` ← formatted from order `total_cents` + `currency` (§2). Fallback: `a new order`.
  - `{qty}` ← ticket count on the order. Fallback: `1`.
  - (payload also carries `orderId`, `eventId`, `totalCents`, `currency` for the inbox/deep-link; not all shown in copy.)
- **Deep-link:** `mingla-business://event/{eventId}` (the order surfaces under the event in Hub).
- **Recipients:** account_owner, brand_admin, finance_manager.

### 3.2 `business.event_sold_out` — "Sold out"
- **Severity:** info · **Master category:** Order activity
- **Push title:** `Sold out 🎉`
- **Push body:** `{eventTitle} is sold out — nice work.`
- **In-app title:** `{eventTitle} sold out`
- **In-app body:** `All {capacity} spots are gone. Nice work.`
- **Data slots:**
  - `{eventTitle}` ← `events.title` from `eventId`. Fallback: `Your listing`.
  - `{capacity}` ← published capacity (`events`/`ticket_types` capacity math in the finalize RPC). Fallback: `every`.
- **Deep-link:** `mingla-business://event/{eventId}`.
- **Recipients:** account_owner, brand_admin.

### 3.3 `business.low_inventory` — "Almost gone"
- **Severity:** info · **Master category:** Order activity
- **Push title:** `Almost gone`
- **Push body:** `{eventTitle}: only {remaining} left.`
- **In-app title:** `{eventTitle} is almost gone`
- **In-app body:** `Only {remaining} of {capacity} left. Promote it while there's still demand.`
- **Data slots:**
  - `{eventTitle}` ← `events.title` from `eventId`. Fallback: `Your listing`.
  - `{remaining}` ← remaining capacity at the fire moment (post-finalize). Fallback: `a few`.
  - `{capacity}` ← published capacity. Fallback omitted-line gracefully (see SC-D1).
  - (`pct` in payload for analytics; fire-condition = crossed ≤10%.)
- **Deep-link:** `mingla-business://event/{eventId}`.
- **Recipients:** account_owner, brand_admin.

### 3.4 `business.refund_processed` — "Refund processed"
- **Severity:** info · **Master category:** Payments & trust
- **Push title:** `Refund processed`
- **Push body:** `{amount} refunded for {eventTitle}.`
- **In-app title:** `Refund processed`
- **In-app body:** `{amount} was refunded for {eventTitle}. The buyer sees it in 5–10 business days.`
- **Data slots:**
  - `{amount}` ← formatted from refund `amount_cents` + `currency` (§2). Fallback: `A refund`.
  - `{eventTitle}` ← `events.title` resolved from the refunded order's `eventId`. Fallback: `a recent order`.
  - (payload carries `orderId`, `refundId`, `amountCents`, `currency`.)
- **Deep-link:** `mingla-business://event/{eventId}` (order under the event). If an order-detail route exists, prefer `mingla-business://order/{orderId}` — see §6 flag.
- **Recipients:** account_owner, finance_manager.

### 3.5 `business.dispute_opened` — "Dispute opened"
- **Severity:** warning · **Master category:** Payments & trust
- **Push title:** `Dispute opened`
- **Push body:** `A {amount} charge is disputed. Tap to review.`
- **In-app title:** `A charge was disputed`
- **In-app body:** `A buyer disputed a {amount} charge. Review it in Payments — you can respond before {evidenceDueBy}.`
- **Data slots:**
  - `{amount}` ← formatted from dispute `amount` + `currency` (§2). Fallback: `a`.
  - `{evidenceDueBy}` ← `evidence_due_by` (formatted date) from the Stripe dispute object (`stripeDisputeHandlers.ts` `handleChargeDispute`). Fallback: in-app line drops the "before …" clause (see SC-D1). Push body does NOT use it.
  - (payload carries `disputeId`, `orderId`, `reason`.)
- **Deep-link:** `mingla-business://payments`.
- **Recipients:** account_owner, finance_manager.

### 3.6 `business.dispute_action_needed` — "Evidence due"
- **Severity:** blocking · **Master category:** Payments & trust
- **Push title:** `Evidence due soon`
- **Push body:** `Submit evidence by {evidenceDueBy} to contest a {amount} dispute.`
- **In-app title:** `Evidence needed to contest a dispute`
- **In-app body:** `Submit your evidence by {evidenceDueBy} or the {amount} dispute is lost by default. Tap to respond.`
- **Data slots:**
  - `{evidenceDueBy}` ← `evidence_due_by` (formatted date) from the dispute object. Fallback: `the deadline`.
  - `{amount}` ← formatted from dispute `amount` + `currency` (§2). Fallback: `the`.
  - (payload carries `disputeId`, `orderId`, `status` — drives idempotency.)
- **Deep-link:** `mingla-business://payments`.
- **Recipients:** account_owner, finance_manager.

### 3.7 `business.payout_paid` — "You got paid"
- **Severity:** info · **Master category:** Payments & trust
- **Push title:** `You got paid`
- **Push body:** `{amount} is on its way to your bank.`
- **In-app title:** `You got paid`
- **In-app body:** `{amount} is on its way to your bank — expected {arrivalDate}.`
- **Data slots:**
  - `{amount}` ← formatted from payout `amount_cents` + `currency` (§2). Fallback: `A payout`.
  - `{arrivalDate}` ← `arrival_date` (formatted date) from the Stripe payout object (`stripeWebhookRouter.ts` `handlePayout` `payout.paid` branch). Fallback: in-app drops the "expected …" clause (SC-D1).
  - (payload carries `payoutId`.)
- **Deep-link:** `mingla-business://payments`.
- **Recipients:** account_owner, finance_manager.

### 3.8 `business.account_status_changed` — "Account update" (branches on `data.status`)
- **Severity:** `restricted` → blocking · `reactivated` → info · **Master category:** Payments & trust
- **Branch A — `status = "restricted"`:**
  - **Push title:** `Payments paused`
  - **Push body:** `{brandName}: Stripe paused payments. Tap to resolve.`
  - **In-app title:** `Payments paused on {brandName}`
  - **In-app body:** `Stripe paused payments while it verifies a few details. Resolve it to start accepting payments again.`
- **Branch B — `status = "reactivated"`:**
  - **Push title:** `Payments back on`
  - **Push body:** `{brandName} can accept payments again.`
  - **In-app title:** `{brandName} is back online`
  - **In-app body:** `Stripe finished verifying — payments and payouts are working again. Nothing more for you to do.`
- **Data slots:**
  - `{status}` ← `data.status` ∈ {`restricted`, `reactivated`}, derived from the `account.updated` `charges_enabled`/`payouts_enabled` transition (`stripeWebhookRouter.ts` `syncAccount` prior-snapshot). Drives the branch.
  - `{brandName}` ← `brands.name` from `brandId`. Fallback: `Your account`.
  - (payload carries `stripeAccountId`, `chargesEnabled`, `payoutsEnabled`.)
- **Deep-link:** `mingla-business://payments`.
- **Recipients:** account_owner, finance_manager.

### 3.9 `business.new_review` — "New review"
- **Severity:** info · **Master category:** Audience & content
- **Push title:** `New review`
- **Push body:** `{rating}★ — see what they said.`
- **In-app title:** `New {rating}★ review`
- **In-app body:** `Someone left {brandName} a {rating}★ review. Tap to read it.`
- **Data slots:**
  - `{rating}` ← `place_reviews.rating` / `experience_feedback.rating` (1–5). Fallback: in-app uses "a new review"; push uses `New review` (SC-D1). REQUIRED for the ★ form.
  - `{brandName}` ← `brands.name` resolved from the reviewed place/experience. Fallback: `your brand`.
  - (payload carries `reviewId`, `placeOrExperienceId`, `kind` ∈ {`place`,`experience`}; only `approved` moderation_status fires.)
  - **NO `{reviewerName}` slot** — see §6 data-slot flag (reviewer identity not reliably available + privacy). Copy is intentionally reviewer-anonymous.
- **Deep-link:** `mingla-business://event/{relatedId}` where `relatedId` resolves to the listing/review surface for the reviewed place/experience. See §6 flag (review surface route).
- **Recipients:** account_owner, brand_admin.

### 3.10 `business.claim_decision` — "Claim approved/declined" (branches on `data.decision`)
- **Severity:** `approved` → info · `rejected` → warning · **Master category:** Brand team
- **Branch A — `decision = "approved"`:**
  - **Push title:** `Claim approved`
  - **Push body:** `{brandName} is yours. Tap to finish setup.`
  - **In-app title:** `{brandName} claim approved`
  - **In-app body:** `You now manage {brandName}. Tap to finish your listing and start reaching people nearby.`
- **Branch B — `decision = "rejected"`:**
  - **Push title:** `Claim update`
  - **Push body:** `We couldn't approve your {brandName} claim. Tap for next steps.`
  - **In-app title:** `About your {brandName} claim`
  - **In-app body:** `We couldn't approve your claim for {brandName}. {rejectionReason} Tap to see how to resolve it.`
- **Data slots:**
  - `{decision}` ← `data.decision` ∈ {`approved`,`rejected`} from `admin-review-venue-claim` approve/reject branch. Drives the branch.
  - `{brandName}` ← `brands.name` (`brandRow`). Fallback: `your brand`.
  - `{rejectionReason}` ← rejection reason text (rejected branch only). Fallback: in-app drops the sentence (SC-D1).
- **Deep-link:** `mingla-business://brand/{brandId}/listing`.
- **Recipients:** account_owner (single recipient = brand owner; `dispatchNotification` not `notifyBrandManagers`).

### 3.11 `business.team_member_joined` — "Teammate joined"
- **Severity:** info · **Master category:** Brand team
- **Push title:** `Teammate joined`
- **Push body:** `{memberName} joined {brandName} as {role}.`
- **In-app title:** `{memberName} joined your team`
- **In-app body:** `{memberName} accepted your invite to {brandName} as {role}.`
- **Data slots:**
  - `{memberName}` ← the joining member's display name. **UNCERTAIN source — see §6 data-slot flag.** Fallback: `A new teammate` (push: `Someone joined {brandName} as {role}.`).
  - `{brandName}` ← `brands.name` from `brandId`. Fallback: `your brand`.
  - `{role}` ← `brand_team_members.role` (humanized: `brand_admin`→"admin", `finance_manager`→"finance manager", `event_manager`→"event manager", `scanner`→"scanner", `account_owner`→"owner"). Fallback: `a teammate` (drops "as {role}").
  - (payload carries `memberUserId`, `memberRole`.)
- **Deep-link:** `mingla-business://brand/{brandId}/team`.
- **Recipients:** account_owner, brand_admin (EXCLUDING the just-joined member).

---

## 4. Default-preferences matrix (LOCKED)

Channels: **push** (OneSignal delivery) + **in_app** (the `notifications` row always writes; `in_app` controls inbox visibility/honor). Defaults are written where Sub-C reads them and honored by `notify-dispatch` `notification_preferences` (channel × type × opt_in).

| # | Type | push default | in_app default | Master category | Severity |
|---|------|:---:|:---:|---|---|
| 1 | `business.order_paid` | **ON** | ON | Order activity | info |
| 2 | `business.event_sold_out` | **ON** | ON | Order activity | info |
| 3 | `business.low_inventory` | **ON** | ON | Order activity | info |
| 4 | `business.refund_processed` | **ON** | ON | Payments & trust | info |
| 5 | `business.dispute_opened` | **ON** | ON | Payments & trust | warning |
| 6 | `business.dispute_action_needed` | **ON** | ON | Payments & trust | blocking |
| 7 | `business.payout_paid` | **ON** | ON | Payments & trust | info |
| 8 | `business.account_status_changed` | **ON** | ON | Payments & trust | blocking/info |
| 9 | `business.new_review` | **ON** | ON | Audience & content | info |
| 10 | `business.claim_decision` | **ON** | ON | Brand team | info/warning |
| 11 | `business.team_member_joined` | **OFF** | ON | Brand team | info |

**Rule:** money/trust events (order_paid, payout_paid, refund, dispute_*, account_status, claim_decision) default push=ON + in_app=ON — a brand cannot afford to miss them. Growth/ops (event_sold_out, low_inventory, new_review) default in_app=ON with push=ON per operator guidance (sold_out + new_review are high-signal; low_inventory is a timely promote-now nudge). `team_member_joined` is the one push=OFF default (low-urgency, prevents alert fatigue; user can opt in). `new_follower` dropped entirely (§0).

---

## 5. Mapping to the 4 coarse master categories (Sub-C nesting)

`mingla-business/app/account/notifications.tsx` ships **4** master toggles persisting to `notificationPrefsStore` (Zustand): **Order activity** (default ON), **Scanner activity** (ON), **Brand team** (ON), **Marketing** (OFF). Sub-D introduces a **5th implied grouping, "Payments & trust,"** because the money-risk types do not belong under "Order activity" (which is described as "when buyers purchase, refund, or cancel") nor "Scanner." Two ways Sub-C can realize this — **designer's call** (flagged to mingla-designer in parent §5.C.4); Sub-D only fixes the per-type → group assignment:

| Per-type row | Nests under master category |
|---|---|
| order_paid, event_sold_out, low_inventory | **Order activity** |
| refund_processed, dispute_opened, dispute_action_needed, payout_paid, account_status_changed | **Payments & trust** (NEW group — or fold under Order activity if designer keeps 4 masters) |
| new_review | **Audience & content** (NEW group — or fold under Marketing/Brand-team per designer) |
| claim_decision, team_member_joined | **Brand team** |
| *(none in v1)* | **Scanner activity** (no v1 type maps here; the existing master stays for future `scanner_joined`/`checkin_summary`) |

**Notes for Sub-C:**
- The master toggle gates its children (master OFF → children disabled), per parent §5.C.4.
- Per-type prefs MUST persist to `notification_preferences` (the table `notify-dispatch` reads), not only Zustand, so the backend honors them.
- Preserve existing master defaults: Order activity ON, Scanner ON, Brand team ON, Marketing OFF (`notificationPrefsStore.ts`). The "Payments & trust" and "Audience & content" groupings, if added as new masters, default **ON** (they hold money/trust + the high-signal review).
- Marketing master stays the home for Mingla newsletter/product-update opt-in (`creator_accounts.marketing_opt_in`); none of the 11 transactional types live under Marketing.

---

## 6. Data-slot availability flags (resolve before Sub-A IMPLEMENT)

The following slots are NOT guaranteed by the trigger source named in the parent spec (§3.A.5). Each is handled with a graceful fallback in §3 so copy never breaks, but flagging for a clean Sub-A resolution:

| # | Type | Slot at risk | Issue | Resolution for Sub-A |
|---|------|---|---|---|
| F1 | `team_member_joined` | `{memberName}` | Parent §3.A.5 marks `memberName?` optional. `brand_team_members` stores `user_id` + `role`, not a display name; the member's name lives on `auth.users`/a profile/`creator_accounts` row that the `accept-brand-invitation` edge fn may not already join. | Sub-A resolves the joining user's display name (profile/creator_accounts lookup) at trigger time, OR ships with the `A new teammate` / `Someone joined` fallback. Copy works either way; name is the nicer path. **Not a blocker.** |
| F2 | `new_review` | review surface route for `{relatedId}` deep-link | Parent §4.B.4 leaves `new_review` deep-link as `event/{id}` "(or listing/review)". There is no confirmed dedicated review-detail route in the business app; `place_reviews`/`experience_feedback` attach to a place/experience, not necessarily a deck `event`. | Sub-A + Sub-B confirm the destination: route to the listing/place detail (`brand/{brandId}/listing` or the place surface) rather than `event/{id}` if the review isn't tied to a ticketed event. Pick ONE concrete route so the tap always lands. **Resolve at Sub-A/B.** |
| F3 | `new_review` | `{reviewerName}` | Intentionally NOT used (privacy + identity not reliably joinable). | None — copy is reviewer-anonymous by design. Documented, not a gap. |
| F4 | `refund_processed` | order-detail deep-link | Parent uses `event/{eventId}`; an `order/{orderId}` route would be more precise but may not exist. | Sub-A/B confirm whether an order-detail route exists; if not, `event/{eventId}` is the accepted fallback (the order surfaces under the event in Hub). **Not a blocker.** |
| F5 | all money types | `{amount}` formatting | `{amount}` must be formatted currency-aware at dispatch (§2). The edge layer needs a shared cents→localized-currency formatter keyed on the brand/order/payout `currency`. | Sub-A reuses the existing all-in-engine money formatter (or `Intl.NumberFormat`); MUST pass a pre-formatted string, never raw cents, and MUST NOT fall back to GBP (memory ORCH-1034). **Contract for Sub-A — verify the formatter exists.** |

None of F1–F5 blocks Sub-D (copy ships with fallbacks). F2 + F5 are the two worth resolving before Sub-A's trigger wiring so the deep-link and money string are correct on day one.

---

## 7. Success criteria (Sub-D)

- **SC-D1** — All 11 types have non-empty push title (≤ ~40 chars), push body (≤ ~120 chars), in-app title, in-app body. Every `{var}` has a documented fallback; rendering with a missing var shows the fallback literal, never a raw `{var}`. (Branch types `account_status_changed` + `claim_decision` cover both branch values.)
- **SC-D2** — Every type's deep-link matches the parent §4.B.4 `NAV_TARGETS` table (subject to F2/F4 route confirmation).
- **SC-D3** — The default-prefs matrix (§4) is encoded where Sub-C reads defaults: a fresh user sees all 11 with the §4 push/in_app defaults (only `team_member_joined` push=OFF).
- **SC-D4** — Copy passes Mingla business voice review: no dating-app framing, no AI slop, ≤1 emoji and only on `order_paid`/`event_sold_out`, risk copy calm + action-oriented, kind-aware `{eventTitle}` (reads for event/trip/experience). Money strings are currency-aware (no hardcoded £/$, no GBP fallback).
- **SC-D5** — Per-type → master-category mapping (§5) is consistent with the existing 4-category settings screen; no transactional type lands under Marketing.

---

## 8. Summary table (type → push title → default prefs)

| # | Type | Push title | Push body | push / in_app default | Recipients | Deep-link |
|---|------|-----------|-----------|:---:|---|---|
| 1 | order_paid | `New sale 🎉` | `{eventTitle}: {amount} just came in.` | ON / ON | owner, admin, finance | `event/{eventId}` |
| 2 | event_sold_out | `Sold out 🎉` | `{eventTitle} is sold out — nice work.` | ON / ON | owner, admin | `event/{eventId}` |
| 3 | low_inventory | `Almost gone` | `{eventTitle}: only {remaining} left.` | ON / ON | owner, admin | `event/{eventId}` |
| 4 | refund_processed | `Refund processed` | `{amount} refunded for {eventTitle}.` | ON / ON | owner, finance | `event/{eventId}` |
| 5 | dispute_opened | `Dispute opened` | `A {amount} charge is disputed. Tap to review.` | ON / ON | owner, finance | `payments` |
| 6 | dispute_action_needed | `Evidence due soon` | `Submit evidence by {evidenceDueBy} to contest a {amount} dispute.` | ON / ON | owner, finance | `payments` |
| 7 | payout_paid | `You got paid` | `{amount} is on its way to your bank.` | ON / ON | owner, finance | `payments` |
| 8 | account_status_changed | `Payments paused` / `Payments back on` | branches on `{status}` | ON / ON | owner, finance | `payments` |
| 9 | new_review | `New review` | `{rating}★ — see what they said.` | ON / ON | owner, admin | `event/{relatedId}` (F2) |
| 10 | claim_decision | `Claim approved` / `Claim update` | branches on `{decision}` | ON / ON | owner | `brand/{brandId}/listing` |
| 11 | team_member_joined | `Teammate joined` | `{memberName} joined {brandName} as {role}.` | **OFF** / ON | owner, admin | `brand/{brandId}/team` |

Dropped: `business.new_follower` (operator 2026-06-04 — descoped from v1; not built, no copy, no pref row).

---

## 9. Handoff notes

- **To Sub-A (implementor):** consume §3 `title`/`body` per type for the `notifyBrandManagers` call; format `{amount}` currency-aware (§2, F5); resolve F1 (`memberName`) + F2 (review route) + F4 (order route) at trigger time or accept the documented fallbacks. Severity values map to `NotificationTemplate.severity` for the inbox.
- **To Sub-C (implementor + designer):** consume §4 default matrix + §5 master-category mapping; the "Payments & trust" / "Audience & content" grouping decision (new masters vs fold into existing 4) is the designer's call — Sub-D only locks the per-type → group assignment.
- **Shape to encode (no code written here):** mirror `stripeNotificationTemplates.ts` `NotificationTemplate` (add `BUSINESS_NOTIFICATION_TEMPLATES` for the 11 `business.*` types) — `pushTitle`, `pushBody`, `inAppTitle`, `inAppBody`, `severity`, plus the branch handling for `account_status_changed` (on `data.status`) and `claim_decision` (on `data.decision`). `emailSubject`/`emailBody` are out of v1 push/in-app scope but may be added later from these same strings.
