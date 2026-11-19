#!/usr/bin/env node
// Issue #4453 — the Host app's Website wiring for the three-style preview,
// the style library and "Add a page with Ari".
//
// MINGLA-INVARIANT: I-PROPOSED-4453-SITES-HOST-WIRING | issue #4453 | With SITES_PLAN_PREVIEW, SITES_STYLE_LIBRARY and SITES_ARI_ADD_PAGE off the Host app's Website setup and Pages section render as before; only "Start the build" writes from the preview chooser; both look pickers read lookPickerKeys (never DESIGN_KEYS); the proposed-page card acts only through the owner's content actions; the dev harnesses redirect in a release build and read no auth.
//
// WHY A GATE. These rules are about which branch, call or import a file uses,
// so they can only be checked by reading source. They used to live in three
// Jest files as readFileSync pins, which I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN
// forbids. The behavioural halves stay in Jest:
//   mingla-business/src/components/sites/plan/__tests__/issue_4453_plan_preview.implementor.test.ts
//   mingla-business/src/sites/__tests__/issue_4453_ari_add_page.implementor.test.ts
//   mingla-business/src/sites/__tests__/issue_4453_style_library.implementor.test.ts
//
// FAILS CLOSED. A missing file is a failure (exit 1).
//
// Usage:
//   node .github/scripts/strict-grep/issue-4453-sites-host-wiring.mjs
//   node .github/scripts/strict-grep/issue-4453-sites-host-wiring.mjs --self-test

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "I-PROPOSED-4453-SITES-HOST-WIRING";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const SETUP = "mingla-business/src/components/sites/setup/WebsiteSetupScreen.tsx";
const CHOOSER = "mingla-business/src/components/sites/plan/PlanPreviewChooser.tsx";
const PREVIEW_API = "mingla-business/src/sites/planPreviewApi.ts";
const PLAN_DESIGN = "mingla-business/src/components/sites/plan/PlanDesignPart.tsx";
const DESIGN_SECTION = "mingla-business/src/components/sites/website/sections/DesignSection.tsx";
const PAGES = "mingla-business/src/components/sites/website/sections/PagesSection.tsx";
const CONTENT_API = "mingla-business/src/sites/contentApi.ts";
const HARNESS_PREVIEW = "mingla-business/app/b/__dev-plan-preview.tsx";
const HARNESS_ADD_PAGE = "mingla-business/app/b/__dev-ari-add-page.tsx";
const HOST_SHELL = "mingla-business/src/components/ui/HostDesktopShell.tsx";
const WORKSPACE_SHELL = "mingla-business/src/components/sites/website/workspace/WorkspaceShell.tsx";
const ACCOUNT = "mingla-business/app/(tabs)/account.tsx";

const has = (needle) => (src) => src.includes(needle);
const matches = (re) => (src) => re.test(src);
const lacks = (re) => (src) => !re.test(src);

