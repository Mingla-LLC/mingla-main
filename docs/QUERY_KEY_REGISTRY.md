# Query Key Registry

> Canonical source for all React Query key shapes.
> Code lives in `app-mobile/src/hooks/queryKeys.ts` (consolidated) and
> original hook files (not yet consolidated).
> This document is the human-readable reference.
>
> Established: 2026-03-23 (Launch Hardening Program)

---

## Rules

1. **One factory per entity.** Never create inline query key arrays.
2. **All new factories go in `queryKeys.ts`.** Existing factories in original files are documented here with consolidation status.
3. **Mutations invalidate via `factory.all`** prefix to reach all sub-queries.
4. **New keys require a registry entry** before implementation.
5. **Old keys must be removed** — no "keep both for now."

---

## Consolidated Factories (in queryKeys.ts)

### savedCardKeys

| Sub-key | Shape | Used by |
|---------|-------|---------|
| `all` | `['savedCards']` | Invalidation target |
| `list(userId)` | `['savedCards', 'list', userId]` | useSavedCards |
| `saves(userId)` | `['savedCards', 'saves', userId]` | useSavesQuery |
| `paired(pairedUserId, cat?)` | `['savedCards', 'paired', pairedUserId, cat]` | usePairedSaves |
| `board(sessionId)` | `['savedCards', 'board', sessionId]` | Board saves |

**Invalidation rule:** All save/unsave/remove mutations → `savedCardKeys.all`
**Old keys removed:** `['pairedSaves', ...]`, `['saves', ...]`, inline `["savedCards", userId]`

### personCardKeys

| Sub-key | Shape | Used by |
|---------|-------|---------|
| `all` | `['personCards']` | Invalidation target |
| `hero(pairedUserId, holidayKey)` | `['personCards', 'hero', ...]` | usePersonHeroCards |
| `paired(pairedUserId, holidayKey, locKey)` | `['personCards', 'paired', ...]` | usePairedCards |

**Invalidation rule:** Shuffle → `setQueryData` on specific sub-key. No broad invalidation (Infinity staleTime).
**Old keys removed:** `['person-hero-cards', ...]`, `['paired-cards', ...]`

---

## Factories in Original Files (consolidation planned)

### friendsKeys (useFriendsQuery.ts)

| Sub-key | Shape |
|---------|-------|
| `all` | `['friends']` |
| `list(userId)` | `['friends', 'list', userId]` |
| `requests(userId)` | `['friends', 'requests', userId]` |
| `blocked(userId)` | `['friends', 'blocked', userId]` |
| `muted(userId)` | `['friends', 'muted', userId]` |

**Invalidation rule:** Accept/remove/block → `friendsKeys.all`. Decline → `friendsKeys.requests`. Unblock → `friendsKeys.blocked`.

### pairingKeys (usePairings.ts)

| Sub-key | Shape |
|---------|-------|
| `prefix` | `['pairings']` |
| `all(userId)` | `['pairings', userId]` |
| `pills(userId)` | `['pairings', 'pills', userId]` |
| `incomingRequests(userId)` | `['pairings', 'incoming', userId]` |

### notificationKeys (useNotifications.ts)

| Sub-key | Shape |
|---------|-------|
| `all(userId)` | `['notifications', userId]` |
| `unreadCount(userId)` | `['notifications', 'unread', userId]` |

### venueOrderMetricsKeys (useVenueOrderMetrics.ts)

| Sub-key | Shape |
|---------|-------|
| `all` | `['venue-order-metrics']` |
| `detail(brandId, venueId)` | `['venue-order-metrics', brandId, venueId]` |

**Invalidation rule:** venue-order reads and completeness consumers share the exact `detail` key; broad venue-order refreshes use `venueOrderMetricsKeys.all`.

### phoneLookupKeys (usePhoneLookup.ts)

| Sub-key | Shape |
|---------|-------|
| `all` | `['phone-lookup']` |
| `lookup(phone)` | `['phone-lookup', phone]` |

### eventTicketCheckoutAccessKeys (useEventTicketCheckoutAccess.ts) — issue #2101

| Sub-key | Shape |
|---------|-------|
| `all` | `['eventTicketCheckoutAccess']` |
| `event(eventId)` | `['eventTicketCheckoutAccess', eventId]` |
| `business(eventId)` | `['eventTicketCheckoutAccess', eventId, 'business']` |
| `eligibility(eventId)` | `['eventTicketCheckoutAccess', eventId, 'eligibility']` |
| `eligibilityFor(eventId, authScope)` | `['eventTicketCheckoutAccess', eventId, 'eligibility', authScope]` |

