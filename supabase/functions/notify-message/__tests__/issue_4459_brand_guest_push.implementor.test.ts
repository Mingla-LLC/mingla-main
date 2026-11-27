// MINGLA-INVARIANT: I-4459-GUEST-CHAT-PUSH | issue #4459 | in a brand Guest chat a brand post pushes every unmuted guest (in batches of 100, one idempotency key per message and recipient); a guest post pushes only the tagged and replied-to members; muted, blocked and departed people and the sender never get a push; recipients and preview come from the database, never from the app
//
// FAILS-ON-REVERT: remove the brand_guests branch in handleUnifiedMessage (it
// falls back to the whole-roster fan-out) and the source checks fail; break
// brandGuestsRecipients and the unit checks fail.
import {
  BRAND_GUESTS_PUSH_CHUNK,
  brandGuestsIdempotencyKey,
  brandGuestsPushCopy,
  brandGuestsRecipients,
  chunked,
  resolveReplyAuthor,
  storedMentionUserIds,
  type BrandGuestsMember,
} from "../messageKeys.ts";

function equals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HOST = id(1);
const COHOST = id(2);
const ANA = id(10);
const BEN = id(11);
const CY = id(12);
const DEE = id(13);

const roster: BrandGuestsMember[] = [
  { userId: HOST, muted: false, isTeam: true },
  { userId: COHOST, muted: false, isTeam: true },
  { userId: ANA, muted: false, isTeam: false },
  { userId: BEN, muted: true, isTeam: false },
  { userId: CY, muted: false, isTeam: false },
  { userId: DEE, muted: false, isTeam: false },
];

Deno.test("#4459 a brand post pushes every unmuted guest, never the team or the sender", () => {
  equals(
    brandGuestsRecipients({ senderId: HOST, senderKind: "brand", mentionedUserIds: [], members: roster, blockedWithSender: new Set() }),
    [ANA, CY, DEE],
    "unmuted guests only",
  );
  equals(
    brandGuestsRecipients({ senderId: HOST, senderKind: "brand", mentionedUserIds: [], members: roster, blockedWithSender: new Set([CY]) }),
    [ANA, DEE],
    "no push crosses a block",
  );
});

Deno.test("#4459 a guest post pushes only the tagged and replied-to people, and zero others", () => {
  equals(
    brandGuestsRecipients({ senderId: ANA, senderKind: "guest", mentionedUserIds: [], members: roster, blockedWithSender: new Set() }),
    [],
    "an ordinary guest message pushes nobody (team included)",
  );
  equals(
    brandGuestsRecipients({ senderId: ANA, senderKind: "guest", replyToAuthorId: CY, mentionedUserIds: [DEE, HOST], members: roster, blockedWithSender: new Set() }),
    [CY, DEE, HOST],
    "reply author and tags, the team only when tagged",
  );
  equals(
    brandGuestsRecipients({ senderId: ANA, senderKind: "guest", replyToAuthorId: BEN, mentionedUserIds: [id(99), ANA, CY, CY], members: roster, blockedWithSender: new Set([CY]) }),
    [],
    "muted, departed (not in the roster), self, blocked and duplicates are skipped",
  );
  const eleven = Array.from({ length: 11 }, (_, i) => id(100 + i));
  const big = [...roster, ...eleven.map((userId) => ({ userId, muted: false, isTeam: false }))];
  equals(
    brandGuestsRecipients({ senderId: ANA, senderKind: "guest", mentionedUserIds: eleven, members: big, blockedWithSender: new Set() }).length,
    10,
    "mentions capped at 10",
  );
});

Deno.test("#4459 stored mentions, batches, keys and copy", () => {
  equals(storedMentionUserIds([{ userId: ANA.toUpperCase() }, { userId: "junk" }, null, { displayName: "x" }, { userId: ANA }]), [ANA], "uuid mentions, deduped");
  equals(storedMentionUserIds("not an array"), [], "junk mentions value");
  const many = Array.from({ length: 250 }, (_, i) => id(1000 + i));
  equals(chunked(many, BRAND_GUESTS_PUSH_CHUNK).map((batch) => batch.length), [100, 100, 50], "batches of 100");
  equals(brandGuestsIdempotencyKey("m1", ANA), `brand_guests:m1:${ANA}`, "one key per message and recipient");
  equals(brandGuestsPushCopy({ brandName: "Lagos Vibes", senderKind: "brand", senderDisplayName: "Lagos Vibes", preview: "Doors at 8", recipientIsTeam: true }),
    { title: "Lagos Vibes Guests", body: "Doors at 8" }, "brand post copy");
  equals(brandGuestsPushCopy({ brandName: "Lagos Vibes", senderKind: "guest", senderDisplayName: "Ana", preview: "see you", recipientIsTeam: true }),
    { title: "Lagos Vibes Guests", body: "Ana: see you" }, "tag or reply copy");
});

