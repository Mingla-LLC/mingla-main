**As an** organiser
**I need** to set ticket visibility (public / hidden / disabled) per ticket type
**So that** I can run pre-sales (hidden tickets revealed to subscribers only) and disable tickets that are no longer valid without deleting them.

### Details and Assumptions
* `visibility: 'public' | 'hidden' | 'disabled'` per ticket. Default 'public'.
* "Hidden" = not shown on public event page; only buyers with a direct link see it (link includes a token).
* "Disabled" = visible on public page but greyed out + unselectable + helper "Sales paused".
* Order's `display_order` still applies regardless of visibility.

### Acceptance Criteria

```gherkin
Given I'm editing a ticket type
When I tap the visibility row
Then a Sheet opens with 3 segments: Public / Hidden / Disabled, with descriptions of each

Given a ticket has visibility "Hidden"
When I view Step 7 mini-card preview
Then the ticket appears with a small "Hidden — direct link only" badge

Given a ticket has visibility "Disabled"
When I view Step 7 mini-card preview
Then the ticket appears greyed out with "Sales paused" label

Given a ticket has visibility "Public"
When I view Step 7 mini-card preview
Then the ticket renders in the standard public style
```
