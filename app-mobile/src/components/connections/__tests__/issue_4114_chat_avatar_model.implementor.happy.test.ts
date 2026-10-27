// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 — chat list avatars show the real photo or logo for every kind of
// chat: the friend's photo, the other members' photos (never yours), the event
// cover then the brand logo, the brand logo for a brand channel, initials last.
//
// FAILS-ON-REVERT: drop the brand-logo fallback on events, render a video
// cover as an image, put yourself in a group cluster, cap the group at two
// faces with no "+N", or drop the list/avatar wiring, and the matching case
// fails.

import { chatAvatarSpec } from "../chatListModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const me = { id: "me", name: "Seth O", avatarUrl: "https://x/me.jpg" };
const ife = { id: "ife", name: "Ife A", avatarUrl: "https://x/ife.jpg" };
const tobi = { id: "tobi", name: "Tobi B", avatarUrl: null };
const ada = { id: "ada", name: "Ada C", avatarUrl: "https://x/ada.jpg" };
const kemi = { id: "kemi", name: "Kemi D", avatarUrl: "https://x/kemi.jpg" };
const base = { currentUserId: "me", label: "Label" };

Deno.test("1:1 chats show the friend, never you", () => {
  for (const kind of ["direct", "direct_collab"]) {
    const spec = chatAvatarSpec({ ...base, kind, participants: [me, ife] });
    assertEquals(spec.shape, "circle", `${kind} shape`);
    assertEquals(spec.people.map((p) => p.avatarUrl), ["https://x/ife.jpg"], `${kind} uses the friend's photo`);
  }
});

Deno.test("groups show the other members' photos and never you", () => {
  const two = chatAvatarSpec({ ...base, kind: "group", participants: [me, ife, tobi] });
  assertEquals([two.shape, two.people.map((p) => p.id), two.extraCount], ["group", ["ife", "tobi"], 0], "two others overlap");
  const three = chatAvatarSpec({ ...base, kind: "group", participants: [ife, me, tobi, ada] });
  assertEquals([three.people.map((p) => p.id), three.extraCount], [["ife", "tobi", "ada"], 0], "three others in a triangle");
  const more = chatAvatarSpec({ ...base, kind: "group", participants: [me, ife, tobi, ada, kemi] });
  assertEquals([more.people.map((p) => p.id), more.extraCount], [["ife", "tobi"], 2], "two photos plus +N");
  for (const spec of [two, three, more]) {
    assert(!spec.people.some((p) => p.id === "me"), "you are never in your own group avatar");
  }
  assertEquals(tobi.avatarUrl, null, "a member without a photo is passed through for per-person initials");
  const solo = chatAvatarSpec({ ...base, kind: "group", participants: [me, ife] });
  assertEquals([solo.shape, solo.people.map((p) => p.id)], ["circle", ["ife"]], "one other is a single photo");
});

Deno.test("event rows: cover, then brand logo, then initials; never a video", () => {
  const event = { ...base, kind: "event", participants: [me, ife] };
  assertEquals(
    chatAvatarSpec({ ...event, eventCoverUrl: "https://x/cover.jpg", eventCoverMediaType: "image", eventBrandLogoUrl: "https://x/logo.png" }).coverUrls,
    ["https://x/cover.jpg", "https://x/logo.png"],
    "cover first, logo as the fallback",
  );
  assertEquals(
    chatAvatarSpec({ ...event, eventCoverUrl: "https://x/cover.m3u8", eventCoverMediaType: "video", eventBrandLogoUrl: "https://x/logo.png" }).coverUrls,
    ["https://x/logo.png"],
    "a video cover is skipped for the logo",
  );
  const bare = chatAvatarSpec({ ...event, eventCoverUrl: null, eventBrandLogoUrl: "" });
  assertEquals([bare.shape, bare.coverUrls, bare.label], ["square", [], "Label"], "nothing stored: initials in the square");
});

Deno.test("brand channels show the brand logo; enquiries the logo when they carry one", () => {
  const channel = chatAvatarSpec({ ...base, kind: "brand_channel", participants: [], brandLogoUrl: "https://x/logo.png" });
  assertEquals([channel.shape, channel.coverUrls], ["square", ["https://x/logo.png"]], "brand logo");
  const noLogo = chatAvatarSpec({ ...base, kind: "brand_channel", participants: [], brandLogoUrl: null });
  assertEquals([noLogo.shape, noLogo.coverUrls], ["square", []], "brand initials in the rounded square");
  const enquiry = chatAvatarSpec({ ...base, kind: "enquiry", participants: [me, ife], eventBrandLogoUrl: "https://x/logo.png" });
  assertEquals([enquiry.shape, enquiry.coverUrls], ["square", ["https://x/logo.png"]], "enquiry with a brand logo");
  const enquiryPerson = chatAvatarSpec({ ...base, kind: "enquiry", participants: [me, ife] });
  assertEquals([enquiryPerson.shape, enquiryPerson.people.map((p) => p.id)], ["circle", ["ife"]], "enquiry without one");
});

const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("the list row and the avatar wire the spec and the fallbacks", async () => {
  const row = await read("ChatListItem.tsx");
  assert(/const avatar = chatAvatarSpec\(\{/.test(row), "the row asks the model");
  assert(/coverUrls=\{avatar\.coverUrls\}/.test(row) && /extraCount=\{avatar\.extraCount\}/.test(row), "the row passes covers and +N");
  assert(/eventBrandLogoUrl: conversation\.eventBrandLogoUrl/.test(row), "the event's brand logo reaches the model");
  const avatar = await read("ChatAvatar.tsx");
  assert(/import \{ Image \} from "expo-image"/.test(avatar), "photos load through expo-image (cached)");
  assert(/onError=\{\(\) => setFailedUrl\(avatarUrl\)\}/.test(avatar), "a broken person photo falls back to initials");
  assert(/find\(\(url\) => !failedCovers\.includes\(url\)\)/.test(avatar), "a broken cover falls back to the next image");
  assert(/`\+\$\{/.test(avatar), "the group cluster draws +N");
});
