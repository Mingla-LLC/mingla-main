**As an** organiser
**I need** to add a new ticket type to my event with a specific category (general / early-bird / VIP / approval-required / password-protected / waitlist / etc.)
**So that** I can sell different access levels and price tiers to my audience under one event.

### Details and Assumptions
* Ticket types live on the DraftEvent's `tickets` array (Cycle 3 schema).
* Each ticket has all 27 fields from PRD §4.1 (price, capacity, sale window, validity window, min/max purchase qty, etc.).
* Cycle 3 supported only `name + isFree + isUnlimited + priceGbp + capacity` — Cycle 5 expands the sheet to capture the full field set.
* The ticket-type category (general / early-bird / VIP / approval / password / waitlist / etc.) determines which fields are visible/required.
* Backend (real Stripe gating, real waitlist behavior) lands B2/B4 — this cycle is UI + draft persistence only.

### Acceptance Criteria

```gherkin
Given I am editing an event draft on Step 5 (Tickets)
When I tap "+ Add ticket type"
Then the ticket sheet opens with a "Type" segmented control at the top showing General / Early-bird / VIP / Approval / Password / Waitlist / Other

Given the ticket sheet is open with type "General" selected
When I enter a name "GA", price "£25", capacity "200" and tap Save
Then the new ticket appears in the Step 5 list with name + price + capacity, and the draft persists across re-open

Given the ticket sheet is open
When I select type "Approval"
Then the sheet shows an additional helper line "Buyers will be queued for organiser approval" and saves an `approval_required: true` flag on the ticket

Given the ticket sheet is open
When I select type "Password"
Then a password input field appears, validates min 4 characters, and saves locally on the ticket (hashing wires up B4)

Given the ticket sheet is open
When I select type "Waitlist" with capacity 0 (or with isUnlimited toggled off and capacity reached)
Then the ticket saves with `waitlist_enabled: true` and Step 7 mini-card shows "+ Waitlist" indicator
```