Deno.test("#4459 notify-message routes Guest chats to the brand_guests handler", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const unified = source.slice(source.indexOf("async function handleUnifiedMessage("), source.indexOf("async function handleUnifiedMention("));
  const branch = unified.indexOf('conv.linked_entity_type === "brand_guests"');
  const rosterRead = unified.indexOf('.from("conversation_participants")');
  if (branch < 0 || rosterRead < 0 || branch > rosterRead) {
    throw new Error("the brand_guests branch must run before the whole-roster fan-out");
  }
  const mention = source.slice(source.indexOf("async function handleUnifiedMention("), source.indexOf("serve("));
  if (!mention.includes('conv?.linked_entity_type === "brand_guests"')) {
    throw new Error("a client mention list must never push in a Guest chat");
  }
  const handler = source.slice(source.indexOf("async function handleBrandGuestsMessage("), source.indexOf("async function handleUnifiedMessage("));
  for (const needle of ['.from("messages")', "message.sender_id !== senderId", "message.conversation_id !== conv.id", "brandGuestsIdempotencyKey", "chunked(recipients, BRAND_GUESTS_PUSH_CHUNK)",
    '.from("brand_guest_post_authors")', "actorId: fromBrand ? null : senderId"]) {
    if (!handler.includes(needle)) throw new Error(`brand_guests handler is missing: ${needle}`);
  }
  if (handler.includes("messagePreview")) throw new Error("the app's preview must not be used");
});

Deno.test("#4459 D2 a reply to a brand post reaches the team member who wrote it", async () => {
  const lookups: string[] = [];
  const lookup = async (id: string) => {
    lookups.push(id);
    return id === "brand-post" ? HOST : null;
  };
  equals(await resolveReplyAuthor({ id: "brand-post", sender_id: null, sender_kind: "brand" }, lookup), HOST, "author from the team-only table");
  equals(await resolveReplyAuthor({ id: "g", sender_id: ANA, sender_kind: "guest" }, lookup), ANA, "a guest post's sender");
  equals(await resolveReplyAuthor({ id: "sys", sender_id: null, sender_kind: null }, lookup), null, "a system row has no author");
  equals(await resolveReplyAuthor(null, lookup), null, "no reply");
  equals(lookups, ["brand-post"], "only brand posts are looked up");
  equals(
    brandGuestsRecipients({ senderId: ANA, senderKind: "guest", replyToAuthorId: HOST, mentionedUserIds: [], members: roster, blockedWithSender: new Set() }),
    [HOST],
    "the replying guest pushes the brand post's author",
  );
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  if (!source.includes("const replyToAuthorId = await resolveReplyAuthor(repliedTo,")) throw new Error("the handler must resolve the reply author");
});

// #4630 (Q3, A1): guests see "<Brand>"; a brand team member keeps "<Brand> Guests"
// (the Host app tells its Team and Guests chats apart by it). FAILS-ON-REVERT:
// title every recipient the same way and one of these cases fails.
Deno.test("#4630 push title per recipient: guests get <Brand>, the team keeps <Brand> Guests", () => {
  equals(brandGuestsPushCopy({ brandName: "Lagos Vibes", senderKind: "brand", senderDisplayName: null, preview: "Doors at 8", recipientIsTeam: false }),
    { title: "Lagos Vibes", body: "Doors at 8" }, "a brand post reaches a guest titled with the brand alone");
  equals(brandGuestsPushCopy({ brandName: "Lagos Vibes", senderKind: "guest", senderDisplayName: "Ana", preview: "@Host see you", recipientIsTeam: true }),
    { title: "Lagos Vibes Guests", body: "Ana: @Host see you" }, "a guest reply that tags the host reaches the host as <Brand> Guests");
  equals(brandGuestsPushCopy({ brandName: "Lagos Vibes", senderKind: "guest", senderDisplayName: "Ana", preview: "hi Cy", recipientIsTeam: false }),
    { title: "Lagos Vibes", body: "Ana: hi Cy" }, "a guest tag reaches another guest as <Brand>");
  equals(brandGuestsPushCopy({ brandName: "  ", senderKind: "brand", senderDisplayName: null, preview: "x", recipientIsTeam: false }).title,
    "Mingla", "no brand name: a guest sees Mingla, never Guests");
  equals(brandGuestsPushCopy({ brandName: null, senderKind: "brand", senderDisplayName: null, preview: "x", recipientIsTeam: true }).title,
    "Guests", "no brand name: the team keeps Guests");
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  const handler = source.slice(source.indexOf("async function handleBrandGuestsMessage("), source.indexOf("async function handleUnifiedMessage("));
  if (!handler.includes("recipientIsTeam: team.has(recipientId)")) {
    throw new Error("the push copy must be built per recipient from the team set");
  }
  if (/const copy = brandGuestsPushCopy\(\{/.test(handler)) {
    throw new Error("one shared copy for every recipient is the #4630 regression");
  }
});
