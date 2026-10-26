// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2 (evidence 09f, 09m): the Plans sheet inside
// the dark chat and the Chats tab's country picker were light.
//
// The country picker is darkened only for the Chats tab: the #2322 suites pin
// DateTimePicker theming (not this picker), and the picker gate
// (orch-1371-1372) pins where the picker is mounted, not its colours, so
// neither forbids it. Onboarding, settings and the pair request stay light.
//
// FAILS-ON-REVERT: put the Plans sheet back on the light surface or drop the
// dark tone from the Chats tab picker, and a case fails.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("QA run 2: the Plans sheet is dark", async () => {
  const banners = strip(await read("components/chat/CollabSessionChatBanners.tsx"));
  const plans = banners.slice(banners.indexOf('title={t("chat:plansTitle")}'), banners.indexOf('title={t("chat:plansTitle")}') + 400);
  assert(/tone="dark"/.test(plans), "Plans asks for the dark sheet");
  assert(/const sheetTheme = dark \? "dark" : "light";/.test(banners), "dark tone uses the dark sheet theme");
  assert(/compactSheetBackgroundDark: \{\s*backgroundColor: chatTokens\.surface,/.test(banners), "dark surface");
  const styles = banners.slice(banners.indexOf("const styles = StyleSheet.create("));
  for (const name of ["scheduleRow", "cardTitle", "cardMeta", "planGroupHeading", "emptyText"]) {
    const block = styles.slice(styles.indexOf(`${name}: {`), styles.indexOf("}", styles.indexOf(`${name}: {`)));
    assert(!/#(fffbeb|fde68a|111827|6b7280)/i.test(block), `${name} has no light-card colour`);
  }
});

// QA run 2 follow-up: the Matches sheet uses the same shell as Plans and was
// still light; it asks for the dark tone and so does its card deck, while the
// session view's deck keeps the light default.
Deno.test("QA run 2: the Matches sheet is dark", async () => {
  const banners = strip(await read("components/chat/CollabSessionChatBanners.tsx"));
  const at = banners.indexOf('title="Matches"');
  const matches = banners.slice(at, banners.indexOf("</CompactCollabBottomSheet>", at));
  assert(/snapPoints=\{MATCHES_SHEET_SNAP_POINTS\}\s*tone="dark"/.test(matches), "Matches asks for the dark sheet");
  assert(/<SwipeableSessionCards[\s\S]*?tone="dark"\s*\/>/.test(matches), "the deck inside it is dark");

  const deck = strip(await read("components/board/SwipeableSessionCards.tsx"));
  assert(/tone = "light",\s*\}\) => \{\s*const dark = tone === "dark";/.test(deck), "light by default");
  assert(/style=\{\[styles\.container, dark && styles\.containerDark\]\}/.test(deck), "dark deck surface");
  assert(/containerDark: \{ backgroundColor: chatTokens\.surface \}/.test(deck), "same surface token as Plans");
  for (const [base, dark] of [
    ["emptyText", "emptyTextDark"], ["emptySubtext", "emptySubtextDark"], ["cardCountText", "cardCountTextDark"],
    ["categoryText", "categoryTextDark"], ["description", "descriptionDark"],
  ]) {
    assert(deck.includes(`styles.${base}, dark && styles.${dark}`), `${base} follows the tone`);
    const block = deck.slice(deck.indexOf(`${dark}: {`), deck.indexOf("}", deck.indexOf(`${dark}: {`)));
    assert(/color: chatTokens\.text(Primary|Secondary|Soft|Muted)/.test(block), `${dark} uses a chat text token`);
  }

  const session = strip(await read("components/SessionViewModal.tsx"));
  const sessionDeck = session.slice(session.indexOf("<SwipeableSessionCards"), session.indexOf("/>", session.indexOf("<SwipeableSessionCards")));
  assert(!/tone="dark"/.test(sessionDeck), "the session view's deck stays light");
});

Deno.test("QA run 2: the Chats tab country picker is dark, other callers stay light", async () => {
  const wrapper = strip(await read("components/onboarding/CountryPickerModal.tsx"));
  assert(/theme=\{tone === "dark" \? CHAT_DARK_COUNTRY_PICKER_THEME : undefined\}/.test(wrapper), "tone maps to the dark theme");
  assert(/backgroundPrimary: chatTokens\.surface,/.test(wrapper), "dark surface");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/<CountryPickerModal\s+visible=\{addFriendPickerOpen\}[\s\S]*?tone="dark"\s*\/>/.test(page), "Chats tab asks for dark");
  for (const path of ["components/OnboardingFlow.tsx", "components/profile/AccountSettings.tsx", "components/PairRequestModal.tsx"]) {
    const src = strip(await read(path));
    assert(!/tone="dark"/.test(src.slice(src.indexOf("<CountryPickerModal"), src.indexOf("<CountryPickerModal") + 400)), `${path} stays light`);
  }
});
