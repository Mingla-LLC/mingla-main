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
