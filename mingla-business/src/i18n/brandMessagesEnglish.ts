// #4420: Host Messages' English words (one thread per brand, the Guests side,
// links and Select text), kept out of the bundle every Host app screen loads,
// the same way as the plan (brandPlanEnglish.ts) and the Mingla team screens.
// Loaded on intent through ensureMessagesEnglish() (LazyGroupChatPanel.tsx), so
// the Messages chunk and the Guest chat chunk never share it statically. Other
// languages carry these words in their own lazy files already.
import english from "./locales/en/brandGroupMedia.json";
import messagesEnglish from "./locales/en/brandMessages.json";

type Copy = Record<string, Record<string, string> | string>;

export function addMessagesEnglish(): void {
  const copy = english as unknown as Copy;
  const current = copy.messages;
  copy.messages = { ...(typeof current === "object" ? current : {}), ...messagesEnglish.messages };
}
