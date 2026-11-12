// #3355 rework 10 (the two gaps rework 9's demo left open):
//   1  unsaved memory presented as saved: a memory-label line
//      ("Preference: …", "Fact: …", "Correction: …") that files the host's
//      new fact, or a keep-for-later promise ("noted for your brand",
//      "added to what I know", "I'll keep in mind…", "I'll use that next
//      time"), with no memory save this turn, is corrected like rework 9's
//      fix 1 (and the loop asks the model once). Reading back notes, quoting
//      the host, a plain "Got it" and explaining the memory feature stay.
//   2  screen paths in any case: "go to settings > scanners", "open manage
//      → scanners", "head to hub, then scanners" are read like capitalised
//      paths, and each step must follow the one before it in the App Map or
//      a Feature Guide how_to step. Real paths in any case, numbers, URLs,
//      code and prose with "then" are untouched.
// The judge is stubbed.

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
  correctMemoryClaimWithoutSave,
  MEMORY_NOT_SAVED_SENTENCE,
  memoryClaimWithoutSave,
  replyClaimsMemorySave,
} from "../ariClaimCheck.ts";
import {
  ARI_UNKNOWN_PATH_SENTENCE,
  guardReplyNavigation,
  navigationPathsIn,
} from "../ariAppMap.ts";
import APP_MAP from "../generated/ariAppMap.json" with { type: "json" };

const JUDGES: Array<readonly AriClaim[] | "fail"> = [
  [{
    quote: "Preference:",
    action: "saved",
    kind: "note",
    object: null,
  } as AriClaim],
  [],
  "fail",
];

async function check(a: {
  host: string;
  reply: string;
  judge: readonly AriClaim[] | "fail";
  observations?: ClaimObservation[];
  memoryNotes?: string[];
}): Promise<string> {
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
    recentWrite: false,
    objects: [],
    evidence: buildClaimEvidence({
      states: [],
      observations: a.observations ?? [],
      isReadTool: (tool) => /^(?:list|get|search)_/.test(tool),
    }),
    askedWriteThisTurn: false,
    ...(a.memoryNotes ? { memoryNotes: a.memoryNotes } : {}),
    call: () =>
      a.judge === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: a.judge }),
  });
  return out.text;
}

// ── Gap 1: unsaved memory presented as saved ───────────────────────────────

const DRINK_HOST =
  "Remember that we always give a free welcome drink to the first 20 guests at our brunches.";
const DRINK_DEMO = [
  "Here's your brand snapshot:",
  "- Events: 2 (Jollof & Jazz Night, Suya Sunday Brunch)",
  "- Preference: Free welcome drink for first 20 guests at brunches.",
  "",
  "Anything else you'd like to set up?",
].join("\n");