**Auth scoping (load-bearing, not cosmetic).** Checkout eligibility is a
per-identity fact, so `authScope` is the signed-in `user.id` or the literal
`'anon'`. Without it one viewer's checkout decision would be served from cache
to another. **No token ever enters a key** — only the opaque user UUID.

**Invalidation rule:** every successful Business mutation (add self, add
username, remove, set mode) invalidates `business(eventId)` AND invalidates
**and refetches** the FULL `eligibility(eventId)` subtree, so a buyer preview
can never keep a decision the policy just superseded. A sign-in, sign-out or
user change **cancels and removes** the previous `eligibility(eventId)` subtree
before the new scoped key fetches.

**Freshness:** `staleTime: 0` + `refetchOnMount: 'always'` on the public
eligibility query — a stale allow is the one thing this feature cannot ship.
The consuming `loading` flag is bound to "no data yet for the current auth
scope", never to `isFetching`, so a background refetch does not re-disable a
resolved CTA (`docs/INVARIANT_REGISTRY.md:6537` bug class).

### ticketQuoteKeys (useTicketQuote.ts) — issue #3872

| Sub-key | Shape |
|---------|-------|
| `all` | `['ticket-checkout-quote']` |
| `detail(input)` | Prefix plus event, surface, link, lines, dates, plan, party, code and buyer-limit identity |

**Persistence:** none. Quotes are checkout-lifetime server snapshots and stay
only in React Query memory. Any money-affecting input creates a distinct key.

### venueReservationPreview (GuestVenueReservation / VenueReserveSheet) — issue #3872

| Key | Shape |
|-----|-------|
| preview | `['venueReservationPreview', venueId, slotUtc, partySize, buyer identity fields, discountCode]` |

**Persistence:** none. The web and native reservation surfaces keep the
server-authored deposit preview only in React Query memory. The create request
sends that preview's digest; a 409 replaces the displayed preview and requires
one more explicit confirmation.

### discountKeys (discountService.ts) — issue #3872

| Sub-key | Shape |
|---------|-------|
| `all` | `['brand-discounts']` |
| `access(brandId)` | `['brand-discounts', 'access', brandId]` |
| `list(brandId, filter)` | `['brand-discounts', 'list', brandId, filter]` |
| `prices(brandId)` | `['brand-discounts', 'prices', brandId]` |
| `preview(brandId, draft)` | `['brand-discounts', 'preview', brandId, JSON.stringify(draft)]` |
| `report(brandId, from, to)` | `['brand-discounts', 'report', brandId, from, to]` |
| `orderLines(kind, orderId)` | `['brand-discounts', 'order-lines', kind, orderId]` |

**Invalidation rule:** every successful Host discount or Allow-discounts write
invalidates `discountKeys.all`. The preview includes the entire draft because
every rule in it can change server eligibility or price; no buyer identity,
code attempt or token is persisted outside React Query memory.

### refundPreviewKeys (useRefundPreview.ts) — issue #3872

| Sub-key | Shape |
|---------|-------|
| `preview(orderId, linesKey)` | `['refund-preview', orderId, JSON.stringify(lines)]` |

**Freshness:** `staleTime: 0`, no retries and a 250 ms debounce. A refund
confirmation is disabled while the server preview is pending or unavailable;
the client never estimates a discounted refund amount.

### brandFormKeys (hooks/brandFormKeys.ts) — issue #4514

