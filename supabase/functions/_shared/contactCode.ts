// Issue #4063 — rejection-sampled six-digit codes and their stored digests.
// The raw code is sent once and is never persisted.

export interface ContactCodeRandom {
  // Only Uint8Array is ever filled (#4514: the wider generic did not type-check
  // `crypto` as the default under deno 1.46, which the edge lanes run).
  getRandomValues(array: Uint8Array): Uint8Array;
}

export function generateContactCode(
  random: ContactCodeRandom = crypto,
): string {
  let result = "";
  while (result.length < 6) {
    const bytes = random.getRandomValues(new Uint8Array(8));
    for (const byte of bytes) {
      if (byte < 250) result += String(byte % 10);
      if (result.length === 6) break;
    }
  }
  return result;
}

function pepperHex(pepper: Uint8Array): string {
  return Array.from(pepper, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function contactCodeHash(
  pepper: Uint8Array,
  challengeId: string,
  code: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${pepperHex(pepper)}:${challengeId}:${code}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
