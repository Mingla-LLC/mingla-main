export async function constantTimeEqualSecret(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function contentShareCreateRateLimitArgs(actorHash: string, serverCreated: boolean) {
  return {
    p_actor_hash: actorHash,
    p_action: "create",
    p_limit: serverCreated ? 30 : 20,
    p_window_seconds: 3600,
  };
}
