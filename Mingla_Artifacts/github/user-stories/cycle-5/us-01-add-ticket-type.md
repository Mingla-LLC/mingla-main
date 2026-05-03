**As an** organiser
**I need** to add a new ticket type with the right combination of access controls (free or paid, capped or unlimited, with or without approval, password, waitlist, transferability)
**So that** I can sell different access levels and rules to my audience under one event without forcing a single rigid "type" choice.

### Details and Assumptions
* Ticket modifiers are **layered booleans**, not a single enum (per Cycle 5 forensics Q-1/Q-2 — a ticket can be Approval+Password+Waitlist simultaneously).
* The sheet exposes each modifier as its own toggle/picker — there is **no segmented "type" picker**. This matches the established Cycle 3 pattern (`isFree`, `isUnlimited` toggles) and avoids data-model conflicts that a 1-of-N picker would create.
* The 13 PRD §4.2 "ticket types" emerge naturally from modifier combinations (e.g. "Free ticket" = `isFree=true`; "Approval-required" = `approvalRequired=true`; etc.).
* Cycle 5 ships MVP-tier modifiers only: free + unlimited (existing) + visibility + approvalRequired + passwordProtected + waitlistEnabled + min/max purchase qty + allowTransfers. Other PRD §4.1 fields (sale window, validity window, ticket description, online/in-person availability, info tooltips, collapsible sections) deferred to **Cycle 5b**.
* Backend (real Stripe gating, real waitlist invites, real approval notifications) lands B2/B4/B5.

### Acceptance Criteria

```gherkin
Given I am editing an event draft on Step 5 (Tickets)
When I tap "+ Add ticket type"
Then the ticket sheet opens with sections in order: Name → Free/Price → Unlimited/Capacity → Visibility → Approval/Password/Waitlist toggles → Min/Max per buyer → Allow transfers

Given the ticket sheet is open
When I enter a name "GA", leave Free OFF, enter price "25", leave Unlimited OFF, enter capacity "200" and tap Save
Then the new ticket appears in the Step 5 list with name + £25 + 200 capacity, and the draft persists across re-open

Given the ticket sheet is open
When I toggle "Approval required" ON
Then the helper copy "Buyers will request access. You approve or reject before they pay." appears under the toggle, and on save the ticket has `approvalRequired: true`

Given the ticket sheet is open
When I toggle "Password protected" ON
Then a password input field appears with min-4-character validation, and on save the ticket has `passwordProtected: true` + `password: "<typed>"` (hashing wires up B4)

Given the ticket sheet is open
When I toggle "Enable waitlist" ON while "Unlimited capacity" is also ON
Then a red helper "Unlimited tickets don't need a waitlist — turn one off." appears and Save is blocked

Given the ticket sheet is open
When I toggle "Enable waitlist" ON with capacity bounded
Then on save the ticket has `waitlistEnabled: true` and Step 7 mini-card shows "+ Waitlist" badge

Given a ticket combines multiple modifiers (e.g. Approval + Password)
When I view the ticket card on Step 5
Then both badges render in the badges row below the price line, and the cardSub line includes "approval · password"
```
