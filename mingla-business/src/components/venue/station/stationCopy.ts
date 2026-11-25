/**
 * #4490 spec 08 O3 — every word on the kitchen and bar screens (plain English,
 * no vendor names). Spec strings are marked S; design strings D; new N (for
 * Seth, listed in the O3 report).
 */
export const STATION_COPY = {
  // Start service (spec §2 screen 11)
  startTitle: "Start service", // S
  startBody: "Pick what this screen shows. This tap also lets it play sound.", // D
  kitchen: "Kitchen", // D
  bar: "Bar", // D
  everything: "Everything", // D
  kitchenSub: "Food only", // D
  barSub: "Drinks only", // D
  everythingSub: "Kitchen and bar together", // D
  noStationHere: (n: number): string => `${n} ${n === 1 ? "item has" : "items have"} no station and ${n === 1 ? "goes" : "go"} here`, // D
  playTestSound: "Play test sound", // S
  testSoundPlayed: "Test sound played.", // N
  printTestTicket: "Print a test ticket", // S
  printReceipt: "Print receipt", // S
  startService: "Start service", // S
  keepOpenLong: "Keep this screen open for sound. When it's locked or in the background, the order notification is the alert.", // D
  keepOpen: "Keep this screen open for sound", // S
  close: "Close", // D (sheets)
  // Board (spec §2 screen 12)
  colNew: "New", // S
  colCooking: "Cooking", // S
  colReady: "Ready", // S
  emptyNew: (station: string): string => `No orders for the ${station}`, // S
  emptyNewAll: "No orders right now", // N
  emptyCooking: "Nothing cooking", // D
  emptyReady: "Nothing waiting to go out", // D
  live: "Live", // D
  reconnecting: "Reconnecting", // D
  reconnectingTitle: "Reconnecting…", // D
  reconnectingBody: "New orders will appear as soon as we're back. Keep this screen open.", // D
  newOrder: (destination: string): string => `New order · ${destination}`, // S + D
  newOrderBody: "The sound repeats every 20 seconds until someone accepts it.", // D
  accept: "Accept", // S
  ready: "Ready", // S
  itemReady: (name: string): string => `${name} ready`, // D (a11y)
  pickedUp: "Picked up", // S (T5)
  recall: "Recall to cooking", // S (T5)
  print: "Print", // S
  printTicket: "Print ticket", // D (a11y)
  printed: (n: number): string => `Printed ×${n}`, // S + D
  makingPdf: "Making the ticket…", // N
  pdfFailed: "Couldn't make the ticket. Try again", // S
  tryAgain: "Try again", // D
  guestOrder: "Guest order", // D
  isNew: "new", // D
  told: (name: string): string => `${name} was told`, // S (T5)
  guestTold: "guest's page says Ready", // S (T5)
  movedFrom: (label: string): string => `Moved from ${label}`, // S (T9)
  voidedBy: (name: string | null, time: string | null): string =>
    `Voided${name ? ` by ${name}` : ""}${time ? ` · ${time}` : ""}`, // S + D
  readyAt: (time: string): string => `Ready ${time}`, // S (T5)
  alreadyAccepted: (name: string | null): string => `${name ?? "Someone"} already accepted this.`, // S (T14)
  // Sound
  mute: "Mute", // D
  muteTitle: "Mute the sound", // D
  muteBody: "New orders still flash while muted.", // D
  mute15: "Mute for 15 min", // S
  mute60: "Mute for 1 hour", // S
  muteFoot: "Sound always comes back on by itself, and after a restart.", // D
  soundOffUntil: (time: string): string => `Sound off until ${time}`, // S
  soundOffBody: "New orders still flash.", // D
  turnSoundOn: "Turn sound on", // S
  soundLockedTitle: "Tap to turn sound on", // S (T17)
  soundLockedBody: "This page was reloaded, so the browser muted it. Orders still appear and flash.", // S (T17)
  needsAppTitle: "Sound needs the latest app", // S
  needsAppBody: "Orders still appear and flash. Update the app to hear them.", // D
  soundBlocked: "This browser blocked the sound. Tap Turn sound on to try again.", // N
  // Loading / errors
  loading: "Loading the orders…", // N
  loadFailedTitle: "Couldn't load the orders", // N
  loadFailedBody: "Check your connection and try again.", // N
  offTitle: "Kitchen and bar screens are off here", // N
  offBody: "Turn on Kitchen and bar screens in Settings › Features to use this screen.", // N
  noAccessTitle: "This screen isn't for your login", // N
  noAccessBody: "Ask a brand owner or admin to give you kitchen access at this venue.", // N
  back: "Back to the venue", // N
  openStations: "Kitchen and bar", // D (rail / entry label)
} as const;

const STATION_ERROR_COPY: Record<string, string> = {
  not_authorized: "You can't work this station. Ask a brand owner or admin for kitchen access.",
  stations_not_enabled: "Kitchen and bar screens are off at this venue.",
  station_ticket_not_found: "That order isn't on this screen any more.",
  station_ticket_closed: "That order was voided or finished, so nothing changed.",
  station_ticket_not_ready: "Mark it Ready first.",
  station_invalid: "Pick Kitchen, Bar or Everything.",
  floor_pdf_failed: STATION_COPY.pdfFailed,
  floor_pdf_not_found: "That ticket isn't at this venue any more.",
  floor_pdf_not_ready: "The receipt is made once the payment is taken.",
  floor_pdf_kind_not_ready: "Printing the day's close comes with Close the day.",
  floor_pdf_popup_blocked: "Your browser blocked the new tab. Allow pop-ups for this site, then print again.",
  till_not_enabled: "Selling in person is off at this venue.",
  auth_required: "Sign in again to keep this screen running.",
  network: "No connection. Orders will appear when you're back online.",
};

/** Every refusal in words; an unknown code is the generic line, never the code. */
export function stationErrorCopy(code: string): string {
  return STATION_ERROR_COPY[code] ?? "That didn't go through. Try again.";
}

export const STATION_ERROR_CODES: readonly string[] = Object.keys(STATION_ERROR_COPY);
