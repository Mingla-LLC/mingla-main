import { loadAuthoritativeContentShare, type ContentShareKind } from "./contentShare.ts";

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const PUBLIC_SERVER_KINDS = new Set<ContentShareKind>(["event", "rsvp_event", "trip", "experience", "venue", "brand"]);
const PUBLIC_IDENTITY_KEYS: Record<string, string[]> = {
  event: ["brandSlug", "eventSlug"], rsvp_event: ["brandSlug", "eventSlug"],
  trip: ["brandSlug", "eventSlug"], experience: ["brandSlug", "eventSlug"],
  venue: ["brandSlug", "venueSlug"], brand: ["brandSlug"],
};

function isExactPublicIdentity(kind: string, identity: Record<string, unknown>): boolean {
  const expected = PUBLIC_IDENTITY_KEYS[kind];
  if (!expected || Object.keys(identity).sort().join("|") !== [...expected].sort().join("|")) return false;
  return expected.every((key) => clean(identity[key], 256).length > 0 && clean(identity[key], 256) === identity[key]);
}

export async function createContentShareV1(
  db: any, userId: string | null, raw: Record<string, unknown>, options: { serverCreated?: boolean } = {},
) {
  const requestedKind = typeof raw.kind === "string" ? raw.kind : "";
  const allowedKinds = new Set<ContentShareKind>([
    "place", "curated", "event", "rsvp_event", "trip", "experience", "venue", "brand",
  ]);
  if (!allowedKinds.has(requestedKind as ContentShareKind)) return { status: 400, body: { error: "validation" } };
  const identity = raw.identity && typeof raw.identity === "object" && !Array.isArray(raw.identity)
    ? raw.identity as Record<string, unknown> : {};
  const serverCreated = options.serverCreated === true;
  if (serverCreated && (!PUBLIC_SERVER_KINDS.has(requestedKind as ContentShareKind) || !isExactPublicIdentity(requestedKind, identity))) {
    return { status: 400, body: { error: "validation" } };
  }
  if (!serverCreated && !userId) return { status: 401, body: { error: "unauthorized" } };
  const rawAttribution = raw.attribution && typeof raw.attribution === "object" && !Array.isArray(raw.attribution)
    ? raw.attribution as Record<string, unknown> : {};
  const attribution = Object.fromEntries([
    ["channel", clean(rawAttribution.channel, 40)],
    ["referralCode", clean(rawAttribution.referralCode, 80)],
  ].filter(([, value]) => value));
  let mapped;
  try {
    mapped = await loadAuthoritativeContentShare(db, userId || "", requestedKind as ContentShareKind, identity);
  } catch (mappingError) {
    const reason = mappingError instanceof Error ? mappingError.message : "not_found";
    return { status: reason === "validation" ? 400 : 404, body: { error: reason === "validation" ? "validation" : "not_found" } };
  }
  const { data: created, error } = await db.rpc("upsert_content_share_version", {
    p_entity_kind: requestedKind,
    p_creator_principal: serverCreated ? null : userId,
    p_source_key: mapped.sourceKey,
    p_source_reference: serverCreated ? { ...mapped.sourceReference, serverCreated: true } : mapped.sourceReference,
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
      facts: mapped.facts,
      media: mapped.mediaIdentity || null,
    },
  };
}
