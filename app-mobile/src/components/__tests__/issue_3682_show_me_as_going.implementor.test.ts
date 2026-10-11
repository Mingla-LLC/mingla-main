/**
 * #3682 Wave 2.8 — Who's going sheet wires Show me as going + private copy.
 * Runs under META-ORCH-1337 deno suite (same lane as orch_1341 sheet tests).
 */
import { assertStringIncludes } from "jsr:@std/assert@1";

const root = new URL("../../../../", import.meta.url);
const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, root));

const sheet = read("app-mobile/src/components/EventGuestListSheet.tsx");
const service = read("app-mobile/src/services/socialProofService.ts");
const types = read("packages/offering-rendering/socialProofTypes.ts");

Deno.test("#3682 sheet exposes Show me as going toggle and private-others copy", () => {
  assertStringIncludes(sheet, "issue-3682-show-me-as-going-switch");
  assertStringIncludes(sheet, "Show me as going");
  assertStringIncludes(sheet, "keep it private");
  assertStringIncludes(sheet, "setShowMeAsGoing");
});

Deno.test("#3682 service calls biz_set_show_me_as_going", () => {
  assertStringIncludes(service, "biz_set_show_me_as_going");
  assertStringIncludes(service, "export const setShowMeAsGoing");
});

Deno.test("#3682 PeerGuestListPage carries privateOthersCount + viewerShowMeAsGoing", () => {
  assertStringIncludes(types, "privateOthersCount?");
  assertStringIncludes(types, "viewerShowMeAsGoing?");
});
