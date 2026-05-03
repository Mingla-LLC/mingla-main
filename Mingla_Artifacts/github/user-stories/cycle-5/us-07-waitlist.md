**As an** organiser
**I need** to enable a waitlist on a ticket type so when capacity is reached buyers can join the waitlist instead of seeing "sold out"
**So that** I can recover lost demand if cancellations open slots, and gauge organic interest.

### Details and Assumptions
* `waitlist_enabled: true` flag on the ticket type.
* Buyer waitlist-join flow lives on the public event page (Cycle 6).
* Organiser waitlist invite-from-queue flow lives in Cycle 10 (Guests) + B5 (real email invites).
* Cycle 5 only ships the toggle + helper copy + Preview indication.

### Acceptance Criteria

```gherkin
Given I'm editing a ticket type
When I toggle "Enable waitlist" ON
Then the sheet shows a helper "When this ticket sells out, buyers can join a waitlist. You'll be able to invite from the waitlist when slots open." and saves `waitlist_enabled: true`

Given a ticket has waitlist_enabled = true and capacity is set to 100
When I view Step 7 mini-card preview
Then the ticket card shows a small "+ Waitlist" suffix next to the capacity number

Given a ticket has waitlist_enabled = true with isUnlimited toggled ON
When I try to save
Then a validation error "Unlimited capacity tickets don't need a waitlist — toggle one off" prevents save

Given a ticket has waitlist_enabled = true with isFree = true and capacity = 50
When I view PreviewEventView (public preview)
Then the buyer-facing rendering shows "Free · 50 spots · Waitlist when full"
```
