/**
 * Help-centre video registry (#help-video-centre).
 *
 * Mirrors `content/cities/registry.ts`: one typed record per video, consumed by
 * the route registry, `generateStaticParams`, metadata and VideoObject schema.
 *
 * `bambooEntryId` is the Bamboo Cloud entry. The HLS ladder is public per entry,
 * so the site plays it through its own player rather than Bamboo's iframe —
 * keeping the cutout surface intact and giving every video a real URL.
 * A record with `bambooEntryId: null` renders the poster + "coming soon" state,
 * so the page ships before every scene is recorded.
 */

export const HELP_CHAPTERS = [
  {
    id: 'getting-started',
    label: 'Getting started',
    blurb: 'Download the app, sign in, and set your brand up properly. Start here.',
  },
  {
    id: 'creating',
    label: 'Creating what you sell',
    blurb: 'Ticketed events, RSVPs, experiences, trips, venues and rooms — each one end to end.',
  },
  {
    id: 'selling',
    label: 'Selling and running it',
    blurb: 'Take the money, run the door, refund a guest, and market to the people who came.',
  },
] as const

export type HelpChapterId = (typeof HELP_CHAPTERS)[number]['id']

/** Intent filters. These are jobs people arrive with, not chapter numbers. */
export const HELP_INTENTS = [
  'Get set up',
  'Sell tickets',
  'Take RSVPs',
  'Run a venue',
  'Sell a trip',
  'Get paid',
  'Run the door',
  'Market to customers',
] as const

export type HelpIntent = (typeof HELP_INTENTS)[number]

/** A place the step sends you. External hrefs open in a new tab. */
export interface HelpStepLink {
  readonly label: string
  readonly href: string
}

export interface HelpStep {
  readonly title: string
  readonly body: string
  /**
   * The things this step names, made clickable. A step that says "go to the
   * download page" should be actionable from the page itself — otherwise the
   * reader has to retype a URL they were just shown.
   */
  readonly links?: readonly HelpStepLink[]
}

export interface HelpVideoRecord {
  readonly slug: string
  readonly episode: number
  readonly title: string
  /** One line under the card and the <meta description> stem. */
  readonly blurb: string
  /** mm:ss as published. */
  readonly duration: string
  /** ISO 8601 duration for VideoObject schema. */
  readonly durationIso: string
  readonly chapter: HelpChapterId
  readonly intents: readonly HelpIntent[]
  readonly surfaces: readonly ('Web' | 'iOS' | 'Android')[]
  readonly bambooEntryId: string | null
  readonly uploadedAt: string
  /**
   * Attach the sidecar VTT at `public/help/captions/<slug>.vtt` as a soft
   * caption track.
   *
   * FALSE when the master already has subtitles burned into the picture —
   * attaching a track there renders both at once, stacked. Scene 01 shipped
   * burned in and stays that way (replacing a published video mints a new URL
   * and breaks every existing link); from scene 02 the renders carry no burned
   * text, so this is true and the viewer gets a caption they can switch off.
   */
  readonly hasCaptions: boolean
  readonly steps: readonly HelpStep[]
}

