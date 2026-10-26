// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 — tapping a plan opens its card. Seth: "upcoming plans should be
// clickable and show the expanded card for details."
//
//   * Header strip: the plan (date tile and name) opens the NEXT upcoming
//     plan's card; "+N more" is its own 44pt target that opens the Plans
//     sheet; "Last plan" (all past) opens that plan's card.
//   * Thread: the locked-in plan card message and the older "Plan locked in" /
//     "Scheduled for" rows open the same card, with an a11y label.
//   * One ExpandedCardModal: the Plans sheet's, shared through
//     useCollabPlanCard, with the sheet's exact collaboration props.
//   * Works for group collabs and 1:1 collab DMs (both use collabSessionId).
//
// FAILS-ON-REVERT: send the strip's plan tap back to onStripPress("plans"),
// drop the "+N more" button, show the first row instead of the first upcoming
// one, drop the plan route from handleCardBubbleTap / handleBubblePress /
// MessageBubble's system row, or give MessageInterface its own plan modal, and
// this suite fails.

import {
  buildCollabHeaderStrip,
  planSavedCardIdFromPayload,
  planStripTap,
  resolvePlanCard,
} from "../chatHeaderModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}
const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const plan = (id: string, offsetDays: number) => ({
  savedCardId: id,
  cardData: { title: `Plan ${id}` },
  scheduledAt: new Date(NOW + offsetDays * DAY).toISOString(),
});
const strip = (plans) =>
  buildCollabHeaderStrip({
    actionIds: ["plans"],
    matches: [],
    matchesLoading: false,
    plans,
    plansLoading: false,
    seenMatchIds: new Set(),
    now: NOW,
    untitled: "A plan",
  });

Deno.test("strip plan tap opens the NEXT upcoming plan's card; +N more opens the sheet", () => {
  const model = strip([plan("past", -2), plan("later", 5), plan("next", 1), plan("latest", 9)]);
  assert(model.plan, "plan cell present");
  assertEquals(model.plan.savedCardId, "next", "the cell carries the soonest upcoming plan");
  assertEquals(planStripTap(model.plan, "plan"), { kind: "card", savedCardId: "next" }, "plan tap opens that card");
  assertEquals(model.plan.moreCount, 2, "+2 more");
  assertEquals(planStripTap(model.plan, "more"), { kind: "sheet" }, "+N more opens the Plans sheet");
});

Deno.test("Last plan (all past) opens that plan's card", () => {
  const model = strip([plan("old", -9), plan("recent", -1)]);
  assertEquals(model.plan?.state, "past", "all past");
  assertEquals(planStripTap(model.plan, "plan"), { kind: "card", savedCardId: "recent" }, "most recent past plan's card");
});

