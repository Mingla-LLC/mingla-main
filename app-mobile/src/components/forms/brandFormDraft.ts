/**
 * #4541 R2.9 — unsent typing on the form screen, kept on this phone only
 * (Constitution rule 5: a documented offline contract for unsent typing;
 * server answers are never persisted here).
 *
 *   key    mingla_brand_form_draft_v1:{formId}:{scope}
 *   scope  {eventId|campaignId|none}:{as|user|link}:{sid|self|<12 hex of SHA-256(token)>}
 *   value  {v:1, versionId, answers, savedAt}
 *
 * A personal link token never appears in a key: only the first 12 hex
 * characters of its SHA-256. Drafts expire 14 days after they were saved and
 * at most 20 are kept (the oldest goes). Sign-out removes every one of them
 * through performPrivateAuthCleanup's `mingla_` prefix rule (Constitution
 * rule 6; asserted by authCleanup.formDrafts.issue4541.test.ts).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const FORM_DRAFT_PREFIX = "mingla_brand_form_draft_v1:";
export const FORM_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const FORM_DRAFT_MAX_COUNT = 20;

export type DraftAnswers = Record<string, string | string[] | null>;

export interface FormDraft {
  v: 1;
  versionId: string | null;
  answers: DraftAnswers;
  savedAt: number;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 of an ASCII string as hex (the link token is 64 hex characters). Pure. */
export function sha256Hex(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) bytes.push(input.charCodeAt(i) & 0xff);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) {
    bytes.push(shift >= 32 ? 0 : (bitLength >>> shift) & 0xff);
  }
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

export interface DraftScopeInput {
  eventId?: string | null;
  campaignId?: string | null;
  as?: string | null;
  sid?: string | null;
  token?: string | null;
}

/** The draft scope (never the token). Pure. */
export function formDraftScope(input: DraftScopeInput): string {
  const context = input.eventId ?? input.campaignId ?? "none";
  if (typeof input.token === "string" && input.token.length > 0) {
    return `${context}:link:${sha256Hex(input.token).slice(0, 12)}`;
  }
  return `${context}:${input.as ?? "user"}:${input.sid ?? "self"}`;
}

export const formDraftKey = (formId: string, scope: string): string =>
  `${FORM_DRAFT_PREFIX}${formId}:${scope}`;

/** A stored value, or null when it is malformed or older than 14 days. Pure. */
export function parseDraft(raw: string | null, now: number): FormDraft | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<FormDraft> | null;
    if (
      value === null || value.v !== 1 || typeof value.savedAt !== "number" ||
      value.answers === null || typeof value.answers !== "object" || Array.isArray(value.answers)
    ) return null;
    if (now - value.savedAt > FORM_DRAFT_MAX_AGE_MS) return null;
    return {
      v: 1,
      versionId: typeof value.versionId === "string" ? value.versionId : null,
      answers: value.answers as DraftAnswers,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

export async function readFormDraft(key: string, now = Date.now()): Promise<FormDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const draft = parseDraft(raw, now);
    if (raw !== null && draft === null) await AsyncStorage.removeItem(key);
    return draft;
  } catch (error) {
    console.warn("[brandFormDraft] read failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/** Save, then keep at most 20 drafts (the oldest is evicted). */
export async function writeFormDraft(
  key: string,
  versionId: string | null,
  answers: DraftAnswers,
  now = Date.now(),
): Promise<void> {
  const value: FormDraft = { v: 1, versionId, answers, savedAt: now };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(FORM_DRAFT_PREFIX));
    if (keys.length <= FORM_DRAFT_MAX_COUNT) return;
    const rows = await AsyncStorage.multiGet(keys);
    const dated = rows.map(([k, raw]) => ({ k, savedAt: parseDraft(raw, now)?.savedAt ?? 0 }));
    dated.sort((x, y) => x.savedAt - y.savedAt);
    await AsyncStorage.multiRemove(dated.slice(0, keys.length - FORM_DRAFT_MAX_COUNT).map((row) => row.k));
  } catch (error) {
    console.warn("[brandFormDraft] write failed", error instanceof Error ? error.name : "unknown");
  }
}

export async function removeFormDraft(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn("[brandFormDraft] remove failed", error instanceof Error ? error.name : "unknown");
  }
}
