declare const module: any;
declare const process: any;
declare const require: any;

// META-ORCH-0929 T-ADV-4 — Tester-owned adversarial regression test.
//
// Attacks locale-key drift: as new locales are added or `social.json` is edited
// over time, the 17 META-ORCH-0929 keys must remain present in EVERY locale.
// This test enumerates every locale directory under
// `app-mobile/src/i18n/locales/` and asserts that each `social.json`
// contains all 17 keys with a non-empty string value. A missing or empty key
// would cause the UI to render the raw i18n key path (e.g.
// "social:friendsActionChooserTitle") to users on that locale — visible
// regression for non-English users.
//
// This is the only one of the 4 META adversarial tests that touches the filesystem
// rather than a pure state-machine simulation. It runs from the repo root so the
// relative path resolves whether invoked from `app-mobile/` or the workspace root.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_KEYS: ReadonlyArray<string> = [
  "friendsActionChooserTitle",
  "friendsActionChooserCreateGroupChat",
  "friendsActionChooserAddFriend",
  "friendsActionChooserPlusButtonA11y",
  "friendsActionChooserCreateDisabledPaywall",
  "createGroupChatSheetTitle",
  "createGroupChatNamePlaceholder",
  "createGroupChatFriendsLabel",
  "createGroupChatSubmit",
  "startSwipingCta",
  "collabDeckSheetTitle",
  "pendingInviteAccept",
  "pendingInviteDecline",
  "pendingInviteRowSubtitle",
  "leaveSessionMenuItem",
  "leaveSessionConfirmTitle",
  "leaveSessionConfirmBody",
];

function resolveLocalesRoot(): string {
  const candidates = [
    "app-mobile/src/i18n/locales",
    "src/i18n/locales",
    "../app-mobile/src/i18n/locales",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "Could not find locales root from cwd=" +
      process.cwd() +
      " — tried: " +
      candidates.join(", ")
  );
}

function run() {
  const root = resolveLocalesRoot();
  const langs: string[] = fs
    .readdirSync(root)
    .filter((d: string) =>
      fs.statSync(path.join(root, d)).isDirectory()
    )
    .sort();

  assert.ok(
    langs.length >= 28,
    `Expected >=28 locales; found ${langs.length} in ${root}`
  );

  const issues: Array<{ lang: string; missing: string[]; empty: string[] }> = [];

  for (const lang of langs) {
    const p = path.join(root, lang, "social.json");
    if (!fs.existsSync(p)) continue; // skip locales without social.json
    const raw = fs.readFileSync(p, "utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in ${p}: ${(err as Error).message}`);
    }

    const missing: string[] = [];
    const empty: string[] = [];
    for (const key of REQUIRED_KEYS) {
      if (!(key in parsed)) {
        missing.push(key);
      } else {
        const v = parsed[key];
        if (typeof v !== "string" || v.length === 0) {
          empty.push(key);
        }
      }
    }
    if (missing.length || empty.length) {
      issues.push({ lang, missing, empty });
    }
  }

  if (issues.length > 0) {
    const detail = issues
      .map(
        (i) =>
          `  ${i.lang}: missing=${i.missing.length} empty=${i.empty.length} -> ${i.missing
            .concat(i.empty.map((k) => `${k}(empty)`))
            .slice(0, 3)
            .join(",")}…`
      )
      .join("\n");
    assert.fail(
      `META-0929 locale completeness FAILED in ${issues.length} locale(s):\n${detail}`
    );
  }

  console.log(
    `PASS T-ADV-4 META-0929 locale completeness: all ${REQUIRED_KEYS.length} keys present + non-empty across ${langs.length} locales`
  );
}

run();
