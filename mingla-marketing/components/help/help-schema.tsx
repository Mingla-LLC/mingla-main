import { SITE_ORIGIN } from '@/lib/site'
import {
  bambooHlsUrl,
  bambooPosterUrl,
  helpVideoPath,
  type HelpVideoRecord,
} from '@/content/help/registry'

/**
 * VideoObject for a help video.
 *
 * This is the whole reason the videos get their own pages rather than living in
 * one long scroll: a VideoObject needs a URL of its own to be eligible for a
 * video result, and `hasPart` gives the steps their own seek points.
 *
 * `contentUrl` is the HLS master. An entry with no upload yet emits nothing —
 * a VideoObject pointing at a video that does not exist is a structured-data
 * error, not a placeholder.
 */
export function HelpVideoSchema({ video }: { video: HelpVideoRecord }) {
  if (!video.bambooEntryId) return null

  const url = `${SITE_ORIGIN}${helpVideoPath(video.slug)}`
  const data = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    '@id': `${url}#video`,
    name: video.title,
    description: video.blurb,
    thumbnailUrl: [bambooPosterUrl(video.bambooEntryId, 1280)],
    uploadDate: video.uploadedAt,
    duration: video.durationIso,
    contentUrl: bambooHlsUrl(video.bambooEntryId),
    embedUrl: url,
    url,
    isFamilyFriendly: true,
    inLanguage: 'en',
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    hasPart: video.steps.map((step, i) => ({
      '@type': 'Clip',
      name: step.title,
      position: i + 1,
    })),
  }

  return (
    <script
      type="application/ld+json"
      // Authored in this repo. Never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
