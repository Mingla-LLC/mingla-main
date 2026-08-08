import { loadAuthoritativeContentShare, type ContentShareKind } from "./contentShare.ts";

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function createContentShareV1(db: any, userId: string, raw: Record<string, unknown>) {
  const requestedKind = typeof raw.kind === "string" ? raw.kind : "";
  const allowedKinds = new Set<ContentShareKind>([
    "place", "curated", "event", "rsvp_event", "trip", "experience", "venue", "brand",
  ]);
  if (!allowedKinds.has(requestedKind as ContentShareKind)) return { status: 400, body: { error: "validation" } };
  const identity = raw.identity && typeof raw.identity === "object" && !Array.isArray(raw.identity)
    ? raw.identity as Record<string, unknown> : {};
  const rawAttribution = raw.attribution && typeof raw.attribution === "object" && !Array.isArray(raw.attribution)
    ? raw.attribution as Record<string, unknown> : {};
  const attribution = Object.fromEntries([
    ["channel", clean(rawAttribution.channel, 40)],
    ["referralCode", clean(rawAttribution.referralCode, 80)],
  ].filter(([, value]) => value));
  let mapped;
  try {
    mapped = await loadAuthoritativeContentShare(db, userId, requestedKind as ContentShareKind, identity);
  } catch (mappingError) {
    const reason = mappingError instanceof Error ? mappingError.message : "not_found";
    return { status: reason === "validation" ? 400 : 404, body: { error: reason === "validation" ? "validation" : "not_found" } };
  }
  const { data: created, error } = await db.rpc("upsert_content_share_version", {
    p_entity_kind: requestedKind,
    p_creator_principal: userId,
    p_source_key: mapped.sourceKey,
    p_source_reference: mapped.sourceReference,
    p_attribution: attribution,
    p_facts: mapped.facts,
    p_media_identity: mapped.mediaIdentity || null,
    p_destination_manifest: mapped.destinationManifest,
  });
  if (error || !created?.shortCode) throw error || new Error("share_create_failed");
  return {
    status: created.versionCreated ? 201 : 200,
    body: {
      shortCode: created.shortCode, version: created.version,
      versionCreated: created.versionCreated,
      canonicalUrl: `https://usemingla.com/s/${created.shortCode}`,
    },
  };
}
