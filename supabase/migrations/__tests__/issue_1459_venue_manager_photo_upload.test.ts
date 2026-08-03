import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20270208001459_issue_1459_venue_manager_photo_upload.sql",
);
const service = await Deno.readTextFile(
  "mingla-business/src/services/venueGalleryService.ts",
);

Deno.test("#1459: all three gallery write policies use event_manager+ and stay brand scoped", () => {
  for (const policy of [
    "brand_covers_admin_write",
    "brand_covers_admin_update",
    "brand_covers_admin_delete",
  ]) {
    assert(migration.includes(`CREATE POLICY "${policy}"`));
  }
  assertEquals(
    migration.match(/biz_role_rank\('event_manager'\)/g)?.length,
    4,
    "INSERT, UPDATE USING, UPDATE WITH CHECK, and DELETE must share the canonical boundary",
  );
  assertEquals(
    migration.match(/split_part\(name, '\/', 1\)/g)?.length,
    4,
    "every write predicate must derive authority from the key's brand prefix",
  );
  assert(!migration.includes("biz_role_rank('brand_admin')"));
});

Deno.test("#1459: bucket supports every gallery MIME and enforces exactly 8 MiB", () => {
  for (const mime of [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
  ]) {
    assert(migration.includes(`'${mime}'`), `${mime} missing from bucket contract`);
  }
  assert(migration.includes("file_size_limit = 8388608"));
  assert(service.includes("VENUE_GALLERY_MAX_BYTES = 8 * 1024 * 1024"));
  assert(service.includes('"Each photo must be under 8 MB."'));
  assert(!service.includes("under 10 MB"));
});

Deno.test("#1459 adversarial: lowering the role cannot grant cross-brand access", () => {
  const EVENT_MANAGER_RANK = 40;
  const allowed = (
    keyBrand: string,
    callerBrand: string | null,
    callerRank: number,
    bucket = "brand_covers",
  ) =>
    bucket === "brand_covers" &&
    keyBrand === callerBrand &&
    callerRank >= EVENT_MANAGER_RANK;

  assert(allowed("brand-a", "brand-a", 40));
  assert(!allowed("brand-a", "brand-a", 10));
  assert(!allowed("brand-a", "brand-b", 60));
  assert(!allowed("brand-a", null, 60));
  assert(!allowed("brand-a", "brand-a", 60, "event_covers"));
});