Deno.test("ChatHeader: the plan and +N more are separate targets wired to the card and the sheet", async () => {
  const header = stripComments(await read("../ChatHeader.tsx"));
  const cell = header.slice(header.indexOf("{strip.plan ? (() => {"), header.indexOf("})() : null}", header.indexOf("{strip.plan ? (() => {")));
  assert(cell.length > 200, "plan cell found");
  assert(/const tap = planStripTap\(plan, part\);/.test(cell), "the cell decides through planStripTap");
  assert(/if \(tap\.kind === "card" && onPlanPress\) onPlanPress\(tap\.savedCardId\);/.test(cell), "the plan opens its card");
  assert(/onPress=\{\(\) => handlePlanPart\("plan"\)\}[\s\S]*?testID="chat-header-plan"/.test(cell), "date tile and name are the plan target");
  assert(/onPress=\{\(\) => handlePlanPart\("more"\)\}[\s\S]*?testID="chat-header-plan-more"/.test(cell), "+N more has its own target");
  assert(!/onPress=\{\(\) => onStripPress\?\.\("plans"\)\}/.test(cell), "the plan no longer only opens the sheet");
  assert(/planMore: \{\s*minWidth: 44,/.test(header), "+N more is at least 44pt wide");
  assert(/PLAN_MORE_HIT_SLOP = \{ top: 2, bottom: 2/.test(header) && /strip: 40,/.test(await read("../chatHeaderModel.ts")), "40pt strip + 2+2 slop = 44pt tall");

  const chat = stripComments(await read("../../MessageInterface.tsx"));
  assert(/onPlanPress=\{handleCollabPlanPress\}/.test(chat), "MessageInterface wires the plan tap");
  assert(/const handleCollabPlanPress = \(savedCardId: string\) => \{[\s\S]*?openCollabPlanCard\(savedCardId\)/.test(chat), "the plan tap opens the plan card");
});

Deno.test("thread plan rows resolve to their saved card and open the card", async () => {
  assertEquals(planSavedCardIdFromPayload({ lockInEvent: "card_locked_and_scheduled", savedCardId: "sc1", title: "Terra" }), "sc1", "lock-in card message");
  assertEquals(planSavedCardIdFromPayload({ event: "plan_scheduled", saved_card_id: "sc2" }), "sc2", "older Scheduled for row");
  assertEquals(planSavedCardIdFromPayload({ event: "card_locked", saved_card_id: "sc3" }), "sc3", "older Plan locked in row");
  assertEquals(planSavedCardIdFromPayload({ title: "shared card", savedCardId: "x" }), null, "a plain shared card is not a plan");
  assertEquals(planSavedCardIdFromPayload({ kind: "collab_dead_end" }), null, "other system rows are not plans");
  const rows = [plan("sc1", 1)];
  assertEquals(resolvePlanCard(rows, "sc1", { title: "payload" }), { savedCardId: "sc1", cardData: { title: "Plan sc1" } }, "the Plans row wins");
  assertEquals(resolvePlanCard([], "sc1", { title: "payload" }), { savedCardId: "sc1", cardData: { title: "payload" } }, "payload fallback");
  assertEquals(resolvePlanCard([], "sc9"), null, "nothing to open");

  const chat = stripComments(await read("../../MessageInterface.tsx"));
  const cardTap = chat.slice(chat.indexOf("const handleCardBubbleTap = useCallback("), chat.indexOf("setExpandedCardFromChat(cardPayloadToExpandedCardData(payload));\n    setShowExpandedCardFromChat(true);\n  }"));
  assert(/const planCardId = planSavedCardIdFromPayload\(payload\);\s*if \(planCardId && openCollabPlanCardRef\.current\(planCardId, payload/.test(cardTap), "a locked-in card message opens the plan card");
  const bubblePress = chat.slice(chat.indexOf("const handleBubblePress = useCallback("), chat.indexOf("const handleBubbleLongPress"));
  assert(/planSavedCardIdFromPayload\(message\.cardPayload\);\s*if \(planCardId && openCollabPlanCardRef\.current\(planCardId\)\) return;/.test(bubblePress), "an older plan text row opens the plan card");
  const systemBranch = chat.slice(chat.indexOf("if (item.message.isSystem) {"), chat.indexOf("            return (\n            <>"));
  assert(/isCollabChat \? planSavedCardIdFromPayload\(item\.message\.cardPayload\)/.test(systemBranch) && /onPlanRowPress=\{systemPlanCardId \?/.test(systemBranch), "a plan system row opens the plan card");
  assert(/const openCollabPlanCard = useCallback\([\s\S]*?if \(!isCollabChat \|\| !collabSessionId\) return false;[\s\S]*?resolvePlanCard\(scheduledCardsQuery\.rows/.test(chat), "group and 1:1 collabs both resolve through collabSessionId");

  const bubble = stripComments(await read("../MessageBubble.tsx"));
  const sys = bubble.slice(bubble.indexOf("if (message.isSystem) {"), bubble.indexOf("  const borderRadius = BORDER_RADIUS"));
  assert(/if \(onPlanRowPress\) \{[\s\S]*?onPress=\{onPlanRowPress\}[\s\S]*?accessibilityLabel=\{t\('chat:a11yOpenPlanRow'/.test(sys), "the plan system row is a labelled button");
  assert(/accessibilityLabel=\{lockedAt\s*\? t\('chat:a11yOpenPlan'/.test(bubble), "the locked-in card is labelled as a plan");
  const curated = await read("../PlaceCuratedChatCard.tsx");
  assert(/accessibilityRole="button" accessibilityLabel=\{accessibilityLabel \?\? title\}/.test(curated), "the card bubble is a labelled button");
  const en = JSON.parse(await read("../../../i18n/locales/en/chat.json"));
  assert(en.a11yOpenPlan?.includes("{{title}}") && en.a11yOpenPlanRow?.includes("{{text}}"), "a11y strings exist");
});

Deno.test("one ExpandedCardModal serves the sheet, the strip and the thread", async () => {
  const banners = stripComments(await read("../CollabSessionChatBanners.tsx"));
  const hook = banners.slice(banners.indexOf("export function useCollabPlanCard()"), banners.indexOf("export function ScheduleSheet("));
  assert(/setModalTarget\(expansionTargetFromSavedPayload\(\{\s*\.\.\.item\.cardData,\s*sourceScope: 'collaboration',\s*sourceRecordId: item\.savedCardId,\s*savedCardId: item\.savedCardId,/.test(hook), "the sheet's exact payload");
  const sheet = banners.slice(banners.indexOf("export function ScheduleSheet("), banners.indexOf("export function SavedToSessionCardsSheet("));
  assert(/const \{ modalTarget, setModalTarget, openPlan \} = planCard;/.test(sheet), "the sheet uses the shared state");
  assert(!/useState<ExpansionTarget/.test(sheet), "the sheet has no private plan state");
  assert(/onPress=\{\(\) => openPlan\(item\)\}/.test(sheet), "sheet rows open through openPlan");
  assertEquals((sheet.match(/<ExpandedCardModal\b/g) ?? []).length, 1, "one modal in the sheet");
  assert(/if \(dismissOwnerSheet\) onClose\(\);/.test(sheet) && /shareProducerSurface="collab_locked_expanded"/.test(sheet), "#1672/#3281 dismiss and Share unchanged");

  const chat = stripComments(await read("../../MessageInterface.tsx"));
  assertEquals((chat.match(/<ExpandedCardModal\b/g) ?? []).length, 1, "MessageInterface keeps only its shared-card modal");
  assert(/const collabPlanCard = useCollabPlanCard\(\);/.test(chat) && /planCard=\{collabPlanCard\}/.test(chat), "the chat hands its plan state to the sheet");
});
