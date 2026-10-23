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

const FOLLOWER_KEYS: ReadonlyArray<string> = [
  "first",
  "count_zero",
  "count_one",
  "count_two",
  "count_few",
  "count_many",
  "count_other",
  "a11y_none",
  "a11y_exact_zero",
  "a11y_exact_one",
  "a11y_exact_two",
  "a11y_exact_few",
  "a11y_exact_many",
  "a11y_exact_other",
  "a11y_approx",
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

  const issues: Array<{ lang: string; file: string; missing: string[]; empty: string[] }> = [];

  for (const lang of langs) {
    for (const [file, keys] of [
      ["social.json", REQUIRED_KEYS],
      ["followers.json", FOLLOWER_KEYS],
    ] as const) {
      const p = path.join(root, lang, file);
      if (!fs.existsSync(p)) {
        issues.push({ lang, file, missing: [...keys], empty: [] });
        continue;
      }
      const raw = fs.readFileSync(p, "utf8");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid JSON in ${p}: ${(err as Error).message}`);
      }

      const missing: string[] = [];
      const empty: string[] = [];
      for (const key of keys) {
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
        issues.push({ lang, file, missing, empty });
      }
    }
  }

  if (issues.length > 0) {
    const detail = issues
      .map(
        (i) =>
          `  ${i.lang}/${i.file}: missing=${i.missing.length} empty=${i.empty.length} -> ${i.missing
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
    `PASS T-ADV-4 META-0929 locale completeness: social (${REQUIRED_KEYS.length}) + followers (${FOLLOWER_KEYS.length}) present + non-empty across ${langs.length} locales`
  );
}

run();
