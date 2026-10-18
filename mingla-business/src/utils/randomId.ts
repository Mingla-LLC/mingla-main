/**
 * randomId — RN-safe unique-ID generator.
 *
 * Hermes (React Native's JS engine) has no global `crypto`, so a bare
 * `crypto.randomUUID()` call throws ReferenceError on device. Use this helper
 * anywhere an Idempotency-Key / per-attempt UUID is needed.
 *
 * Output is always a non-empty string in the [8..128] char range so it
 * satisfies the ORCH-0787 edge function's Idempotency-Key contract.
 */
export const randomId = (): string => {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** RN-safe UUID for server resources whose primary key is PostgreSQL uuid. */
export const randomUuid = (): string => {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  const hex = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return hex.replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = token === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
};
