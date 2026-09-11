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

export interface HelpStep {
  readonly title: string
  readonly body: string
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
      },
      {
        title: 'Go to the download page',
        body:
          'It detects your phone: an iPhone goes to the App Store, an Android to Google Play. Or scan the QR code with your camera.',
      },
      {
        title: 'Pick the right app',
        body:
          'Mingla is for exploring. Mingla Host is for venues, promoters and trip organisers. They are separate downloads.',
      },
      {
        title: 'For the business side, go to host.usemingla.com',
        body:
          'Sign in with Apple, Google or email — the same account works on the web and in the app.',
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
