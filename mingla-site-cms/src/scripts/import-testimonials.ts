/**
 * #2829 W5 (amendment A1.3) — import a brand's reviews into its site's
 * Testimonials, after scripts/sites/import-historical-trips.mjs has created its
 * past trips in Mingla (the mapping file attaches each review to its trip).
 *
 * Run with Payload's script runner and the Studio environment of the target
 * (local stack, or production as a Seth-approved step after merge):
 *
 *   SITES_IMPORT_FILE=<records.json> SITES_IMPORT_MAPPING=<mapping.json> \
 *   SITES_IMPORT_SITE_ID=<core site id> [SITES_IMPORT_APPLY=1] \
 *   npx payload run src/scripts/import-testimonials.ts
 *
 * Without SITES_IMPORT_APPLY=1 it only prints what it would write. The
 * records file is private (never committed). Nothing is published: the
 * brand reviews and publishes the site.
 */
import { readFile } from "node:fs/promises";
import { getPayload } from "payload";
import config from "@payload-config";
import { importTestimonials, plannedTestimonials, type ReviewRecord, type TripMapping } from "../lib/testimonialImport";

async function run(): Promise<void> {
  const file = process.env.SITES_IMPORT_FILE;
  const siteId = process.env.SITES_IMPORT_SITE_ID;
  if (!file || !siteId) throw new Error("Set SITES_IMPORT_FILE and SITES_IMPORT_SITE_ID.");
  const records = JSON.parse(await readFile(file, "utf8")) as { reviews?: ReviewRecord[] };
  const mapping = process.env.SITES_IMPORT_MAPPING
    ? (JSON.parse(await readFile(process.env.SITES_IMPORT_MAPPING, "utf8")) as TripMapping)
    : null;
  const payload = await getPayload({ config });
  const tenants = await payload.find({
    collection: "tenants",
    overrideAccess: true,
    depth: 0,
    limit: 2,
    where: { core_site_id: { equals: siteId } },
  });
  if (tenants.docs.length !== 1) throw new Error("No single Studio tenant for that site id.");
  const tenantId = String(tenants.docs[0]!.id);
  const planned = plannedTestimonials(records.reviews ?? [], mapping);
  const outcomes = await importTestimonials(payload, tenantId, planned, process.env.SITES_IMPORT_APPLY === "1");
  for (const outcome of outcomes) console.log(`  ${outcome.status.padEnd(8)} ${outcome.reviewer} (${outcome.review_date})`);
  const unconfirmed = planned.filter((review) => !review.confirmed_real).length;
  if (unconfirmed) console.log(`${unconfirmed} review(s) are not confirmed as real and will not be published until confirmed in Studio.`);
  if (process.env.SITES_IMPORT_APPLY !== "1") console.log("Dry run: nothing written. Set SITES_IMPORT_APPLY=1 to import.");
}

await run();
process.exit(0);
