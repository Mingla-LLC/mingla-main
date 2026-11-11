// Issue #3355 rework 3 — what Gemini Flash (the production model,
// temperature 0, ARI_CLAIM_CHECK_SCHEMA) returned for the claim check on
// these replies, recorded 2026-11-11 from a live call on the local stack
// (~/.mingla-private/3355/rework3/live_claims_1/2/3.json; run 2 wins where both ran). Tests feed these back
// as the model's answer so the server's matching and replacement run on the
// real model's output, deterministically. Unknown replies throw: the caller's
// fallback path runs, never an invented claim list.

import type { AriClaimModelCall } from "../ariClaimCheck.ts";

export const RECORDED_FLASH_CLAIMS: Readonly<Record<string, unknown>> = Object
  .freeze({
    "Your discount is **live**.": {
      "claims": [
        {
          "quote": "Your discount is **live**.",
          "action": "live",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "Your event is now `published`.": {
      "claims": [
        {
          "quote": "Your event is now `published`.",
          "action": "published",
          "object": null,
          "kind": "event",
        },
      ],
    },
    "**Done!** Your discount is set.": {
      "claims": [
        {
          "quote": "**Done!** Your discount is set.",
          "action": "created",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    'Your code is "active" from today.': {
      "claims": [
        {
          "quote": 'Your code is "active" from today.',
          "action": "live",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "All set ✅ your guests can use the code at checkout.": {
      "claims": [
        {
          "quote": "All set ✅ your guests can use the code at checkout.",
          "action": "completed",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "It's up and running.": {
      "claims": [
        {
          "quote": "It's up and running.",
          "action": "completed",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "Your discount is good to go.": {
      "claims": [
        {
          "quote": "Your discount is good to go.",
          "action": "completed",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "Guests have been notified.": {
      "claims": [
        {
          "quote": "Guests have been notified.",
          "action": "notified",
          "object": "Guests",
          "kind": "other",
        },
      ],
    },
    "I've shared it with your team.": {
      "claims": [
        {
          "quote": "I've shared it with your team.",
          "action": "shared",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "Everything went through.": {
      "claims": [
        {
          "quote": "Everything went through.",
          "action": "completed",
          "object": null,
          "kind": "other",
        },
      ],
    },
    "I don do am. Your discount don dey work.": {
      "claims": [
        {
          "quote": "I don do am.",
          "action": "created",
          "object": null,
          "kind": "discount",
        },
        {
          "quote": "Your discount don dey work.",
          "action": "live",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "J'ai créé le code pour vous.": {
      "claims": [
        {
          "quote": "J'ai créé le code pour vous.",
          "action": "created",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "Since I've created FAVY10 would you like me to share it?": {
      "claims": [
        {
          "quote": "Since I've created FAVY10 would you like me to share it?",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "Want me to share the code, which is now live?": {
      "claims": [
        {
          "quote": "Want me to share the code, which is now live?",
          "action": "live",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "- Create the code ✅\n- Send it to guests ✅": {
      "claims": [
        {
          "quote": "- Create the code ✅",
          "action": "created",
          "object": null,
          "kind": "discount",
        },
        {
          "quote": "- Send it to guests ✅",
          "action": "sent",
          "object": null,
          "kind": "discount",
        },
      ],
    },
    "✅ Code\n✅ Email to guests": {
      "claims": [
        {
          "quote": "✅ Code",
          "action": "created",
          "object": null,
          "kind": "discount",
        },
        {
          "quote": "✅ Email to guests",
          "action": "sent",
          "object": "guests",
          "kind": "message",
        },
      ],
    },
    "FAVY10 has been used 12 times and brought in ₦48,000 in sales.": {
      "claims": [],
    },
    "Yes, FAVY10 is active. It ends on Sat 19 Dec 2026 at 11:59 pm Lagos time.":
      {
        "claims": [],
      },
    "Once published, your event shows on Explore and people can buy tickets.": {
      "claims": [],
    },
    "Payouts are sent to your bank 3 working days after the event ends.": {
      "claims": [],
    },
    "Refunds you approve are sent back to the buyer's card within 5–10 working days.":
      {
        "claims": [],
      },
    "No. Drafts stay private until you publish them. Tap Publish on the event page when you're ready.":
      {
        "claims": [],
      },
    "Open Marketing, tap Discounts, then tap Create code. Choose the percent or amount and the dates, then tap Save.":
      {
        "claims": [],
      },
    "Got it, I've saved that: doors open at 7pm for every event.": {
      "claims": [
        {
          "quote":
            "Got it, I've saved that: doors open at 7pm for every event.",
          "action": "saved",
          "object": "doors open at 7pm for every event",
          "kind": "note",
        },
      ],
    },
    "Your request has been sent to the team. They usually reply within a day.":
      {
        "claims": [
          {
            "quote": "Your request has been sent to the team.",
            "action": "sent",
            "object": "request",
            "kind": "support",
          },
        ],
      },
    "I've sent your reply on the payout request.": {
      "claims": [
        {
          "quote": "I've sent your reply on the payout request.",
          "action": "sent",
          "object": null,
          "kind": "payout",
        },
      ],
    },
    "Here's FAVY10 ready to create. Tap Confirm to save it.": {
      "claims": [],
    },
    "I can create FAVY10 for 10% off until 19 December. Want me to prepare the card?":
      {
        "claims": [],
      },
    "Your discount code FAVY10 has been created and is live.": {
      "claims": [
        {
          "quote": "Your discount code FAVY10 has been created and is live.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
        {
          "quote": "Your discount code FAVY10 has been created and is live.",
          "action": "live",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "The code was sent to your guests.": {
      "claims": [
        {
          "quote": "The code was sent to your guests.",
          "action": "sent",
          "object": "code",
          "kind": "discount",
        },
      ],
    },
    "Your event is now live.": {
      "claims": [
        {
          "quote": "Your event is now live.",
          "action": "live",
          "object": null,
          "kind": "event",
        },
      ],
    },
    "FAVY10 has now been saved.": {
      "claims": [
        {
          "quote": "FAVY10 has now been saved.",
          "action": "saved",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I couldn't find the old code, so I created FAVY10 for you.": {
      "claims": [
        {
          "quote": "I couldn't find the old code, so I created FAVY10 for you.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "No problem, I've created FAVY10 for you.": {
      "claims": [
        {
          "quote": "No problem, I've created FAVY10 for you.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I haven't created FAVY10 yet.": {
      "claims": [],
    },
    "Have I created FAVY10?": {
      "claims": [],
    },
    "Yes, I created FFBTSCOM10 for you.": {
      "claims": [
        {
          "quote": "Yes, I created FFBTSCOM10 for you.",
          "action": "created",
          "object": "FFBTSCOM10",
          "kind": "discount",
        },
      ],
    },
    "I proposed FFBTSCOM10 for 10% off. Approve it below.": {
      "claims": [
        {
          "quote": "I proposed FFBTSCOM10 for 10% off.",
          "action": "proposed",
          "object": "FFBTSCOM10",
          "kind": "discount",
        },
      ],
    },
    "I proposed GIRLSTRIPLAGOS in the previous step.": {
      "claims": [
        {
          "quote": "I proposed GIRLSTRIPLAGOS in the previous step.",
          "action": "proposed",
          "object": "GIRLSTRIPLAGOS",
          "kind": "discount",
        },
      ],
    },
    "I've published your event.": {
      "claims": [
        {
          "quote": "I've published your event.",
          "action": "published",
          "object": null,
          "kind": "event",
        },
      ],
    },
    "Your discount code FAVY10 has been created.": {
      "claims": [
        {
          "quote": "Your discount code FAVY10 has been created.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I created GIRLS20 for you.": {
      "claims": [
        {
          "quote": "I created GIRLS20 for you.",
          "action": "created",
          "object": "GIRLS20",
          "kind": "discount",
        },
      ],
    },
    "I proposed creating the discount code FFBTSCOM10 for 10% off. You can approve it below.":
      {
        "claims": [
          {
            "quote":
              "I proposed creating the discount code FFBTSCOM10 for 10% off.",
            "action": "proposed",
            "object": "FFBTSCOM10",
            "kind": "discount",
          },
        ],
      },
    "I've created FAVY10 — it's live for 10% off.": {
      "claims": [
        {
          "quote": "I've created FAVY10 — it's live for 10% off.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "Discount codes give buyers money off at checkout. Open Events, pick your event, then tap Discounts.":
      {
        "claims": [],
      },
    "I've created GIRLSTRIPLAGOS for you. It is 10% off.": {
      "claims": [
        {
          "quote": "I've created GIRLSTRIPLAGOS for you.",
          "action": "created",
          "object": "GIRLSTRIPLAGOS",
          "kind": "discount",
        },
      ],
    },
    "We have just published your event.": {
      "claims": [
        {
          "quote": "We have just published your event.",
          "action": "published",
          "object": "event",
          "kind": "event",
        },
      ],
    },
    "I created FAVY10 for you.": {
      "claims": [
        {
          "quote": "I created FAVY10 for you.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I proposed FAVY10 for you to approve.": {
      "claims": [
        {
          "quote": "I proposed FAVY10 for you to approve.",
          "action": "proposed",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "FAVY10 has been created.": {
      "claims": [
        {
          "quote": "FAVY10 has been created.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I proposed FAVY10.": {
      "claims": [
        {
          "quote": "I proposed FAVY10.",
          "action": "proposed",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I published your event.": {
      "claims": [
        {
          "quote": "I published your event.",
          "action": "published",
          "object": null,
          "kind": "event",
        },
      ],
    },
    "I proposed creating the discount code FFBTSCOM10 for you.": {
      "claims": [
        {
          "quote": "I proposed creating the discount code FFBTSCOM10 for you.",
          "action": "proposed",
          "object": "FFBTSCOM10",
          "kind": "discount",
        },
      ],
    },
    "FAVY10 is saved and live. I've also emailed your guests about it.": {
      "claims": [
        {
          "quote": "FAVY10 is saved and live.",
          "action": "saved",
          "object": "FAVY10",
          "kind": "discount",
        },
        {
          "quote": "FAVY10 is saved and live.",
          "action": "live",
          "object": "FAVY10",
          "kind": "discount",
        },
        {
          "quote": "I've also emailed your guests about it.",
          "action": "notified",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "Discount created: FAVY10 is live for 10% off until Sat 19 Dec 2026. Want me to share it with your guests?":
      {
        "claims": [
          {
            "quote":
              "Discount created: FAVY10 is live for 10% off until Sat 19 Dec 2026.",
            "action": "created",
            "object": "FAVY10",
            "kind": "discount",
          },
        ],
      },
    "I've saved that note: doors always open at 7pm for every event.": {
      "claims": [
        {
          "quote":
            "I've saved that note: doors always open at 7pm for every event.",
          "action": "saved",
          "object": "doors always open at 7pm for every event",
          "kind": "note",
        },
      ],
    },
    "Ask me and I'll try again.\n\nFAVY11 couldn't be saved, so nothing changed. Ask me and I'll try again.":
      {
        "claims": [],
      },
    "I created FAVY10, but I haven't published the event.": {
      "claims": [
        {
          "quote": "I created FAVY10, but I haven't published the event.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "I created FAVY10 — you can't miss it on the Discounts page.": {
      "claims": [
        {
          "quote":
            "I created FAVY10 — you can't miss it on the Discounts page.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "Once again, I created FAVY10.": {
      "claims": [
        {
          "quote": "Once again, I created FAVY10.",
          "action": "created",
          "object": "FAVY10",
          "kind": "discount",
        },
      ],
    },
    "The code FAVY10 was not created.": {
      "claims": [],
    },
    "If you approve, FAVY10 will be created.": {
      "claims": [],
    },
  });

/** The reply a claim-check request carries. */
export function replyOfRequest(
  request: Parameters<AriClaimModelCall>[0],
): string {
  const part = request.contents[0]?.parts[1]?.text ?? "";
  const match = part.match(/^REPLY:\n<user_data>\n([\s\S]*)\n<\/user_data>$/);
  return match ? match[1] : "";
}

/** The recorded model: Flash's own answer for a known reply. */
export const recordedClaimCall: AriClaimModelCall = (request) => {
  const reply = replyOfRequest(request);
  if (!Object.prototype.hasOwnProperty.call(RECORDED_FLASH_CLAIMS, reply)) {
    return Promise.reject(new Error(`no recorded claim check for: ${reply}`));
  }
  return Promise.resolve(RECORDED_FLASH_CLAIMS[reply]);
};
