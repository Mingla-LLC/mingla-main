// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4430 display items on Explorer: one timeline line per action (item 2), the
// posting deadline read once (item 4), the upload reason with no fixed gap
// (item 3), words for every ended state (item 8), split money states (item 5)
// and plain-English zone labels (never a "Region/City" slug).
//
// FAILS-ON-REVERT: dropping dedupeGigEvents from the timeline, the
// postDeadlineShown step in contractCardLabel, the new nextActionFor cases or
// the new money lines fails here.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  contractCardLabel,
  contractMoneyLine,
  formatInZone,
  postDeadlineText,
  uploadDueReason,
} from "../programFormat.ts";
import {
  dedupeGigEvents,
  GIG_EVENT_PAIRS,
  nextActionFor,
} from "../../components/creator/contract/contractWords.ts";

const NOW = new Date("2026-12-01T12:00:00Z");
const root = new URL("../../../../", import.meta.url);
const IANA =
  /\b(Africa|America|Europe|Asia|Australia|Pacific|Atlantic|Indian|Etc)\/[A-Za-z_]+/;

/** No rendered time label may carry a zone slug or any "/" (Seth: no slugs). */
function assertPlainZone(text: string): void {
  assert(!text.includes("/"), `slash in "${text}"`);
  assert(!IANA.test(text), `zone slug in "${text}"`);
}

const PRODUCTION_PAIRS: Array<[string, string]> = [
  ["plan_confirmed", "shoot_plan_confirmed"],
  ["send_script", "script_sent"],
  ["deliver", "delivery_submitted"],
  ["approve", "approved"],
  ["request_fix", "fix_requested"],
  ["open_dispute", "dispute_opened"],
  ["submit_posts", "posts_submitted"],
];

Deno.test("#4430 item 2: each production action/fact pair shows once", () => {
  assertEquals(
    Object.entries(GIG_EVENT_PAIRS).sort(),
    [...PRODUCTION_PAIRS].sort(),
  );
  for (const [action, fact] of PRODUCTION_PAIRS) {
    const events = [
      {
        id: "1",
        kind: action,
        actor: "creator",
        at: "2026-12-01T10:00:00.000Z",
        data: {},
      },
      {
        id: "2",
        kind: fact,
        actor: "creator",
        at: "2026-12-01T10:00:01.200Z",
        data: {},
      },
    ];
    assertEquals(dedupeGigEvents(events).map((e) => e.kind), [fact], action);
    // A different actor, or more than 5 s apart, is a different step: both stay.
    assertEquals(
      dedupeGigEvents([events[0], { ...events[1], actor: "host" }]).length,
      2,
    );
    assertEquals(
      dedupeGigEvents([events[0], {
        ...events[1],
        at: "2026-12-01T10:00:09.000Z",
      }]).length,
      2,
    );
  }
});