/** Each rule: the file, why, and a predicate over its text. */
export const RULES = [
  // Plan preview (M10): flag off keeps the look picker.
  { file: SETUP, why: "setup shows the preview chooser only while Core's plan_preview is on", ok: matches(/plan\.planPreview && !allStyles \? \(/) },
  { file: SETUP, why: "flag off: setup keeps the existing look picker", ok: matches(/<PlanDesignPart brandId=\{brandId\} planState=\{plan\} readOnly=\{readOnly\} onDone=/) },
  // Only "Start the build" writes: save the design, then Build.
  {
    file: CHOOSER,
    why: "the chooser makes exactly two writes, save then compose, both inside startBuild",
    ok: (src) => {
      const writes = src.match(/\b(save|compose)\.mutate\(/g) ?? [];
      return writes.join(",") === "save.mutate(,compose.mutate(" &&
        src.indexOf("save.mutate(") > src.indexOf("const startBuild");
    },
  },
  { file: CHOOSER, why: "native mounts one WebView; the card frame unmounts while full screen is open", ok: matches(/Platform\.OS === "web" \|\| \(index === active && full === null\)/) },
  { file: CHOOSER, why: "desktop frames are at least 360 px tall", ok: matches(/export const PLAN_PREVIEW_DESKTOP_MIN_HEIGHT = 360;/) },
  { file: CHOOSER, why: "desktop frames pass the min height", ok: matches(/minHeight=\{wide \? PLAN_PREVIEW_DESKTOP_MIN_HEIGHT : undefined\}/) },
  { file: CHOOSER, why: "react-native-webview is resolved at first render, never at module scope", ok: lacks(/^import\s+\{[^}]*\bScaledPreviewFrame\b[^}]*\}\s+from\s+"\.\.\/website\/preview\/ScaledPreviewFrame";/m) },
  { file: CHOOSER, why: "the chooser never reads the dev fixture", ok: lacks(/EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE/) },
  { file: PREVIEW_API, why: "the preview API never reads the dev fixture", ok: lacks(/EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE/) },
  // Style library (M7): both pickers read the gate.
  { file: PLAN_DESIGN, why: "the plan look picker reads lookPickerKeys", ok: has("lookPickerKeys(planState.styleLibrary, stored)") },
  { file: PLAN_DESIGN, why: "the plan look picker never maps DESIGN_KEYS directly", ok: lacks(/DESIGN_KEYS\.map/) },
  { file: PLAN_DESIGN, why: "an avoid style shows the warning", ok: has('testID="plan-design-avoid-warning"') },
  { file: DESIGN_SECTION, why: "the Website look picker reads lookPickerKeys", ok: has("lookPickerKeys(styleLibrary, design.key)") },
  { file: DESIGN_SECTION, why: "the Website look picker reads Core's style_library value", ok: has("ctx.plan?.styleLibrary === true") },
  { file: DESIGN_SECTION, why: "the Website look picker never maps DESIGN_KEYS directly", ok: lacks(/\{DESIGN_KEYS\.map/) },
  { file: DESIGN_SECTION, why: "an avoid style shows the warning", ok: has('testID="design-avoid-warning"') },
  // Add a page with Ari (M11).
  { file: PAGES, why: "the button reads Core's ari_add_page value only", ok: has("const ariAddPage = ctx.plan?.ariAddPage === true;") },
  { file: PAGES, why: "flag off: no Add a page with Ari button", ok: has('{ariAddPage ? <WButton label="Add a page with Ari"') },
  { file: PAGES, why: "the chip or topic seeds Ari's composer", ok: has("useAriSeedStore.getState().setSeed(ariPagePrompt(text))") },
  { file: PAGES, why: "the Draft card names what Ari needs", ok: has("Ari needs this") },
  { file: PAGES, why: "the Draft card says only the owner sees the questions", ok: has("Only you see these questions.") },
  { file: PAGES, why: "the Draft card says unanswered rows stay hidden", ok: has("Those rows stay hidden.") },
  { file: PAGES, why: "the Draft card publishes the page", ok: has('label="Publish this page"') },
  { file: PAGES, why: "keyboard avoidance goes through the house wrapper", ok: lacks(/import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*"react-native"/) },
  ...["ari_page_answer", "ari_page_accept", "ari_page_remove"].map((action) => ({
    file: CONTENT_API,
    why: `the Draft card acts through the owner's content action ${action}`,
    ok: has(`"${action}"`),
  })),
  // Dev harnesses: release builds redirect, no auth.
  ...[HARNESS_PREVIEW, HARNESS_ADD_PAGE].flatMap((file) => [
    { file, why: "a release build redirects away from the harness", ok: matches(/if \(!__DEV__\) return <Redirect href="\/" \/>;/) },
    { file, why: "the harness reads no auth", ok: lacks(/useAuth/) },
  ]),
  // Refused changes: every content call reads what Core relayed before choosing the owner's sentence.
  // (Behaviour: mingla-business/src/sites/__tests__/issue_4453_refusal_copy.implementor.test.ts.)
  { file: CONTENT_API, why: "a refusal's detail from Core is read", ok: has("const detail = refusalDetailFrom(body?.error);") },
  { file: CONTENT_API, why: "the refusal sentence is built from that detail", ok: has("refusalSentence(code, CONTENT_MESSAGES[code]!, detail)") },
  { file: CONTENT_API, why: "a change that did not pass its checks says what was wrong", ok: matches(/code === "VALIDATION_FAILED"\) \{\s+const sentence = refusalSentence\(code, "", detail\);/) },
  // The brand name tops every brand screen, once, and no screen above brand level.
  // (Behaviour: mingla-business/src/config/__tests__/issue_4453_above_brand_screens.implementor.test.ts.)
  { file: HOST_SHELL, why: "the desktop top bar shows the brand switcher on brand screens only", ok: has('<TopBar leftKind={aboveBrand ? "none" : "brand"} onBrandTap={onBrandTap} />') },
  { file: HOST_SHELL, why: "above-brand is decided from the route", ok: has("aboveBrand={isAboveBrandScreen(pathname)}") },
  { file: HOST_SHELL, why: "the phone strip is web-only, phone-width, signed-in, and steps aside for a screen with its own switcher", ok: has('const phoneBrandId = Platform.OS === "web" && !isWideDesktop && user != null && !screenOwnsSwitcher') },
  { file: HOST_SHELL, why: "the phone strip is the brand switcher", ok: has('<WorkspaceBrandSwitcher brandId={phoneBrandId} compact testID="host-phone-brand-switcher" />') },
  { file: HOST_SHELL, why: "the phone strip sits above the screen", ok: (src) => src.includes('testID="host-phone-brand-strip"') && src.indexOf('testID="host-phone-brand-strip"') < src.indexOf("<View style={styles.stack}>{children}</View>") },
  { file: WORKSPACE_SHELL, why: "the Website workspace tells the shell it carries the switcher on phones", ok: has("useOwnPhoneBrandSwitcher(phone);") },
  { file: ACCOUNT, why: "Account has no brand switcher at the top", ok: (src) => /<TopBar\s+leftKind="none"/.test(src) && !/<TopBar\s+leftKind="brand"/.test(src) },
  { file: ACCOUNT, why: "Account still opens the brands sheet from Your brands", ok: (src) => src.includes('testID="account-manage-brands"') && /<ListRow\s+onPress=\{handleOpenSwitcher\}\s+accessibilityLabel="Add or manage brands"/.test(src) },
];

export function audit(read) {
  const failures = [];
  for (const rule of RULES) {
    let src;
    try {
      src = read(rule.file);
    } catch {
      failures.push(`${rule.file}: missing (fails closed)`);
      continue;
    }
    if (!rule.ok(src)) failures.push(`${rule.file}: ${rule.why}`);
  }
  return failures;
}

const readRepo = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function selfTest() {
  const clean = audit(readRepo);
  if (clean.length) {
    console.error(`[${TAG}] self-test: the tree must be clean first:\n  ${clean.join("\n  ")}`);
    process.exit(1);
  }
  // One hostile mutation per rule: each must be caught on its own.
  const mutations = [
    [SETUP, (s) => s.replace("plan.planPreview && !allStyles ? (", "true ? (")],
    [CHOOSER, (s) => s.replace("compose.mutate(", "compose.mutate(); save.mutate(")],
    [CHOOSER, (s) => s.replace('const LazyScaledPreviewFrame', 'import { ScaledPreviewFrame } from "../website/preview/ScaledPreviewFrame";\nconst LazyScaledPreviewFrame')],
    [CHOOSER, (s) => s.replace("PLAN_PREVIEW_DESKTOP_MIN_HEIGHT = 360;", "PLAN_PREVIEW_DESKTOP_MIN_HEIGHT = 200;")],
    [PREVIEW_API, (s) => `${s}\nconst f = process.env.EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE;`],
    [PLAN_DESIGN, (s) => `${s}\nDESIGN_KEYS.map((k) => k);`],
    [DESIGN_SECTION, (s) => s.replace("ctx.plan?.styleLibrary === true", "true")],
    [PAGES, (s) => s.replace("const ariAddPage = ctx.plan?.ariAddPage === true;", "const ariAddPage = true;")],
    [PAGES, (s) => s.replace('import { Modal,', 'import { KeyboardAvoidingView, Modal,')],
    [CONTENT_API, (s) => s.replaceAll('"ari_page_remove"', '"remove_page"')],
    [HARNESS_PREVIEW, (s) => s.replace('if (!__DEV__) return <Redirect href="/" />;', "")],
    [HARNESS_ADD_PAGE, (s) => `${s}\nconst a = useAuth();`],
    [CONTENT_API, (s) => s.replace("const detail = refusalDetailFrom(body?.error);", "const detail = null;")],
    [HOST_SHELL, (s) => s.replace('leftKind={aboveBrand ? "none" : "brand"}', 'leftKind="brand"')],
    [HOST_SHELL, (s) => s.replace("user != null && !screenOwnsSwitcher", "user != null")],
    [WORKSPACE_SHELL, (s) => s.replace("useOwnPhoneBrandSwitcher(phone);", "")],
    [ACCOUNT, (s) => s.replace('leftKind="none"', 'leftKind="brand"')],
  ];
  let caught = 0;
  for (const [file, mutate] of mutations) {
    const original = readRepo(file);
    const mutated = mutate(original);
    if (mutated === original) {
      console.error(`[${TAG}] self-test: mutation for ${file} did not apply (anchor drifted)`);
      process.exit(1);
    }
    const failures = audit((rel) => (rel === file ? mutated : readRepo(rel)));
    if (failures.length === 0) {
      console.error(`[${TAG}] self-test: a hostile mutation of ${file} was NOT caught`);
      process.exit(1);
    }
    caught += 1;
  }
  // Fails closed on a missing file.
  if (audit((rel) => { if (rel === PAGES) throw new Error("gone"); return readRepo(rel); }).length === 0) {
    console.error(`[${TAG}] self-test: a missing file passed`);
    process.exit(1);
  }
  console.log(`[${TAG}] self-test PASS (${caught} hostile mutations + missing-file control)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = audit(readRepo);
  if (failures.length) {
    console.error(`[${TAG}] FAIL:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`[${TAG}] PASS (${RULES.length} rules)`);
}
