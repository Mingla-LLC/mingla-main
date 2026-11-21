/**
 * #4490 spec 07-C and the #4514 no-op handoff seams.
 *
 * These assertions deliberately bind the wiring that a simple model test
 * cannot see: hire extras must cross host authoring, guest quoting and host
 * quote review, while every future form slot stays optional until #4514
 * supplies a renderer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(__dirname, "../../../../..");
const read = (relative: string): string => readFileSync(join(repo, relative), "utf8");

describe("#4490 paid private-hire extras wiring", () => {
  it("uses the shared editor and saves extras with the hire action", () => {
    const editor = read("mingla-business/src/components/venue/features/offers/HireEditor.tsx");
    expect(editor).toContain('import { ExtrasEditor } from "./ExtrasEditor"');
    expect(editor).toContain('action: "set_extras"');
    expect(editor).toContain('<ExtrasEditor');
    expect(editor).toContain('title="Paid extras"');
  });

  it("lets a guest pick extras and keeps them visible when the host edits the whole quote", () => {
    const guest = read("mingla-business/src/components/venue/offers/HireRequest.tsx");
    const host = read("mingla-business/src/components/venue/features/requests/VenueRequestsModule.tsx");
    expect(guest).toContain('extras: pickedExtras.map((id) => ({ id }))');
    expect(guest).toContain('testID="issue-4490-hire-request-extras"');
    expect(host).toContain('label="Hire and extras"');
    expect(host).toContain('testID="venue-request-quote-included-extras"');
    expect(host).toContain('Includes ${extra.name}');
  });
});

describe("#4514 transitional form seams", () => {
  it.each([
    ["mingla-business/src/components/venue/VenueDetailsEditor.tsx", "formAttachRow?: React.ReactNode"],
    ["mingla-business/src/components/venue/features/offers/PackageEditor.tsx", "questionsSource?: React.ReactNode"],
    ["mingla-business/src/components/venue/features/offers/HireEditor.tsx", "questionsSource?: React.ReactNode"],
    ["packages/brand-rendering/PublicVenueScreen.tsx", "formSection?: (context: PublicVenueThemedContext) => BrandRenderingReactNode"],
  ])("keeps %s optional and explicitly transitional", (file, signature) => {
    const source = read(file);
    expect(source).toContain("[TRANSITIONAL] blocked on #4514");
    expect(source).toContain(signature);
  });

  it("places the public form after the last About, Location or Hours section and renders nothing when absent", () => {
    const source = read("packages/brand-rendering/PublicVenueScreen.tsx");
    expect(source).toContain("formSection === undefined ? null : formSection(themedSlotContext)");
    expect(source).toMatch(/sectionId === "about" \|\| sectionId === "location" \|\| sectionId === "hours"/);
    expect(source).toContain("formSectionNode !== null && index === formSectionAfter");
    expect(source).toContain("formSectionNode !== null && formSectionAfter < 0 ? formSectionNode : null");
  });

  it("places the offer sources in the required steps and leaves them absent by default", () => {
    const packages = read("mingla-business/src/components/venue/features/offers/PackageEditor.tsx");
    const hire = read("mingla-business/src/components/venue/features/offers/HireEditor.tsx");
    expect(packages).toContain('<RulesStep {...stepProps} currency={currency} questionsSource={questionsSource} />');
    expect(packages).toMatch(/<StepHead title="Deposit and rules"[^>]*\/>\s*\{questionsSource\}/);
    expect(hire).toContain('<BookStep {...stepProps} venueName={venueName} questionsSource={questionsSource} />');
    expect(hire).toMatch(/<StepHead title="How guests book"[^>]*\/>\s*\{questionsSource\}/);
  });
});
