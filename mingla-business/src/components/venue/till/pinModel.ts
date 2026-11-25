/**
 * #4490 spec 08 O5 part A — pure display rules for PINs on a shared Till
 * (Who's selling?, the PIN pad, step-up, PIN setup). Copy is the spec's
 * (§3 O5 Copy, §2 screens 1, 13, 14); new lines are listed for Seth.
 */

/** One person on "Who's selling?" (the server's list; venueTillService maps it). */
export interface TillPinPerson {
  memberId: string;
  /** #4490 after #4579: a Mingla admin is "<name> from Mingla" (or "Mingla Team"), never an email. */
  name: string;
  /** #4579: an auto-added Mingla admin (full Brand admin parity: may hold a PIN, sell, approve). */
  isMinglaTeam?: boolean;
  role: string;
  profile: string | null;
  canSell: boolean;
  canApprove: boolean;
  canManage: boolean;
}

export const PIN_COPY = {
  whoSelling: "Who's selling?",
  tapYourName: "Tap your name, then your PIN.",
  enterPin: "Enter your PIN",
  enterAgainToConfirm: "Enter your PIN again to confirm",
  locked: "Locked for 5 minutes",
  lockedBody: (time: string): string => `Too many wrong PINs. Try again at ${time}, or let someone else sell.`,
  hardLocked: "Ask a manager to unlock your PIN",
  hardLockedBody: "Too many wrong tries today. A manager can reset it in Team from their own sign-in.",
  deviceLimited: "Too many tries on this device. Wait 10 minutes, or ask a manager.",
  noRights: "This needs someone with money rights. Pick who's approving.",
  nobody: "Nobody has a PIN yet",
  nobodyBody: "Ask a manager to set one up in Team.",
  backToWho: "Back to Who's selling",
  notYou: (name: string): string => `Not ${name}? Go back`,
  idleTitle: (minutes: number): string => `Locked after ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
  idleBody: "Pick who's selling to carry on.",
  lostTitle: "Switch in again",
  lostBody: "This PIN session ended. Pick who's selling to carry on.",
  sellerChip: (name: string): string => `${name} is selling`,
  switchSeller: "Switch",
  tillDevice: "Till device",
  tillDeviceFooter: (venue: string): string => `Till device · ${venue}`,
  tillDeviceExplainer: "This login stays signed in on a shared phone or tablet. Staff switch with their PIN.",
  signOut: "Sign this device out",
  signOutWho: "Who's signing this Till out?",
  signOutManagerHint: "A manager's PIN signs this Till out.",
  signOutEmailTitle: "Sign this Till out with its email code",
  signOutEmailBody: "Nobody here who manages the venue has a PIN yet, so we'll email a code to this Till's login.",
  sendCode: "Email me a code",
  codeLabel: "Code from the email",
  confirmSignOut: "Sign out",
  codeWrong: "That code didn't work. Check the email and try again.",
  whoApproves: "Who's approving?",
  approveHint: "Only people with money rights can approve. The seller stays switched in.",
  ok: "OK",
  cancel: "Cancel",
  deleteDigit: "Delete",
  loadFailed: "Couldn't load who's selling",
  loadFailedBody: "Check your connection and try again.",
  retry: "Try again",
  // PIN setup (Team › member, §2 screen 13)
  tillPin: "Till PIN",
  choosePin: "Choose your Till PIN",
  enterItAgain: "Enter it again",
  choosePinHint: "4 to 6 digits. You'll use it to switch in on a shared Till.",
  weak: "Pick a PIN that's harder to guess. Not 1234, 0000 or one digit repeated.",
  mismatch: "Those PINs don't match. Start again.",
  saved: "PIN saved",
  setPin: "Set your PIN",
  changePin: "Change your PIN",
  noPinYet: "No PIN yet",
  pinSetOn: (date: string): string => `Set ${date}`,
  pinHardLockedRow: "Locked until a manager resets it",
  resetPin: (name: string): string => `Reset ${name}'s PIN`,
  resetDone: "PIN reset. They set a new one from their own sign-in.",
  resetHint: "Only from your own sign-in. A PIN session on the Till can never reset PINs, change the team or touch payouts.",
} as const;

export type PinFailure = { code: string; triesLeft: number | null; lockedUntil: string | null };

