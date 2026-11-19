/**
 * #4453 Website workspace — regressions found by walking the workspace in a
 * browser against a local stack.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MENU_TOUCHES } from "../contentApi";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

describe("a menu change made under Pages and menu is an undoable draft change like any other", () => {
  it("refreshes the workspace's undo history, its status and the publish check", () => {
    expect([...MENU_TOUCHES]).toEqual(["workspace", "history", "validation"]);
    const source = read("contentApi.ts");
    const hook = source.slice(source.indexOf("export function useSetSiteMenu"), source.indexOf("export type AriPageActionInput"));
    expect(hook).toContain('contentCall<{ revision: string }>(siteId!, "set_menu"');
    expect(hook).toContain("for (const touched of MENU_TOUCHES) void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, touched) });");
  });
});

describe("a step that cannot be undone on its own says what to do next", () => {
  it("points at the Undo button at the top", () => {
    expect(read("contentApi.ts")).toContain(
      'CHANGED_SINCE: "That part of your website changed afterwards, so this step can’t be put back on its own. Use Undo at the top to step back one change at a time."',
    );
  });
});

describe("the workspace's autosave writer survives its effect being run again", () => {
  it("resumes on setup and is disposed only by the cleanup of the latest run", () => {
    const source = readFileSync(resolve(__dirname, "../../components/sites/website/workspace/useWorkspace.ts"), "utf8");
    expect(source).toContain("current?.resume();");
    expect(source).toContain("if (writerOwners.current === owner) current.dispose();");
  });
});

describe("a first publish runs the design checks on the draft it is about to publish", () => {
  // Core refuses a first publish (DESIGN_CHECKS_REQUIRED) unless the checks ran on that exact
  // draft; "Looks good" in the Publish panel makes a new draft after the panel's own run.
  const source = readFileSync(resolve(__dirname, "../../components/sites/website/useWebsiteController.ts"), "utf8");
  const action = source.slice(source.indexOf("publishChecked: async"), source.indexOf("rollback: (selectedVersion"));
  it("after the fresh draft check and before the publish starts, only while nothing has been published", () => {
    const validated = action.indexOf("validateBrandSiteDraft({ brandId: safeBrandId, siteId })");
    const checked = action.indexOf("await runDesignChecks(siteId)");
    const started = action.indexOf("await startPublication({");
    expect(validated).toBeGreaterThan(-1);
    expect(checked).toBeGreaterThan(validated);
    expect(started).toBeGreaterThan(checked);
    expect(action).toContain("if (site.data?.last_successful_publication_id === null) {");
  });
  it("keeps the run the panel shows in step", () => {
    expect(action).toContain('queryClient.setQueryData(brandSiteKeys.siteData(siteId, "design-checks"), await runDesignChecks(siteId));');
    expect(read("contentApi.ts")).toContain('export const runDesignChecks = (siteId: string) => contentCall<DesignCheckRun>(siteId, "design_checks");');
  });
});

describe("a website service that never answers does not leave the screen loading for ever", () => {
  it("every website request gives up after a bounded wait and reads as the service not answering", () => {
    const service = readFileSync(resolve(__dirname, "../../services/brandSitesService.ts"), "utf8");
    expect(service).toMatch(/export const SITES_REQUEST_TIMEOUT_MS = \d{2}_000;/);
    expect(service).toContain("{ body: { route, method, ...payload }, timeout: SITES_REQUEST_TIMEOUT_MS },");
    expect(read("contentApi.ts")).toContain("args }, timeout: SITES_REQUEST_TIMEOUT_MS },");
  });
});

describe("the website service being down is not the same as having no Website", () => {
  const controller = readFileSync(resolve(__dirname, "../../components/sites/website/useWebsiteController.ts"), "utf8");
  const app = readFileSync(resolve(__dirname, "../../components/sites/website/WebsiteApp.tsx"), "utf8");
  it("only a refusal from Core counts as 'no Website here'", () => {
    expect(controller).toContain('const REFUSAL_CODES = new Set(["FORBIDDEN", "NOT_FOUND", "NOT_ENTITLED", "INVALID_STATE", "SESSION_EXPIRED"]);');
    expect(controller).toContain("const availabilityDown = availability.isError && !websiteRefusal(availability.error);");
    expect(controller).toContain("? (availabilityDown ? null : false)");
  });
  it("a failed check shows a plain message and Try again, before any redirect or endless loading", () => {
    const down = app.indexOf("if (controller.availabilityDown) {");
    const loading = app.indexOf("if (websiteAvailable !== true) {");
    expect(down).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(down);
    expect(app).toContain('testID="website-unreachable"');
    expect(app).toContain("Mingla’s website service isn’t answering");
    expect(app).toContain('onPress={controller.retryAvailability}');
    // The redirect is kept for a real refusal only.
    expect(app).toContain("if (canCheckAvailability && websiteAvailable === false) {");
  });
});
