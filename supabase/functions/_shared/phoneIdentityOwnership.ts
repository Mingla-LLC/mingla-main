// #4063: one phone may belong to only one account across every authority that
// can survive account/profile cleanup. Edge callers must fail closed when the
// service-role RPC cannot provide this complete ownership view.

export const PHONE_IDENTITY_SOURCES = [
  "profile",
  "verified_phone_identity",
  "auth_user",
] as const;

export type PhoneIdentitySource = typeof PHONE_IDENTITY_SOURCES[number];

export type PhoneIdentityOwner = {
  userId: string;
  sources: PhoneIdentitySource[];
};

type RpcError = { message: string };

export type RpcCapable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

const SOURCE_SET = new Set<string>(PHONE_IDENTITY_SOURCES);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getPhoneIdentityOwners(
  client: RpcCapable,
  phone: string,
): Promise<{ owners: PhoneIdentityOwner[]; error: string | null }> {
  const { data, error } = await client.rpc("phone_identity_owners", {
    p_phone: phone,
  });
  if (error) return { owners: [], error: error.message };
  if (!Array.isArray(data)) {
    return {
      owners: [],
      error: "phone_identity_owners returned a non-array result",
    };
  }

  const owners: PhoneIdentityOwner[] = [];
  for (const row of data) {
    const candidate = row as {
      owner_user_id?: unknown;
      owner_sources?: unknown;
    } | null;
    if (
      !candidate ||
      typeof candidate.owner_user_id !== "string" ||
      !UUID_REGEX.test(candidate.owner_user_id) ||
      !Array.isArray(candidate.owner_sources) ||
      candidate.owner_sources.length === 0 ||
      candidate.owner_sources.some((source) =>
        typeof source !== "string" || !SOURCE_SET.has(source)
      )
    ) {
      return {
        owners: [],
        error: "phone_identity_owners returned an invalid ownership row",
      };
    }
    owners.push({
      userId: candidate.owner_user_id,
      sources: [...new Set(candidate.owner_sources)] as PhoneIdentitySource[],
    });
  }
  return { owners, error: null };
}

export function conflictingPhoneOwners(
  owners: PhoneIdentityOwner[],
  userId: string,
): PhoneIdentityOwner[] {
  return owners.filter((owner) => owner.userId !== userId);
}

export function isProfileOnlyPhoneOwner(owner: PhoneIdentityOwner): boolean {
  return owner.sources.length === 1 && owner.sources[0] === "profile";
}

export function hasCurrentVerifiedPhoneOwnership(
  owners: PhoneIdentityOwner[],
  userId: string,
): boolean {
  return owners.some((owner) =>
    owner.userId === userId &&
    (
      owner.sources.includes("profile") ||
      owner.sources.includes("verified_phone_identity")
    )
  );
}