/** 24-hour "21:19" in the device's own clock (no Intl.formatToParts). */
export function pinClock(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function wrongPinCopy(triesLeft: number | null): string {
  if (triesLeft === null) return "Wrong PIN. Try again.";
  return triesLeft === 1 ? "Wrong PIN. 1 try left" : `Wrong PIN. ${triesLeft} tries left`;
}

/** What the PIN pad says after a refusal; null for codes the pad does not own. */
export function pinRetryMessage(failure: PinFailure): string | null {
  switch (failure.code) {
    case "pin_wrong":
      return wrongPinCopy(failure.triesLeft);
    case "pin_locked":
      return `${PIN_COPY.locked}. ${PIN_COPY.lockedBody(pinClock(failure.lockedUntil))}`;
    case "pin_hard_locked":
      return PIN_COPY.hardLocked;
    case "pin_device_limited":
      return PIN_COPY.deviceLimited;
    case "pin_no_rights":
      return PIN_COPY.noRights;
    default:
      return null;
  }
}

/** The Who's selling screen state after an unlock refusal. */
export type WhoState =
  | { kind: "faces" }
  | { kind: "pin"; memberId: string; error: string | null }
  | { kind: "locked"; memberId: string; until: string | null }
  | { kind: "hard"; memberId: string };

export function whoStateAfter(memberId: string, failure: PinFailure): WhoState {
  if (failure.code === "pin_locked") return { kind: "locked", memberId, until: failure.lockedUntil };
  if (failure.code === "pin_hard_locked") return { kind: "hard", memberId };
  return { kind: "pin", memberId, error: pinRetryMessage(failure) ?? wrongPinCopy(null) };
}

/** Faces on Who's selling?: people who may sell here (with a PIN, server-filtered). */
export function sellerFaces(people: readonly TillPinPerson[]): TillPinPerson[] {
  return people.filter((p) => p.canSell);
}

/** Who may approve a refund or a sent void on the spot (money rights). */
export function approvers(people: readonly TillPinPerson[]): TillPinPerson[] {
  return people.filter((p) => p.canApprove);
}

/** Who may sign the Till device out (manager rights). */
export function signOutManagers(people: readonly TillPinPerson[]): TillPinPerson[] {
  return people.filter((p) => p.canManage);
}

/** Mirror of the server's issue_4490_pin_is_weak (the server decides). */
export function pinIsWeak(pin: string): boolean {
  if (!/^[0-9]{4,6}$/.test(pin)) return true;
  let up = true;
  let down = true;
  let same = true;
  for (let i = 1; i < pin.length; i += 1) {
    const d = Number(pin[i]);
    const prev = Number(pin[i - 1]);
    if (d !== prev + 1) up = false;
    if (d !== prev - 1) down = false;
    if (d !== prev) same = false;
  }
  return up || down || same;
}

export const PIN_MAX_DIGITS = 6;
export const PIN_MIN_DIGITS = 4;

/** Typing on the pad: digits only, at most six. */
export function pinAppend(pin: string, digit: string): string {
  if (!/^[0-9]$/.test(digit) || pin.length >= PIN_MAX_DIGITS) return pin;
  return pin + digit;
}

/**
 * #4490 08-O5 fix 4: what a physical key does on a web PIN pad: a digit
 * (0-9, the number row or the keypad), Backspace removes one, Enter is OK.
 * Anything else (and any key with Ctrl, Alt or Cmd held) is not the pad's.
 */
export type PinKeyAction = { kind: "digit"; digit: string } | { kind: "back" } | { kind: "submit" };
export function pinKeyAction(key: string, modified = false): PinKeyAction | null {
  if (modified) return null;
  if (/^[0-9]$/.test(key)) return { kind: "digit", digit: key };
  if (key === "Backspace") return { kind: "back" };
  if (key === "Enter") return { kind: "submit" };
  return null;
}

export function pinComplete(pin: string): boolean {
  return pin.length >= PIN_MIN_DIGITS && pin.length <= PIN_MAX_DIGITS && /^[0-9]+$/.test(pin);
}

/** Initials for a face ("Ada Okafor" → "AO"). */
export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A role line under a face. */
export function personRole(p: TillPinPerson): string {
  switch (p.profile ?? p.role) {
    case "restaurant_manager":
      return "Venue manager";
    case "front_desk":
      return "Front desk";
    case "kitchen_bar":
      return "Kitchen / bar";
    case "brand_owner":
      return "Owner";
    case "brand_admin":
      return "Admin";
    case "finance_manager":
      return "Finance";
    case "event_manager":
      return "Manager";
    default:
      return "Team";
  }
}

/**
 * #4490 08-O5 fix 5: a Mingla admin's name reads "<public name> from Mingla"
 * (the server's issue_4490_staff_name). On a narrow face the words "from
 * Mingla" are the Mingla mark and must stay visible, so the name is split:
 * the person's part may be shortened, the mark never is. "Mingla Team" and
 * every other name are left whole.
 */
export const MINGLA_MARK = "from Mingla";
export function splitMinglaMark(person: { name: string; isMinglaTeam?: boolean }): { name: string; mark: string | null } {
  const suffix = ` ${MINGLA_MARK}`;
  if (person.isMinglaTeam === true && person.name.endsWith(suffix) && person.name.length > suffix.length) {
    return { name: person.name.slice(0, -suffix.length), mark: MINGLA_MARK };
  }
  return { name: person.name, mark: null };
}