export const HELP_VIDEOS: readonly HelpVideoRecord[] = [
  {
    slug: 'getting-the-apps',
    episode: 1,
    title: 'Getting the apps',
    blurb: 'Where to find Mingla and Mingla Host, and which one you need.',
    duration: '0:46',
    durationIso: 'PT46S',
    chapter: 'getting-started',
    intents: ['Get set up'],
    surfaces: ['Web', 'iOS', 'Android'],
    bambooEntryId: '0_rs30f782',
    uploadedAt: '2026-09-11',
    // Burned into the picture — verified on the Bamboo master. A soft track
    // here would double every line.
    hasCaptions: false,
    steps: [
      {
        title: 'Open usemingla.com',
        body: 'Mingla has two sides — one for finding something to do, one for hosting it.',
        links: [{ label: 'usemingla.com', href: 'https://usemingla.com' }],
      },
      {
        title: 'Go to the download page',
        body:
          'It detects your phone: an iPhone goes to the App Store, an Android to Google Play. Or scan the QR code with your camera. That page is the Explorer app — Mingla Host is downloaded from the Host page instead.',
        links: [
          { label: 'Explorer · usemingla.com/download', href: 'https://usemingla.com/download' },
          { label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' },
        ],
      },
      {
        title: 'Pick the right app',
        body:
          'Mingla is for exploring. Mingla Host is for venues, promoters and trip organisers. They are separate downloads.',
        links: [
          { label: 'Mingla · App Store', href: 'https://apps.apple.com/app/id6760440898' },
          {
            label: 'Mingla · Google Play',
            href: 'https://play.google.com/store/apps/details?id=com.mingla.app.v2',
          },
          { label: 'Mingla Host · App Store', href: 'https://apps.apple.com/app/id6768737367' },
          {
            label: 'Mingla Host · Google Play',
            href: 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness',
          },
        ],
      },
      {
        title: 'For the business side, go to host.usemingla.com',
        body:
          'Sign in with Apple, Google or email — the same account works on the web and in the app.',
        links: [{ label: 'host.usemingla.com', href: 'https://host.usemingla.com' }],
      },
    ],
  },
  {
    slug: 'sign-up-and-create-a-brand',
    episode: 2,
    title: 'Sign up and create your brand',
    blurb: 'Your account, then the brand people actually see — name, contact, cover and colours.',
    duration: '3:55',
    durationIso: 'PT3M55S',
    chapter: 'getting-started',
    intents: ['Get set up'],
    surfaces: ['Web', 'iOS'],
    bambooEntryId: '0_0l13f021',
    uploadedAt: '2026-09-11',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Sign in with a code',
        body:
          'There is no password to invent. Give Mingla an email and it sends a six-digit code. Apple and Google work too, and land you in the same place.',
        links: [{ label: 'host.usemingla.com', href: 'https://host.usemingla.com' }],
      },
      {
        title: 'Create a brand from either entry point',
        body:
          'The to-do list on your home screen, or the brand dropdown in the top bar — same destination. Five steps, and only the first is compulsory.',
      },
      {
        title: 'Name, tagline and description',
        body:
          'Use the name people say out loud. Then a short bio, up to 200 characters: the FIRST LINE becomes your tagline, then leave a blank line and write the rest. That is why a brand page reads as a headline and a paragraph.',
      },
      {
        title: 'Address, phone and socials',
        body:
          'Your address pre-fills the venue on anything you publish, and the phone country matters because the dial code travels with the number. Paste full social links, not handles. Nothing is compulsory — an empty field simply does not show on your page.',
      },
      {
        title: 'Add a video cover',
        body:
          'A cover can be video, up to 15 seconds and under 100 MB. Trim, flip, mute or change speed first. It uploads in the background: close the sheet, close the app, and it is waiting for you when you come back.',
      },
      {
        title: 'Make it yours',
        body:
          'Pick a colour and watch the live preview change. Choose a typeface from sans, serif, display or handwriting, and a small animation that plays once when someone opens your page. The Mingla default is a starting point, not a rule.',
      },
    ],
  },
  {
    slug: 'connect-a-bank-and-get-paid',
    episode: 3,
    title: 'Connect a bank and get paid',
    blurb:
      'Stripe for most countries, Paystack for Nigeria — and why your address, not a menu, picks the rail.',
    duration: '1:58',
    durationIso: 'PT1M58S',
    chapter: 'getting-started',
    intents: ['Get set up', 'Get paid'],
    surfaces: ['Web', 'iOS'],
    bambooEntryId: '0_jtcuedgh',
    uploadedAt: '2026-09-12',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'It lives on the brand, not your account',
        body:
          'Every brand you run has its own bank. Open your account, pick the brand, and scroll to Payments and Bank. Same path on the web — same place, same account, whichever screen is nearest.',
        links: [{ label: 'host.usemingla.com', href: 'https://host.usemingla.com' }],
      },
      {
        title: 'Free publishes without one',
        body:
          'A free event, an RSVP, a venue listing — none of it needs a bank. Connecting one is the step that turns your page into something people can pay you for.',
      },
      {
        title: 'Your bank details never touch Mingla',
        body:
          'Accept the Mingla Host terms and Stripe’s own secure pages take your business and bank details. Mingla gets back one answer — connected, or not connected. Never your numbers. Mingla is the merchant of record for ticket sales, which is why payouts reach you from us rather than from each buyer.',
      },
      {
        title: 'Your address chooses your payment network',
        body:
          'A brand belongs to one country. Put a Lagos address on a brand and Mingla has already decided: Nigeria, naira, Paystack. Everywhere else goes to Stripe in that country’s currency. Operating in two countries means two brands — the app says so itself.',
      },
      {
        title: 'Nigeria is quicker, not harder',
        body:
          'No hosted page, no documents, no waiting for review. Choose your bank, type your ten-digit account number, tap verify. Paystack checks it against the bank and sends back the name on the account before you commit — so a wrong digit is caught before a payout goes anywhere.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-a-one-night-event',
    episode: 4,
    title: 'Sell tickets to a one-night event',
    blurb:
      'A one-night event from start to finish: the seven steps, a ticket priced in dollars, and the live page it ends on.',
    duration: '2:38',
    durationIso: 'PT2M38S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_n8x2zpdb',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Start from your brand’s Home',
        body:
          'In Mingla Host, tap +, choose Create event, then Ticketed event. Every paid event goes through the same seven steps.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'Step 1 — the basics',
        body:
          'Give it a name and choose the format: in person, online, or both. Pick a party type, the vibe tags and every genre you will play — they all show up as tags on your event page — then write a short description of the night.',
      },
      {
        title: 'Step 2 — when',
        body:
          'Choose a single date, then when doors open and when it ends. A night can run past midnight: doors at 9 PM and an end at 3 AM is one six-hour event, and Mingla works out the length for you.',
      },
      {
        title: 'Step 3 — where',
        body:
          'Name the venue and search for the address. With Hide address on, only people with a ticket see where it is.',
      },
      {
        title: 'Step 4 — cover, photos and theme',
        body:
          'Add a video cover of up to fifteen seconds; Mingla uploads it and gets it ready. Add up to eight more photos under it, which guests swipe through after the video. Then choose a colour, a typeface and a little motion — the preview changes as you pick.',
      },
      {
        title: 'Step 5 — tickets',
        body:
          'Name the ticket and set the price — it is in your brand’s currency, dollars here — and how many you are selling. Turn on a waitlist for when it sells out, and allow transfers so a guest can pass a ticket on. Save it to see the tickets available and the maximum revenue.',
      },
      {
        title: 'Steps 6 and 7 — check, then publish',
        body:
          'Keep the event public so anyone on Mingla can find it. Step seven checks demand and competition and gives a likely turnout — a band, not a promise. Publish, and sales open straight away.',
      },
      {
        title: 'Your live page',
        body:
          'The cover plays, your photos sit underneath, your tags are right there, and it shows how many tickets are left. Every customer Mingla drives your way lands on this page.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-an-event-in-nigeria',
    episode: 5,
    title: 'Sell tickets to an event in Nigeria',
    blurb:
      'The same seven steps on a Nigerian brand — a Lagos timezone, a ticket priced in naira, and Paystack underneath.',
    duration: '2:37',
    durationIso: 'PT2M37S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_une8ejmf',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Switch to your Nigerian brand',
        body:
          'A brand belongs to one country. On Home, tap the brand name and pick your Nigerian brand, then tap +, Create event and Ticketed event.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'The basics don’t change',
        body:
          'Name it, set the format and the party type, then the vibe tags and every genre you will play — afrobeats, afro house, amapiano. They all show up as tags on your event page. Add a line or two about the night.',
      },
      {
        title: 'Date, doors and a Lagos timezone',
        body:
          'Pick the date, when doors open and when it ends. Then check the timezone: this night is in Lagos, so set it to Lagos.',
      },
      {
        title: 'Venue and a hidden address',
        body:
          'Name the venue, search for the address and pick it. Hide address keeps it for ticket holders only.',
      },
      {
        title: 'Keep working while the cover processes',
        body:
          'Choose a video cover. Processing can take a while and you do not have to watch it: close the sheet and set the theme in the meantime. Come back and the cover is ready — then add up to eight photos and tap Use this cover.',
      },
      {
        title: 'Price it in naira',
        body:
          'Tickets work exactly as they do on a Stripe brand, but the price is in naira. That is the one real difference: this brand is set up in Nigeria, so it runs on Paystack. Add a waitlist, allow transfers and save.',
      },
      {
        title: 'Check and publish',
        body:
          'Keep it public with transfers on. Step seven checks demand and competition and gives a likely range, not a promise. Publish, and sales open straight away — every customer Mingla drives your way lands on the live page.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-a-multi-day-event',
    episode: 6,
    title: 'Sell tickets to a multi-day event',
    blurb:
      'Three dates on one event page, priced per day, so a guest buys a pass for each day they choose.',
    duration: '3:16',
    durationIso: 'PT3M16S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_qqf5oi21',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Start a ticketed event',
        body:
          'From your brand’s Home, tap +, choose Create event, then Ticketed event. Step one is the same as any event; use the description to say how the days work.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'Choose Multi-date and add each day',
        body:
          'In step two, choose Multi-date and add each day with its own start and end — Sunday can start in the afternoon while Friday and Saturday run late. You need at least two dates.',
      },
      {
        title: 'Per day: a pass for each day',
        body:
          'Once there are two dates, Mingla asks how guests pay for multiple days. Per day means a guest buys a pass for each day they choose.',
      },
      {
        title: 'Venue and cover',
        body:
          'Name the venue, search for the address and pick it; with Hide address on, only ticket holders see where it is. Add a video cover, close the sheet once it has uploaded, and set the theme while Mingla gets it ready in the background.',
      },
      {
        title: 'Price one day',
        body:
          'Because you chose Per day, the ticket price is for one day. Say in the ticket description that guests pick their nights at checkout, set how many, turn on the waitlist, allow transfers and save. In settings, keep it public and turn on in-person payments if you will sell at the door.',
      },
      {
        title: 'Preview what a guest sees',
        body:
          'Step seven gives a likely turnout — a band, not a promise. The preview shows each date in its own box: tick Friday and Saturday and, priced per day, the total is two passes.',
      },
      {
        title: 'Publish every date at once',
        body:
          'Publish, and all three dates go on sale at once, on one page for the whole weekend. Every customer Mingla drives your way lands right here.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-a-multi-day-event-in-nigeria',
    episode: 7,
    title: 'Sell tickets to a multi-day event in Nigeria',
    blurb:
      'A two-night weekend in Lagos on one page — a Lagos timezone, per-day passes in naira, and guests picking their days.',
    duration: '3:15',
    durationIso: 'PT3M15S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_bwrlkp2u',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Start from your Nigerian brand',
        body:
          'From its Home, tap +, choose Create event, then Ticketed event. The basics don’t change: name, format, party type, vibe tags and genres. Use the description to say how the nights differ.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'Multi-date, in Lagos time',
        body:
          'In step two, choose Multi-date and set the timezone first — this weekend is in Lagos. Then add each day with its own hours; you need at least two.',
      },
      {
        title: 'Choose Per day',
        body:
          'With two dates in, choose how guests pay. Per day means a separate pass for each day a guest picks.',
      },
      {
        title: 'Venue, cover and photos',
        body:
          'Name the venue, search for the address and pick it, with Hide address on. Add a video cover, close the sheet and set the theme while Mingla finishes it in the background. Come back, add up to eight photos and tap Use this cover.',
      },
      {
        title: 'A per-day price in naira',
        body:
          'In the ticket description, say guests can pick Saturday, Sunday or both. The price is in naira, per day. Set the capacity, turn on the waitlist and transfers, and save.',
      },
      {
        title: 'Door sales, check, publish',
        body:
          'Keep it public with transfers on, and turn on in-person payments for door sales. Step seven checks demand and competition and gives a likely range, not a promise. Publish, and both dates go on sale at once.',
      },
      {
        title: 'Guests pick their days',
        body:
          'On the live page, down in tickets, a guest ticks the days they want — tick both and the total covers two passes. Every customer Mingla drives your way lands right here.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-a-weekly-event',
    episode: 8,
    title: 'Sell tickets to a weekly event',
    blurb:
      'An event that happens every week: choose Recurring, set a weekly pattern, and decide when the run ends.',
    duration: '3:09',
    durationIso: 'PT3M9S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_rblje1is',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Start on the brand that is hosting',
        body:
          'Switch to it from Home, then tap +, Create event and Ticketed event. The basics are the same as any event; add a short description so guests know what a night looks like.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'Choose Recurring',
        body:
          'In step two, choose Recurring. Set the first date, then when doors open and when the night ends, then the repeat pattern — weekly, on the night it happens.',
      },
      {
        title: 'Choose when the run ends',
        body:
          'A recurring event always needs an end: after a set number of nights, or on a date. The summary shows the whole schedule, in your timezone.',
      },
      {
        title: 'Venue, cover and photos',
        body:
          'Name the venue and search for the address; with Hide address on, only ticket holders see it. Add a video cover — the sheet updates on its own when it is ready — then up to eight photos and a theme.',
      },
      {
        title: 'Tickets and door sales',
        body:
          'Name and describe the ticket, set the price and how many seats you have, turn on a waitlist and allow transfers. Keep it public, and turn on in-person payments if you sell at the door.',
      },
      {
        title: 'Check and publish',
        body:
          'Step seven checks demand for your next date and gives a likely range, not a promise. Publish, and sales open straight away.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-an-online-event',
    episode: 9,
    title: 'Sell tickets to an online event',
    blurb:
      'A ticketed stream: the format set to Online, a link instead of an address, and an unlimited pass sold online only.',
    duration: '3:13',
    durationIso: 'PT3M13S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_sjuzje7s',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Set the format to Online',
        body:
          'From your brand’s Home, tap +, Create event, then Ticketed event. Name it and set the format to Online. Pick a party type, vibe tags and genres, then say what the stream is and what guests get from it.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'Date and times',
        body:
          'In step two, pick the date, when the stream starts and when it ends.',
      },
      {
        title: 'A link, not an address',
        body:
          'Because it is online, step three asks for the link instead of an address. Only ticket holders get it.',
      },
      {
        title: 'Cover, photos and theme',
        body:
          'Add a video cover, then up to eight more photos that guests swipe through after the video, then a colour, a typeface and a little motion.',
      },
      {
        title: 'An unlimited pass sold online only',
        body:
          'Name the pass, describe it and set the price. A stream has no room to fill, so turn on unlimited capacity. Under Available at, choose Online only. Set how many one person can buy, allow transfers and save.',
      },
      {
        title: 'Settings, preview, publish',
        body:
          'Keep it public. A private guest list hides who is going but still shows how many. Step seven shows the event the way guests will see it — publish, and sales open straight away. Every customer Mingla drives your way lands on the live page.',
      },
    ],
  },
  {
    slug: 'sell-tickets-to-an-online-event-from-nigeria',
    episode: 10,
    title: 'Sell tickets to an online event from Nigeria',
    blurb:
      'A live-streamed event on a Nigerian brand — Lagos time, a stream link, and a pass priced in naira and sold online only.',
    duration: '2:48',
    durationIso: 'PT2M48S',
    chapter: 'creating',
    intents: ['Sell tickets'],
    surfaces: ['iOS'],
    bambooEntryId: '0_u4q5mdaj',
    uploadedAt: '2026-09-14',
    // Nothing is burned into this render, so the sidecar track is the caption.
    hasCaptions: true,
    steps: [
      {
        title: 'Switch to your Nigerian brand',
        body:
          'Switch to it from Home first, then tap +, Create event and Ticketed event. Name it and set the format to Online, then pick the party type, vibe tags and genres.',
        links: [{ label: 'Mingla Host · usemingla.com/host', href: 'https://usemingla.com/host' }],
      },
      {
        title: 'Lagos time',
        body:
          'In step two, set the timezone first: search for Lagos and pick it. Then the date and when the stream starts and ends — it can run past midnight, and Mingla works out the length.',
      },
      {
        title: 'A link, not an address',
        body:
          'Step three is the stream link. Only ticket holders see it.',
      },
      {
        title: 'Cover, photos and theme',
        body:
          'Add a video cover, then up to eight photos underneath, then a colour, a typeface and a little motion.',
      },
      {
        title: 'Price in naira, sell online only',
        body:
          'Name and describe the pass, set the price in naira and how many you are selling. Under Available at, choose Online only so it is not sold at the door. Add a waitlist, allow transfers and save.',
      },
      {
        title: 'Preview and publish',
        body:
          'Keep it public. Step seven shows the event the way guests will see it — publish, and sales open straight away. Every customer Mingla drives your way lands on the live page.',
      },
    ],
  },
]

