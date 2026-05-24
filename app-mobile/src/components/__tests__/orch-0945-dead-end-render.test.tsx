// @ts-nocheck
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

function getDeadEndHelper(source) {
  const start = source.indexOf("const getCollabDeadEndCopy = useCallback(() => {");
  const end = source.indexOf("  const handleSaveDismissedCard", start);
  assert.notEqual(start, -1, "SwipeableCards must define getCollabDeadEndCopy");
  assert.notEqual(end, -1, "SwipeableCards dead-end helper block must be bounded before dismissed-card save");
  return source.slice(start, end);
}

function runOrch0945DeadEndRenderTest() {
  const source = readSource("src/components/SwipeableCards.tsx");
  const chatBubble = readSource("src/components/chat/MessageBubble.tsx");
  const prefsSheet = readSource("src/components/PreferencesSheet.tsx");
  const helper = getDeadEndHelper(source);

  // [FAILS-ON-REVERT KEY] T-01: old generic intersection copy did not name the outlier or render travel diagnostics.
  assert.match(helper, /case 'intersection_empty'/, "T-01 intersection_empty must have its own render branch");
  assert.match(helper, /is too far from the group/, "T-01 single-outlier title must name who is too far");
  assert.match(helper, /formatTravelDiagnostic/, "T-01 diagnostic must include per-participant travel details");

  assert.match(helper, /No location overlap yet/, "T-02 multi-outlier branch must render no-overlap copy");
  assert.match(helper, /formatLocationLabel/, "T-02 multi-outlier branch must include per-name location labels");

  // [FAILS-ON-REVERT KEY] T-03: old no_matching_candidates copy could not name GPS-pending participants.
  assert.match(helper, /case 'no_matching_candidates'/, "T-03 no_matching_candidates must have its own render branch");
  assert.match(helper, /Waiting for \$\{pendingNames\} to share location/, "T-03 GPS-gap title must name pending participants");

  assert.match(helper, /Pick some categories/, "T-04 no-category variant must prompt category selection");
  assert.match(helper, /Nobody has picked categories or intents yet/, "T-04 no-category diagnostic must be explicit");

  assert.match(helper, /case 'no_unswiped_candidates'/, "T-05 no_unswiped_candidates must have its own render branch");
  assert.match(source, /Review dismissed/, "T-05 Review dismissed CTA must be preserved for collab exhaustion");

  assert.match(helper, /case 'quorum_not_met'/, "T-06 quorum_not_met must have its own render branch");
  assert.match(helper, /Pending: \$\{nameList\(pendingAcceptIds\)\}/, "T-06 quorum branch must list pending names");

  assert.match(helper, /case 'all_pools_exhausted'/, "T-07 all_pools_exhausted must have its own render branch");
  assert.match(helper, /Try a wider date window\?/, "T-07 all-pools branch must suggest dates");

  assert.match(source, /Notify the group/, "T-01..T-07 collab dead-end must include the Notify the group CTA");
  assert.doesNotMatch(helper, /You are too far apart/, "old two-branch generic collab copy must not remain in the helper");

  assert.match(chatBubble, /parseCollabSystemToken/, "T-A03 chat MessageBubble must parse collab system tokens");
  assert.match(chatBubble, /command === 'open-prefs'/, "T-A03 chat parser must support open-prefs tokens");
  assert.match(chatBubble, /command === 'open-dismissed'/, "T-A03 chat parser must support open-dismissed tokens");
  assert.match(chatBubble, /command === 'compose-mention'/, "T-A03 chat parser must support compose-mention tokens");
  assert.match(chatBubble, /accessibilityRole="link"/, "T-A03 token segments must render as accessible links");
  assert.match(chatBubble, /if \(!token\)/, "T-A04 malformed tokens must fall back to visible literal text");

  const applyStart = prefsSheet.indexOf("const handleApplyPreferences = useCallback(async () => {");
  const applyEnd = prefsSheet.indexOf("  }, [", applyStart);
  const applyBlock = prefsSheet.slice(applyStart, applyEnd);
  assert.match(prefsSheet, /viewParticipantId\?: string/, "T-A01 PreferencesSheet must expose viewParticipantId prop");
  assert.match(prefsSheet, /initialFocusSection\?: PreferencesSheetFocusSection/, "T-A01 PreferencesSheet must expose initialFocusSection prop");
  assert.match(prefsSheet, /const isEditable = !viewParticipantId/, "T-A01 read-only mode must be controlled by one isEditable guard");
  assert.match(prefsSheet, /'s picks \(read-only\)/, "T-A01 read-only header must name the viewed participant");
  assert.match(applyBlock, /if \(!isEditable\) return;/, "T-A02 save/apply must short-circuit in read-only mode");
  assert.match(prefsSheet, /\{isEditable && \(/, "T-A01 read-only mode must hide the apply/reset footer");
  assert.match(prefsSheet, /scrollRef\.current\?\.scrollTo\?/, "T-A01 initialFocusSection must scroll to the focused section");
}

if (require.main === module) {
  try {
    runOrch0945DeadEndRenderTest();
    console.log("PASS T-01..T-07 + T-A01..T-A04 ORCH-0945 collab dead-end render, token parsing, read-only prefs");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