Deno.test("#4430 item 2: the pair map is the same on Explorer, Host and Admin", () => {
  const pairsIn = (path: string, name: string): Array<[string, string]> => {
    const text = Deno.readTextFileSync(new URL(path, root));
    const start = text.indexOf(name);
    assert(start >= 0, `${name} in ${path}`);
    const body = text.slice(text.indexOf("{", start), text.indexOf("}", start));
    return [...body.matchAll(/([a-z_]+):\s*["']([a-z_]+)["']/g)].map((m) =>
      [m[1], m[2]] as [string, string]
    ).sort();
  };
  const explorer = Object.entries(GIG_EVENT_PAIRS).sort();
  // Every surface's timeline goes through it.
  assert(
    Deno.readTextFileSync(
      new URL(
        "app-mobile/src/components/creator/contract/ContractSections.tsx",
        root,
      ),
    ).includes("dedupeGigEvents(events)"),
  );
  assert(
    Deno.readTextFileSync(
      new URL("mingla-business/src/components/programs/contractCopy.ts", root),
    ).includes("[...dedupeGigEvents(events)].reverse()"),
  );
  assertEquals(
    pairsIn(
      "mingla-business/src/components/programs/contractCopy.ts",
      "GIG_EVENT_PAIRS",
    ),
    explorer,
  );
  assertEquals(
    pairsIn("mingla-admin/src/lib/creatorPrograms.js", "GIG_EVENT_PAIRS"),
    explorer,
  );
});

Deno.test("#4430 item 4: the card header reads the posting deadline's last minute", () => {
  // 23:00Z is midnight in Lagos; the deadline people read is 11:59 PM Dec 16.
  const label = contractCardLabel(
    "approved",
    "2026-12-16T23:00:00Z",
    NOW,
    undefined,
    "Africa/Lagos",
  );
  assert(label.includes("Dec 16"), label);
  assertEquals(
    contractCardLabel(
      "posts_failed",
      "2026-12-16T23:00:00Z",
      NOW,
      undefined,
      "Africa/Lagos",
    ),
    label,
  );
  assert(
    postDeadlineText("2026-12-16T23:00:00Z", "Africa/Lagos", NOW).startsWith(
      "Wed Dec 16, 11:59 PM",
    ),
  );
  // Other states keep their raw deadline.
  assert(
    contractCardLabel(
      "script_locked",
      "2026-12-16T23:00:00Z",
      NOW,
      undefined,
      "Africa/Lagos",
    ).includes("Dec 17"),
  );
});

Deno.test("#4430 item 3: the upload reason never claims a fixed gap", () => {
  for (
    const [due, postBy] of [["2026-12-13T22:59:00Z", "2026-12-15"], [
      "2026-12-14T10:00:00Z",
      "2026-12-15",
    ], ["2026-12-11T10:00:00Z", "2026-12-15"]]
  ) {
    const text =
      uploadDueReason({ videoDueAt: due, postBy }, "Africa/Lagos", NOW) ?? "";
    assert(!/two days/i.test(text), text);
    assert(
      text.startsWith("Upload by ") &&
        text.endsWith("so the host has time to review before you post."),
      text,
    );
    assert(text.includes("Lagos time"), text);
    assertPlainZone(text);
  }
});

Deno.test("#4430 item 8: every ended state has words, never In progress", () => {
  const partial = nextActionFor("resolved_partial", {
    creatorFee: "₦90",
    refund: "₦117.50",
  });
  assertEquals(partial, {
    title: "Dispute settled",
    text: "You get ₦90; ₦117.50 went back to the host.",
    cta: null,
  });
  assertEquals(nextActionFor("resolved_release").text, "You get the full fee.");
  assertEquals(
    nextActionFor("resolved_refund").text,
    "The host was refunded in full.",
  );
  assertEquals(
    nextActionFor("cancelled", {
      cancelReason: "host_after_accept_before_lock",
      creatorFee: "₦37.50",
    }).text,
    "You keep ₦37.50 for the work so far.",
  );
  assertEquals(
    nextActionFor("cancelled", { cancelReason: "upload_missed" }).text,
    "The video wasn’t uploaded by the deadline, so the host was refunded.",
  );
  for (
    const state of [
      "resolved_release",
      "resolved_partial",
      "resolved_refund",
      "cancelled",
      "declined",
      "expired",
    ]
  ) {
    assert(nextActionFor(state).title !== "In progress", state);
  }
});

Deno.test("#4430 item 5: split endings have their own money line", () => {
  assertEquals(
    contractMoneyLine("cancelled_partial"),
    "The host cancelled; you keep part of the fee",
  );
  assertEquals(
    contractMoneyLine("dispute_partial"),
    "The dispute was settled; you keep part of the fee",
  );
});

Deno.test("#4430: every rendered time label names the zone in plain English", () => {
  for (
    const zone of [
      "Africa/Lagos",
      "America/New_York",
      "America/Argentina/Buenos_Aires",
      "Europe/London",
      "UTC",
    ]
  ) {
    const text = formatInZone("2026-12-15T11:00:00Z", zone, NOW);
    assertPlainZone(text);
    assertPlainZone(postDeadlineText("2026-12-16T23:00:00Z", zone, NOW));
  }
  assertEquals(
    formatInZone("2026-12-15T11:00:00Z", "Africa/Lagos", NOW),
    "Tue Dec 15, 12:00 PM Lagos time",
  );
  assertEquals(
    formatInZone("2026-12-15T11:00:00Z", "America/Argentina/Buenos_Aires", NOW),
    "Tue Dec 15, 8:00 AM Buenos Aires time",
  );
});