export const helpVideoForSlug = (slug: string): HelpVideoRecord | null =>
  HELP_VIDEOS.find((v) => v.slug === slug) ?? null

export const helpVideoPath = (slug: string): string => `/help/${slug}`

/**
 * Public HLS ladder for a Bamboo entry. Safari plays it natively; hls.js elsewhere.
 *
 * Bamboo Cloud is Kaltura underneath, so this is Kaltura's `playManifest`. The
 * partner segment is load-bearing in Kaltura's own docs but demonstrably is not
 * here — the entry resolves by id alone, and every partner value returns the
 * same four-rung master (360p→1080p). It is pinned to 0 rather than guessed.
 *
 * The obvious-looking `/api/entry/{id}/flavors/playlist.m3u8` is a trap: it
 * answers 200 with a ZERO-byte body and the correct mpegurl content type, so a
 * player built on it fails silently and a curl status check calls it healthy.
 */
export const bambooHlsUrl = (entryId: string): string =>
  `https://cdnapi.bamboo-cloud.com/p/0/sp/000/playManifest/entryId/${entryId}/format/applehttp/protocol/https/a.m3u8`

/** Poster frame for an entry, used as the player's `poster` and as og:image. */
export const bambooPosterUrl = (entryId: string, width = 1280): string =>
  `https://cdnapi.bamboo-cloud.com/p/0/sp/000/thumbnail/entry_id/${entryId}/width/${width}`

export const helpVideosInChapter = (chapter: HelpChapterId): readonly HelpVideoRecord[] =>
  HELP_VIDEOS.filter((v) => v.chapter === chapter).sort((a, b) => a.episode - b.episode)

/** Same-origin caption track, or null when the video has none. */
export const helpCaptionsUrl = (v: HelpVideoRecord): string | null =>
  v.hasCaptions ? `/help/captions/${v.slug}.vtt` : null