The Explorer app has its own `brandFormKeys` in `app-mobile/src/hooks/queryKeys.ts` (#4541): `rsvpForm(eventId \| null)` is `['brand-forms', 'rsvp-form', eventId ?? 'none']` and `myPending(userId \| null)` is `['brand-forms', 'my-pending', userId ?? 'none']`.

| Sub-key | Shape |
|---------|-------|
| `all` | `['brand-forms']` |
| `list(brandId)` | `['brand-forms', 'list', brandId]` |
| `detail(formId)` | `['brand-forms', 'detail', formId]` |
| `eventAttachment(eventId)` | `['brand-forms', 'event-attachment', eventId]` |
| `responses(formId, eventId \| null, filter)` | `['brand-forms', 'responses', formId, eventId ?? 'all', filter]` (#4541 R4.7/R4.8: `filter` folds the owner filter and the hidden toggle as `` `${filter}:${owner}:${showHidden ? 1 : 0}` `` through `responsesFilterKey`, owner `all`, `known` or `unknown`) |
| `tile(eventId)` | `['brand-forms', 'tile', eventId]` |
| `counts(brandId)` | `['brand-forms', 'counts', brandId]` (wave 3: answered and to-answer per form and per page) |
| `publicRsvpFormKeys.forEvent(eventId)` (src/components/checkout/intake/publicRsvpFormKeys.ts) | `['brand-forms', 'public-rsvp', eventId]` (#4541: the questions on the public RSVP page, or its "After they RSVP" notice, read through brand-form-submit `page_form`; a leaf module so the eager public page does not import this factory; refetched when the RSVP is refused with a form code) |
| `rosterAnswers(eventId)` | `['brand-forms', 'roster-answers', eventId]` (wave 3: the guest list's answers chip and drawer for one page) |
| `requestPreview(formId, eventId, kind, audience, channels, subjects)` | `['brand-forms', 'request-preview', formId, eventId, kind, audience, channels, subjects]` (wave 4: reach and cost before Ask guests to answer / Remind; `staleTime: 0`; channels and subjects are sorted, joined ids, never contacts or tokens) |
| `requestLog(formId, eventId, subject)` | `['brand-forms', 'request-log', formId, eventId, subject]` (wave 4 review: the host delivery log, sends and failures per guest and the automatic reminder runs; `subject` is `all` or `kind:id`; never contacts or tokens) |
| `checkoutFormKeys.forEvent(eventId, withTicketLink)` (src/components/checkout/intake/checkoutFormKeys.ts) | `['brand-forms', 'checkout', eventId, 'link' \| 'plain']` (wave 5: the page's form as the buyer checkout reads it through brand-form-submit `checkout_form`, with the buyer's checkout credential; `staleTime: 30s`; refetched when checkout-create refuses with a form code, and by the step's Try again) |
| `doorReads(eventId)` | `['brand-forms', 'door-reads', eventId]` (#4541 R8.3: who opened full answers at the door on one page, Responses › Door, event manager and up; names and times only) |
| `guestAnswers(eventId, subjectKind, subjectId)` | `['brand-forms', 'guest-answers', eventId, subjectKind, subjectId]` (#4541 R1.9: one guest's or order's answers on guest detail and order detail; `subjectKind` is `rsvp`, `rsvp_guest` or `order`) |
| `blastPicker(brandId)` | `['brand-forms', 'blast-picker', brandId]` (#4541 R4.2: the brand's forms the Blast composer's "+ Form" picker and block read (`useBlastFormPicker`, the list read); live ones can be picked, closed and draft ones say why not; keyed by brand) |
| `idle(read)` | `['brand-forms', read, 'none']` (a read switched off because its id is missing; never fetched) |

**Scoping:** the list is keyed by BRAND, so switching brand never serves another
brand's forms. No token or answer text enters a key; answers live only in
React Query memory (never persisted).

**Invalidation rule:** every successful form write (create, save draft,
publish, close, reopen, archive, door switch, the #4541 invited-door-staff switch, the #4541 R4.8 hide or unhide of an Unknown Blast reply, attach, detach, and in wave 4 a form request send and the automatic reminder switch) invalidates
`brandFormKeys.all`, which refreshes the list, the builder, the page's
attachment, the Responses page and the manage-page tile together.

**Freshness:** the builder's detail read is `staleTime: 0` and refetches on
mount, so a stale draft revision is caught by the server (PT409,
"Someone else changed this form. Reload.") rather than by the cache.

### brandPaystackKeys (useBrandPaystack.ts) — issue #2418

| Sub-key | Shape |
|---------|-------|
| `all` | `['brand-paystack']` |
| `banks()` | `['brand-paystack', 'banks', 'NG', 'NGN', 'nuban']` |
| `status(brandId)` | `['brand-paystack', 'status', brandId]` |

**Catalogue dimensions:** `banks()` is the one fixed Paystack settlement-bank
catalogue for country `NG`, currency `NGN`, and type `nuban`. It is not scoped
to a brand or user and never contains a token, email, account number, or other
credential.

**Readiness and freshness:** the catalogue query is enabled only after root
auth readiness and any caller-provided enablement are both true. Valid data has
`staleTime: 1 hour` and `gcTime: 2 hours`; errors never become data. Logout's
existing global React Query clear remains the cache/privacy boundary.

**Refresh rule:** there is no mutation invalidation. Manual `refetch()`,
reconnect, staleness, and mount behavior own refresh. Valid cached rows stay
visible while a background refresh is pending or fails.

---

---

## Standalone Keys (no factory yet)

| Key | Used by | Consolidation plan |
|-----|---------|-------------------|
| `['conversations']` | ConnectionsPage chat list | Create factory when messaging domain is hardened |
| `['calendarEntries', userId]` | CalendarTab | Create factory when calendar domain is hardened |
| `['userPreferences', userId]` | useUserPreferences | Create factory when preference domain grows |
| `['deck-cards', ...]` | useDeckCards (14-part key) | Complex — document but don't consolidate yet |
| `['curated-experiences', ...]` | useCuratedExperiences | Create factory when curated domain is hardened |
