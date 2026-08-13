#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  page: "mingla-business/src/components/people/PeoplePage.tsx",
  primitives: "mingla-business/src/components/people/PeoplePrimitives.tsx",
  route: "mingla-business/app/(tabs)/marketing/people/index.tsx",
  happy: "mingla-business/src/components/people/__tests__/PeoplePage.issue2024.happy.test.tsx",
  preservedHappy:
    "mingla-business/src/components/people/__tests__/PeoplePage.issue1774.happy.test.tsx",
  preservedAdversarial:
    "mingla-business/src/components/people/__tests__/PeoplePage.issue1774.tester.adversarial.test.tsx",
  workflow: ".github/workflows/issue-1774-people-page-tests.yml",
};

const futureUi =
  /People you can reach|Reach unavailable|Followers|Extended circle|Export unavailable|Book export is coming soon\./;

export function audit(base) {
  const failures = [];
  const read = (key) => {
    const target = path.join(base, files[key]);
    if (!fs.existsSync(target)) {
      failures.push(`${files[key]} is missing`);
      return "";
    }
    return fs.readFileSync(target, "utf8");
  };
  const page = read("page");
  const primitives = read("primitives");
  const route = read("route");
  const happy = read("happy");
  const preservedHappy = read("preservedHappy");
  const preservedAdversarial = read("preservedAdversarial");
  const workflow = read("workflow");

  if (futureUi.test(page) || futureUi.test(route)) {
    failures.push("future reach/export UI returned to the People route");
  }
  if (/followersCount|extendedCircleCount|estimatedReach/.test(page)) {
    failures.push("People fabricates a future reach count");
  }
  if (/maxWidth\s*:\s*960|alignSelf\s*:\s*["']center["']/.test(page)) {
    failures.push("People restored the narrow whole-page desktop clamp");
  }
  for (const source of [page, route]) {
    if (
      !/screenReaderHeading\s*:\s*\{[\s\S]*?position\s*:\s*["']absolute["'][\s\S]*?width\s*:\s*1[\s\S]*?height\s*:\s*1[\s\S]*?opacity\s*:\s*0/.test(
        source,
      )
    ) {
      failures.push("a People route state lost its visually hidden semantic heading");
    }
  }
  if (!page.includes("useResponsiveLayout()") || !page.includes("isWideDesktop ? styles.workspaceWide : styles.workspaceCompact")) {
    failures.push("People does not use the canonical responsive owner for its composition");
  }
  if (!/bookColumnWide\s*:\s*\{[\s\S]*?flexBasis\s*:\s*0[\s\S]*?flexGrow\s*:\s*5[\s\S]*?minWidth\s*:\s*0/.test(page)) {
    failures.push("People Book column lost the approved 5-part wide allocation");
  }
  if (!/groupsColumnWide\s*:\s*\{[\s\S]*?flexBasis\s*:\s*0[\s\S]*?flexGrow\s*:\s*3[\s\S]*?minWidth\s*:\s*0/.test(page)) {
    failures.push("People Groups column lost the approved 3-part wide allocation");
  }
  if (!page.includes("const fabOffset = useStickyFooterOffset();")) {
    failures.push("People FAB bottom no longer comes from useStickyFooterOffset");
  }
  if (!page.includes("paddingBottom: fabOffset + FAB_HEIGHT + spacing.md")) {
    failures.push("People content no longer clears the FAB by the approved amount");
  }
  if (/marginBottom\s*:\s*fabOffset\s*\+\s*FAB_HEIGHT/.test(page)) {
    failures.push("People restored the forbidden full-width FAB bottom bar");
  }
  if (
    !page.includes("floatingActionInset={isWideDesktop ? undefined : fabWidth + spacing.md}") ||
    !page.includes("floatingActionInset={fabWidth + spacing.md}") ||
    !page.includes("setFabWidth((currentWidth) => Math.max(currentWidth, measuredWidth))") ||
    !primitives.includes("floatingActionInset!==undefined?{paddingRight:floatingActionInset}:undefined")
  ) {
    failures.push("People lost the measured local FAB-side content exclusion");
  }
  if (!page.includes('testID="people-new-campaign"') || !page.includes('accessibilityLabel="New campaign"')) {
    failures.push("People lost the labelled New campaign action");
  }
  const exactRoute = 'router.push("/marketing/campaigns/compose" as never);';
  if ((page.match(new RegExp(exactRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) {
    failures.push("People New campaign no longer performs one exact parameter-free push");
  }
  if (!page.includes('pointerEvents={modalOpen ? "none" : "auto"}') || !page.includes("accessibilityElementsHidden={modalOpen}")) {
    failures.push("People modal state no longer isolates the workspace and FAB");
  }
  if (!happy.includes("TestRenderer.create(<PeoplePage />)") || !happy.includes('node.props.testID === "people-new-campaign"')) {
    failures.push("issue #2024 happy guard no longer renders the real PeoplePage and campaign action");
  }
  if (!happy.includes("marginBottom).toBeUndefined()") || !happy.includes("paddingRight - 200")) {
    failures.push("issue #2024 rendered guard no longer rejects both overlap and viewport shrink");
  }
  if (!workflow.includes("PeoplePage.issue2024.happy.test.tsx") || !workflow.includes("issue-2024-people-page-layout.mjs --self-test") || !workflow.includes("issue-2024-people-page-layout.mjs")) {
    failures.push("issue #2024 happy/static guards are not both CI-wired");
  }
  if (!preservedHappy.includes('status="Import unavailable"') || !preservedHappy.includes("flag\\.data")) {
    failures.push("the preserved #1774 happy import fail-closed guard was weakened");
  }
  if (!preservedHappy.includes("followersCount") || !preservedHappy.includes("estimatedReach")) {
    failures.push("the preserved #1774 happy no-fabricated-reach guard was weakened");
  }
  if (!preservedAdversarial.includes('status="Import unavailable"') || !preservedAdversarial.includes("flag\\.data===true")) {
    failures.push("the preserved #1774 adversarial import fail-closed guard was weakened");
  }
  if (!preservedAdversarial.includes("followers?\\s*:\\s*\\d") || !preservedAdversarial.includes("extended\\s*:\\s*\\d")) {
    failures.push("the preserved #1774 adversarial no-fabricated-reach guard was weakened");
  }
  return failures;
}

function selfTest() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2024-people-page-"));
  const copyFixture = () => {
    for (const relative of Object.values(files)) {
      const target = path.join(fixture, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, relative), target);
    }
  };
  const expectMutation = (label, mutate, expected) => {
    copyFixture();
    mutate();
    if (!audit(fixture).some((failure) => failure.includes(expected))) {
      throw new Error(`true mutation was not detected: ${label}`);
    }
  };
  try {
    copyFixture();
    const cleanFailures = audit(fixture);
    if (cleanFailures.length > 0) {
      throw new Error(`clean fixture failed: ${cleanFailures.join("; ")}`);
    }
    const target = (key) => path.join(fixture, files[key]);
    expectMutation(
      "wide clamp restored",
      () => fs.appendFileSync(target("page"), "\nconst revertedLayout = { maxWidth: 960 };\n"),
      "narrow whole-page",
    );
    expectMutation(
      "future placeholder restored",
      () => fs.appendFileSync(target("page"), '\nconst revertedCard = "Extended circle";\n'),
      "future reach/export UI",
    );
    expectMutation(
      "sticky owner deleted",
      () => {
        const source = fs.readFileSync(target("page"), "utf8");
        fs.writeFileSync(target("page"), source.replace("const fabOffset = useStickyFooterOffset();", "const fabOffset = 24;"));
      },
      "useStickyFooterOffset",
    );
    expectMutation(
      "local FAB-side lane deleted",
      () => {
        const source = fs.readFileSync(target("page"), "utf8");
        fs.writeFileSync(
          target("page"),
          source.replace(
            "floatingActionInset={fabWidth + spacing.md}",
            "floatingActionInset={undefined}",
          ),
        );
      },
      "measured local FAB-side content exclusion",
    );
    expectMutation(
      "global FAB bottom bar restored",
      () => {
        const source = fs.readFileSync(target("page"), "utf8");
        fs.writeFileSync(
          target("page"),
          `${source}\nconst revertedViewport = { marginBottom: fabOffset + FAB_HEIGHT };\n`,
        );
      },
      "forbidden full-width FAB bottom bar",
    );
    expectMutation(
      "PeopleBlock stops applying the local lane",
      () => {
        const source = fs.readFileSync(target("primitives"), "utf8");
        fs.writeFileSync(
          target("primitives"),
          source.replace(
            "floatingActionInset!==undefined?{paddingRight:floatingActionInset}:undefined",
            "undefined",
          ),
        );
      },
      "measured local FAB-side content exclusion",
    );
    expectMutation(
      "campaign action deleted",
      () => {
        const source = fs.readFileSync(target("page"), "utf8");
        fs.writeFileSync(target("page"), source.replace('testID="people-new-campaign"', 'testID="deleted-campaign-action"'));
      },
      "labelled New campaign",
    );
    expectMutation(
      "route changed",
      () => {
        const source = fs.readFileSync(target("page"), "utf8");
        fs.writeFileSync(
          target("page"),
          source.replace(
            'router.push("/marketing/campaigns/compose" as never);',
            'router.push("/marketing/campaigns/compose?audience=book" as never);',
          ),
        );
      },
      "parameter-free push",
    );
    expectMutation(
      "hidden heading made visible",
      () => {
        const source = fs.readFileSync(target("route"), "utf8");
        fs.writeFileSync(target("route"), source.replace("opacity: 0", "opacity: 1"));
      },
      "hidden semantic heading",
    );
    expectMutation(
      "happy render removed from CI",
      () => {
        const source = fs.readFileSync(target("workflow"), "utf8");
        fs.writeFileSync(target("workflow"), source.replace(/^.*PeoplePage\.issue2024\.happy\.test\.tsx.*\n/m, ""));
      },
      "both CI-wired",
    );
    console.log("[issue-2024-people-page-layout] self-test PASS");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = audit(root);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[issue-2024-people-page-layout] FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("[issue-2024-people-page-layout] PASS");
}