Deno.test("#3355 R10-1 the demo's 'Preference: …' line with no save is corrected in every judge state", async () => {
  for (const judge of JUDGES) {
    const text = await check({ host: DRINK_HOST, reply: DRINK_DEMO, judge });
    assertMatch(text, /I haven't saved that yet — want me to remember it\?/);
    assertNotMatch(text, /Preference:/);
    assertMatch(text, /Events: 2/);
    assertMatch(text, /Anything else you'd like to set up\?/);
  }
});

Deno.test("#3355 R10-1 a successful remember_note this turn keeps the label line", async () => {
  const text = await check({
    host: DRINK_HOST,
    reply: DRINK_DEMO,
    judge: "fail",
    observations: [{
      tool: "remember_note",
      args: { scope: "brand", kind: "preference", text: "Welcome drink" },
      result: { id: "n1" },
    }],
  });
  assertEquals(text, DRINK_DEMO);
});

/** [host message, Ari's reply]: each presents an unsaved fact as kept. */
const MEMORY_POSITIVES: ReadonlyArray<readonly [string, string]> = [
  [DRINK_HOST, "Preference: Free welcome drink for first 20 guests."],
  [
    "Our brunch tables seat 6 people each.",
    "- **Fact:** Brunch tables seat 6 people each.",
  ],
  [
    "Remember prices are in naira, not dollars.",
    "Correction: prices are in naira, not dollars.",
  ],
  ["Remember that we never sell at the door.", "Brand fact — no door sales."],
  ["We always open doors at 6pm.", "Got it, I'll use that next time."],
  ["Doors always open at 6pm for us.", "Noted for your brand."],
  [
    "Our brunches are always on Sundays.",
    "Added to what I know about Yaba Street Eats.",
  ],
  [
    "Brunch tables seat 6.",
    "I'll keep in mind that brunch tables seat 6.",
  ],
  [
    "Fridays work best for us.",
    "Going forward, I'll suggest Fridays for your events.",
  ],
  [
    "We always give a welcome drink.",
    "Next time you plan a brunch, I'll include the welcome drink.",
  ],
  ["Our DJ is always Kaycee.", "That's now part of what I know."],
  ["Our DJ is always Kaycee.", "Great, I'll apply that going forward."],
  ["Doors open at 6pm.", "I'll keep it on file."],
];

Deno.test("#3355 R10-1 positives: label lines and keep-for-later promises are corrected", () => {
  for (const [host, reply] of MEMORY_POSITIVES) {
    assert(replyClaimsMemorySave(reply, host), reply);
    const out = correctMemoryClaimWithoutSave({
      text: reply,
      hostMessage: host,
      evidence: [],
    });
    assertEquals(out.text, MEMORY_NOT_SAVED_SENTENCE, reply);
    assertEquals(
      memoryClaimWithoutSave({
        text: reply,
        hostMessage: host,
        observations: [],
      })
        ?.code,
      "MEMORY_SAVE_REQUIRED",
      reply,
    );
  }
});

/** [host message, Ari's reply]: never a memory claim. */
const MEMORY_NEGATIVES: ReadonlyArray<readonly [string, string]> = [
  // Ordinary "Got it" with no persistence promise.
  ["We always open doors at 6pm.", "Got it."],
  ["We always open doors at 6pm.", "Got it — let's set up the event."],
  ["Make the code 10% off.", "Got it, here's the draft card."],
  // Quoting what the host said.
  [
    DRINK_HOST,
    'You said: "we always give a free welcome drink to the first 20 guests".',
  ],
  [
    DRINK_HOST,
    'Fact: "we always give a free welcome drink to the first 20 guests" (your words).',
  ],
  [DRINK_HOST, "> Remember that we always give a free welcome drink."],
  [
    "We always open doors at 6pm.",
    'You wrote "I\'ll use that next time" in your last message.',
  ],
  // Explaining what the memory feature does.
  [
    "How does your memory work?",
    "When you ask me to remember something, I save it as a note and use it next time.",
  ],
  [
    "Can you remember things?",
    "I can remember preferences, facts and corrections for your brand.",
  ],
  [
    "How does your memory work?",
    "For example: Preference: no events on Sundays.",
  ],
  [
    "How does your memory work?",
    "You can ask me to keep a preference, and I'll use it going forward.",
  ],
  // Not memory at all.
  ["Tickets close at 6pm.", "Note: tickets close at 6pm on the day."],
  ["When is my event?", "Fact: your event is on 5 December."],
  ["Send the reminder.", "I'll send the reminder tomorrow."],
  ["Where are scanners?", "Next time, tap Scanners on the event page."],
  [DRINK_HOST, "Want me to remember that for next time?"],
];

Deno.test("#3355 R10-1 the live demo's 'I'll keep that in memory' with no save is corrected", async () => {
  // The final text of the rework 10 live local-model turn mem2_3; the brand's
  // ari_memory_notes had no new row after it.
  const host = "For future events, we always end by 11pm. Got it?";
  const live =
    "Got it. All future events will end by 11 p.m. Lagos time. I’ll keep that in memory.";
  for (const judge of JUDGES) {
    assertEquals(
      await check({ host, reply: live, judge }),
      `Got it. All future events will end by 11 p.m. Lagos time. ${MEMORY_NOT_SAVED_SENTENCE}`,
    );
  }
  assertEquals(
    memoryClaimWithoutSave({ text: live, hostMessage: host, observations: [] })
      ?.code,
    "MEMORY_SAVE_REQUIRED",
  );
});

Deno.test("#3355 R10-1 must-keep: reading back, quoting, plain 'Got it', explaining memory", () => {
  for (const [host, reply] of MEMORY_NEGATIVES) {
    assert(!replyClaimsMemorySave(reply, host), reply);
    assertEquals(
      correctMemoryClaimWithoutSave({
        text: reply,
        hostMessage: host,
        evidence: [],
      }).text,
      reply,
      reply,
    );
  }
});

Deno.test("#3355 R10-1 reading back notes from a memory read this turn is never corrected", async () => {
  const listed: ClaimObservation = {
    tool: "list_memory_notes",
    args: {},
    result: {
      notes: [{
        id: "n1",
        content: "Free welcome drink for first 20 guests at brunches.",
      }],
    },
  };
  const reply =
    "You already have this note:\nPreference: Free welcome drink for first 20 guests at brunches.";
  for (const judge of JUDGES) {
    const text = await check({
      host: DRINK_HOST,
      reply,
      judge,
      observations: [listed],
    });
    assertEquals(text, reply);
  }
  // The loop does not bounce a read-back either.
  assertEquals(
    memoryClaimWithoutSave({
      text: reply,
      hostMessage: DRINK_HOST,
      observations: [listed],
    }),
    null,
  );
  // A note the host already has (read with their login) backs it too.
  assertEquals(
    await check({
      host: DRINK_HOST,
      reply,
      judge: "fail",
      memoryNotes: ["Free welcome drink for first 20 guests at brunches."],
    }),
    reply,
  );
  // A memory read that returned a different note does not back a new fact.
  const other = await check({
    host: DRINK_HOST,
    reply: "Preference: Free welcome drink for first 20 guests at brunches.",
    judge: "fail",
    observations: [{
      tool: "list_memory_notes",
      args: {},
      result: { notes: [{ id: "n2", content: "Prices are in naira." }] },
    }],
  });
  assertEquals(other, MEMORY_NOT_SAVED_SENTENCE);
});

Deno.test("#3355 R10-1 the live demo's 'This will be applied to all upcoming events' is a promise only after a host rule with no other write", async () => {
  const host = "For future events, we always end by 11pm. Got it?";
  // The final text the live local-model turn returned (rework 10 demo, mem_3).
  const live =
    "I haven't saved that as a note yet. This will be applied to all upcoming events, including \"Jollof & Jazz Night\" and any new ones. Is there anything else you'd like to do with your brand or offerings?";
  for (const judge of JUDGES) {
    const text = await check({ host, reply: live, judge });
    assertEquals(
      text,
      `${MEMORY_NOT_SAVED_SENTENCE} Is there anything else you'd like to do with your brand or offerings?`,
    );
  }
  assertEquals(
    memoryClaimWithoutSave({ text: live, hostMessage: host, observations: [] })
      ?.code,
    "MEMORY_SAVE_REQUIRED",
  );
  // A real settings write this turn can say the same words: kept.
  const card = "Done. It will be applied to all upcoming events.";
  const written: ClaimObservation = {
    tool: "update_pricing_defaults",
    args: { vat_mode: "buyer_pays" },
    result: { ok: true },
  };
  assertEquals(
    correctMemoryClaimWithoutSave({
      text: card,
      hostMessage: "Buyers always pay VAT, for all future events.",
      evidence: buildClaimEvidence({ states: [], observations: [written] }),
    }).text,
    card,
  );
  assertEquals(
    memoryClaimWithoutSave({
      text: card,
      hostMessage: "Buyers always pay VAT, for all future events.",
      observations: [written],
    }),
    null,
  );
  // No lasting rule in the host's words: not a memory promise.
  assert(
    !replyClaimsMemorySave(
      "It will be applied to all upcoming events.",
      "Add a 10% code for Jollof & Jazz Night.",
    ),
  );
});

// ── Gap 2: screen paths in any case ─────────────────────────────────────────

/** Invented paths (lowercase, mixed and capitalised): the pointer replaces them. */
const PATH_POSITIVES: readonly string[] = [
  "go to settings > scanners",
  "open manage → scanners",
  "head to hub, then scanners",
  "go to settings/scanners",
  "go to settings -> scanners to add your co-host.",
  "Go to Settings > Scanners.",
  "open the manage tab, then scanners",
  'go to hub, then "Scanners"',
  "navigate to hub › door",
  // The rework 10 live demo's reply (path_1): a line that opens with ">".
  "> scanners > invite scanner > send invitation",
  // One invented named screen (the rework 10 live demo's path2_3 wording).
  'Then, on the event\'s Manage screen, tap "Scanners" and invite staff via email.',
  "Go to the Manage tab.",
  // The rework 10 live demo's path3_1 wording ("via" / "under").
  "You can find it under the event's Manage screen.",
];

Deno.test("#3355 R10-2 positives: invented paths in any case become the honest pointer", () => {
  for (const text of PATH_POSITIVES) {
    assertEquals(
      guardReplyNavigation(text).text,
      ARI_UNKNOWN_PATH_SENTENCE,
      text,
    );
  }
  const listed = [
    "To add a co-host who scans tickets:",
    "1. Open Suya Sunday Brunch in the app.",
    "2. go to settings > scanners and tap add.",
    "3. enter their email.",
    "",
    "Anything else?",
  ].join("\n");
  const out = guardReplyNavigation(listed).text;
  assertNotMatch(out, /settings > scanners/);
  assertNotMatch(out, /enter their email/);
  assertMatch(out, /^1\. Open Suya Sunday Brunch/m);
  assertMatch(out, /Anything else\?$/);
});

/** Real paths in any case, and text that is not a path at all. */
const PATH_NEGATIVES: readonly string[] = [
  // Lowercase versions of real App Map / Feature Guide paths.
  "open hub > venues",
  "go to hub > events",
  "open hub -> venues and pick the venue",
  "open account > notifications",
  "go to marketing → campaigns",
  "open marketing/campaigns",
  "go to account → your brand → payments & bank",
  "open account, then help & support, then the support tab",
  'open the brand (account > "your brands") and tap "team & permissions".',
  "tap guests then +",
  "open the event, then tap scanners",
  "in hub > events, pick one",
  "go to event > scanners",
  // Numbers and comparisons.
  "5 > 3",
  "if the price > 1000 it shows a warning.",
  "open 2 > 1 tickets",
  // URLs and code.
  "see https://usemingla.com/host > settings",
  "go to usemingla.com/host/settings",
  "run `open settings > scanners` in the console",
  "go to src/app/home",
  // The rework 10 live demo's real lowercase path (path_2).
  "go to account > your brand > payments & bank > connect bank",
  "> hub > events",
  // One real named screen, and prose that names a section.
  "Open the Guests tab.",
  "On the Home screen, tap +.",
  'Go to the "Payments" screen.',
  "In the Lagos section of the page, add the address.",
  "From the Home screen, tap +.",
  "> Remember that we always give a free welcome drink.",
  // Prose with "then" (not navigation).
  "open the doors, then greet the guests",
  "we can go to lagos then abuja",
  "choose a date, then tell me the price",
  "open and/or close the doors",
  "quality > quantity",
];

Deno.test("#3355 R10-2 must-keep: real paths in any case, numbers, URLs, code and prose", () => {
  for (const text of PATH_NEGATIVES) {
    assertEquals(guardReplyNavigation(text).text, text, text);
  }
  // A chat object between real screens stays real in lowercase too.
  assertEquals(
    navigationPathsIn("go to events > suya sunday brunch > scanners", [
      "Suya Sunday Brunch",
    ]).every((item) => item.known),
    true,
  );
});

Deno.test("#3355 R10-2 every Feature Guide how_to, as written and lowercased, passes unchanged", () => {
  const howTos = Object.values(
    (APP_MAP as { guide_how_to: Record<string, string> }).guide_how_to,
  );
  assert(howTos.length > 40);
  for (const howTo of howTos) {
    for (const text of [howTo, howTo.toLowerCase()]) {
      assertEquals(guardReplyNavigation(text).text, text.trim(), text);
    }
  }
});
