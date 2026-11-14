// MINGLA-INVARIANT: I-4238-HOST-SUPPLY-EVENTS | issue #4238 | the Host app logs mingla_trip_published and mingla_experience_published at the publish-succeeded point (the twins of mingla_event_published), and mingla_venue_listing_submitted keeps its name.
/**
 * #4238 W6-12. Source contract (comments stripped): each supply event fires
 * only after its publish succeeded, through the one logAppsFlyerEvent.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (rel: string): string =>
  fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("#4238 W6-12 Host supply events", () => {
  test("trips log mingla_trip_published after the publish command and refetch succeeded", () => {
    const src = read("src/services/tripsService.ts");
    const fn = src.slice(src.indexOf("export async function publishTrip("));
    const body = fn.slice(0, fn.indexOf("\nexport ") > 0 ? fn.indexOf("\nexport ") : fn.length);
    const rpc = body.indexOf('"biz_publish_trip_command"');
    const notFound = body.indexOf("trip not found after publish");
    const log = body.indexOf('logAppsFlyerEvent("mingla_trip_published"');
    expect(rpc).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(notFound);
    expect(notFound).toBeGreaterThan(rpc);
    expect(body).toMatch(/brand_id:\s*refreshed\.brandId/);
  });

  test("experiences log mingla_experience_published only on a real publish, after offering_published", () => {
    const src = read("src/components/experience/ExperienceCreatorWizard.tsx");
    const gate = src.indexOf("if (publish) {\n          postHogService.capture(\"offering_published\"");
    const log = src.indexOf('logAppsFlyerEvent("mingla_experience_published"');
    expect(gate).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(gate);
    expect(log - gate).toBeLessThan(900);
  });

  test("events and venue listings keep their existing names", () => {
    expect(read("src/services/businessEvents.ts")).toContain('logAppsFlyerEvent("mingla_event_published"');
    expect(read("src/services/venueListingsService.ts")).toContain(
      'logAppsFlyerEvent("mingla_venue_listing_submitted"',
    );
  });
});
