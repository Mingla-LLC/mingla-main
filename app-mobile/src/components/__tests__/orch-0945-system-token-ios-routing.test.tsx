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

function sliceBetween(source, startNeedle, endNeedle, label) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `${label} start must exist`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `${label} end must exist`);
  return source.slice(start, end);
}

function runOrch0945SystemTokenIosRoutingTest() {
  const messageInterface = readSource("src/components/MessageInterface.tsx");
  const messageBubble = readSource("src/components/chat/MessageBubble.tsx");

  // [FAILS-ON-REVERT KEY] ORCH-0945-LF-2: iOS was tapping the combined system row
  // instead of a separate token target while normal chat gesture wrappers surrounded it.
  const systemRenderBranch = sliceBetween(
    messageInterface,
    "if (item.message.isSystem) {",
    "            return (\n            <>",
    "MessageInterface system render branch",
  );
  assert.match(systemRenderBranch, /<MessageBubble/, "system rows must still render through MessageBubble");
  assert.match(
    systemRenderBranch,
    /onSystemTokenPress=\{handleSystemTokenPress\}/,
    "system rows must wire ORCH-0945 tokens to MessageInterface routing",
  );
  assert.doesNotMatch(
    systemRenderBranch,
    /<SwipeableMessage|<DoubleTapHeart|<TouchableOpacity/,
    "system rows must bypass normal chat gesture wrappers so iOS token taps reach the link target",
  );

  const systemBubbleBranch = sliceBetween(
    messageBubble,
    "if (message.isSystem) {",
    "  const borderRadius = BORDER_RADIUS",
    "MessageBubble system branch",
  );
  assert.match(
    systemBubbleBranch,
    /<View style=\{chatSystemRowStyles\.row\} accessible=\{false\}>/,
    "system banner row must not collapse children into one iOS accessibility/touch target",
  );
  assert.doesNotMatch(
    systemBubbleBranch,
    /accessibilityRole="text"|accessibilityLabel=\{`System message:/,
    "system banner row must leave the link as the accessible element",
  );

  const tokenLinkBranch = sliceBetween(
    messageBubble,
    "const label = getSystemTokenLabel(token);",
    "        );",
    "MessageBubble token link branch",
  );
  assert.match(
    tokenLinkBranch,
    /onPress=\{\(\) => onSystemTokenPress\?\.\(token\)\}/,
    "token link must invoke the routing callback on press",
  );
  assert.match(tokenLinkBranch, /accessibilityRole="link"/, "token link must remain exposed as a link");
  assert.match(
    tokenLinkBranch,
    /testID=\{`collab-system-token-\$\{token\.type\}`\}/,
    "token link must expose a stable ORCH-0945 test target",
  );
  assert.match(tokenLinkBranch, /hitSlop=\{\{ top: 8, bottom: 8, left: 8, right: 8 \}\}/, "token link must have a finger-friendly hit area");

  const routingHandler = sliceBetween(
    messageInterface,
    "const handleSystemTokenPress = useCallback((token: CollabSystemToken) => {",
    "  const mentionPopoverParticipants",
    "MessageInterface token routing handler",
  );
  assert.match(
    routingHandler,
    /viewParticipantId:\s*token\.userId === currentUserId \? undefined : token\.userId/,
    "open-prefs token must route self to editable prefs and other participants to read-only prefs",
  );
  assert.match(
    routingHandler,
    /initialFocusSection:\s*token\.section/,
    "open-prefs token must preserve section focus for travel/location/categories/dates",
  );
}

if (require.main === module) {
  try {
    runOrch0945SystemTokenIosRoutingTest();
    console.log("PASS ORCH-0945-LF-2 iOS-compatible system token routing regression");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
