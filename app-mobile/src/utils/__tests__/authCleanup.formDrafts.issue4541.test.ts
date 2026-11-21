/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R2.9 (T-32) — unsent form typing stays on this phone, expires after 14
 * days, never names a personal link's token, keeps at most 20 drafts, and
 * every form key (drafts, hand-off seen, pending sign-in route, capability
 * report) is removed on sign-out by performPrivateAuthCleanup's `mingla_`
 * rule (Constitution rule 6).
 *
 * Red on revert of the `mingla_` prefix on any of these keys, the 14-day
 * expiry, the token hash in the scope, or the 20-draft eviction. Runs under
 * app-mobile/jest.issue2774.render.cjs.
 */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../store/appStore", () => ({
  useAppStore: (select: (s: { user: null }) => unknown) => select({ user: null }),
}));
jest.mock("../../components/forms/RsvpFormWebDateInput", () => ({ RsvpFormWebDateInput: () => null }), { virtual: true });

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  FORM_DRAFT_MAX_AGE_MS,
  FORM_DRAFT_PREFIX,
  formDraftKey,
  formDraftScope,
  parseDraft,
  readFormDraft,
  sha256Hex,
  writeFormDraft,
} from "../../components/forms/brandFormDraft";
import { handoffSeenKey } from "../../components/forms/FormHandoffBlock";
import {
  FORM_CAPABILITY_KEY,
  PENDING_FORM_ROUTE_KEY,
  setPendingFormRoute,
  stripFormToken,
  takePendingFormRoute,
} from "../../components/forms/formsStartup";

// The predicate performPrivateAuthCleanup sweeps AsyncStorage with. Read from
// source so this suite does not load the cleanup's own integrations.
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const cleanupSource = fs.readFileSync(path.join(__dirname, "..", "authCleanup.ts"), "utf8");
const privatePrefixes = [...cleanupSource.matchAll(/key\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
const swept = (key: string): boolean => privatePrefixes.some((prefix) => key.startsWith(prefix));

const FORM = "45410000-0000-4000-8000-000000000004";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const RSVP = "45410000-0000-4000-8000-0000000000b1";
const TOKEN = "cd".repeat(32);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("#4541 T-32 — sign-out removes every form key", () => {
  it("the cleanup sweeps the `mingla_` prefix", () => {
    expect(privatePrefixes).toContain("mingla_");
  });

  it.each([
    formDraftKey(FORM, formDraftScope({ eventId: EVENT, as: "rsvp", sid: RSVP })),
    formDraftKey(FORM, formDraftScope({ token: TOKEN })),
    handoffSeenKey("order", RSVP),
    PENDING_FORM_ROUTE_KEY,
    FORM_CAPABILITY_KEY,
  ])("%s is swept", (key) => {
    expect(swept(key)).toBe(true);
  });
});

describe("#4541 T-32 — draft keys", () => {
  it("names the form, the context and the subject", () => {
    expect(formDraftKey(FORM, formDraftScope({ eventId: EVENT, as: "rsvp", sid: RSVP })))
      .toBe(`${FORM_DRAFT_PREFIX}${FORM}:${EVENT}:rsvp:${RSVP}`);
    expect(formDraftScope({})).toBe("none:user:self");
  });

  it("a link scope uses 12 hex of SHA-256 of the token, never the token", () => {
    const scope = formDraftScope({ eventId: EVENT, token: TOKEN });
    expect(scope).toBe(`${EVENT}:link:${sha256Hex(TOKEN).slice(0, 12)}`);
    expect(scope).not.toContain(TOKEN);
    expect(scope).not.toContain(TOKEN.slice(0, 12));
  });

  it("the hash is real SHA-256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("#4541 T-32 — draft lifetime", () => {
  const now = 1_800_000_000_000;

  it("a draft 13 days old is restored; 15 days old is discarded and removed", async () => {
    const key = formDraftKey(FORM, "none:user:self");
    await writeFormDraft(key, "v1", { q: "hello" }, now - 13 * 86_400_000);
    expect((await readFormDraft(key, now))?.answers).toEqual({ q: "hello" });
    await writeFormDraft(key, "v1", { q: "hello" }, now - 15 * 86_400_000);
    expect(await readFormDraft(key, now)).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it("parseDraft refuses malformed values and honours exactly 14 days", () => {
    expect(parseDraft("not json", now)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, answers: {}, savedAt: now }), now)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, answers: {}, savedAt: now - FORM_DRAFT_MAX_AGE_MS }), now)).not.toBeNull();
  });

  it("keeps at most 20 drafts, evicting the oldest", async () => {
    for (let i = 0; i < 22; i += 1) {
      await writeFormDraft(formDraftKey(FORM, `none:user:${i}`), null, { q: String(i) }, now + i);
    }
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(FORM_DRAFT_PREFIX));
    expect(keys).toHaveLength(20);
    expect(keys).not.toContain(formDraftKey(FORM, "none:user:0"));
    expect(keys).not.toContain(formDraftKey(FORM, "none:user:1"));
    expect(keys).toContain(formDraftKey(FORM, "none:user:21"));
  });
});

describe("#4541 R2.3 — the route held through sign-in", () => {
  it("never keeps the personal token (Q7: signing in answers as yourself)", async () => {
    await setPendingFormRoute(`/form/${FORM}?event=${EVENT}&t=${TOKEN}&from=link`);
    const held = await takePendingFormRoute();
    expect(held).toBe(`/form/${FORM}?event=${EVENT}&from=link`);
    expect(await takePendingFormRoute()).toBeNull();
    expect(stripFormToken(`/form/${FORM}?t=${TOKEN}`)).toBe(`/form/${FORM}`);
  });

  it("only form routes are held", async () => {
    await setPendingFormRoute("/purchases");
    expect(await takePendingFormRoute()).toBeNull();
  });
});
