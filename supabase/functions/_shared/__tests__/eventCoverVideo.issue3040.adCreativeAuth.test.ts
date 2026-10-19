// Issue #3040 (E-1c, E-11, C-1, C-15) — who may drive an ad_creative upload.
// Every lane endpoint (intent, source-uploaded, status, apply, cancel) gates
// through requireCoverVideoTargetManager, so this is the one auth contract.
//
// FAILS ON REVERT: drop the ad_creative branch and a brandless selector falls
// through to the brand checks (400), and a marketing manager is refused.
import {
  parseAdCreativeOwnerKey,
  requireCoverVideoTargetManager,
} from "../eventCoverVideo.ts";
import { assert, makeFakeDb } from "./issue3040_fakeSupabase.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const HOST = "22222222-2222-4222-8222-222222222222";
const BRAND = "33333333-3333-4333-8333-333333333333";

const db = (planAllowed: boolean) =>
  makeFakeDb(
    { admin_users: [{ id: "a-1", email: "ops@mingla.test", status: "active" }] },
    { ad_can_host_action: () => ({ data: planAllowed, error: null }) },
    { users: { [ADMIN]: { email: "ops@mingla.test" }, [HOST]: { email: "host@brand.test" } } },
  );

const selector = (brandId: string | null, key: string, requestedBy: string | null) => ({
  targetKind: "ad_creative" as const,
  eventId: null,
  brandId,
  venueId: null,
  draftOwnerKey: key,
  requestedBy,
});

Deno.test("#3040 a house (brandless) ad upload needs an active admin", async () => {
  const ok = await requireCoverVideoTargetManager(db(false).client, selector(null, `admin-library:${ADMIN}`, ADMIN), ADMIN);
  assert(!(ok instanceof Response), "active admin refused");
  const refused = await requireCoverVideoTargetManager(db(false).client, selector(null, `admin-library:${HOST}`, HOST), HOST);
  assert(refused instanceof Response && refused.status === 403, "a non-admin drove a house upload");
});

Deno.test("#3040 a brand ad upload follows the ad plan permission (marketing managers included)", async () => {
  const fake = db(true);
  const ok = await requireCoverVideoTargetManager(fake.client, selector(BRAND, "host-ad:draft-123", HOST), HOST);
  assert(!(ok instanceof Response), "plan-permitted user refused");
  const call = fake.rpcs.find((rpc) => rpc.name === "ad_can_host_action");
  assert(call?.args.p_action === "plan" && call?.args.p_brand_id === BRAND && call?.args.p_user_id === HOST, JSON.stringify(call));
  const refused = await requireCoverVideoTargetManager(db(false).client, selector(BRAND, "host-ad:draft-123", HOST), HOST);
  assert(refused instanceof Response && refused.status === 403, "a user without plan permission drove a brand ad upload");
});

Deno.test("#3040 an ad upload is private to its requester and needs a valid owner key", async () => {
  const other = await requireCoverVideoTargetManager(db(true).client, selector(BRAND, "host-ad:draft-123", ADMIN), HOST);
  assert(other instanceof Response && other.status === 403, "another user drove someone's upload");
  const badKey = await requireCoverVideoTargetManager(db(true).client, selector(BRAND, "draft-123", HOST), HOST);
  assert(badKey instanceof Response && badKey.status === 400, "an unparseable owner key was accepted");
  const brandless = await requireCoverVideoTargetManager(db(true).client, {
    targetKind: "brand", eventId: null, brandId: null, venueId: null, draftOwnerKey: null,
  }, HOST);
  assert(brandless instanceof Response && brandless.status === 400, "a brandless non-ad target was accepted");
});

Deno.test("#3040 owner key grammar", () => {
  assert(JSON.stringify(parseAdCreativeOwnerKey("admin-library:abc")) === JSON.stringify({ kind: "admin-library", id: "abc" }), "admin");
  assert(parseAdCreativeOwnerKey("ari:proposal_1")?.kind === "ari", "ari");
  assert(parseAdCreativeOwnerKey("host-ad:ab") === null, "id under 3 chars");
  assert(parseAdCreativeOwnerKey("venue:abc") === null, "unknown kind");
  assert(parseAdCreativeOwnerKey("host-ad:a/b/c") === null, "path characters");
  assert(parseAdCreativeOwnerKey(`host-ad:${"x".repeat(121)}`) === null, "id over 120 chars");
});
