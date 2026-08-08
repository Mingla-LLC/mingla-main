import { buildShortShareUrl, isShortShareCode, type ShareDestination, type ShareFactsV1, type ShareMediaIdentity } from '@mingla/sharing';
import type { PublicShareDetails } from './contentShareAdapter';

export type ContentShareRead = {
  state: 'active'; gone: false; shortCode: string; version: number;
  facts: ShareFactsV1; media: ShareMediaIdentity | null;
  destination: ShareDestination;
  publicDetails: PublicShareDetails | null;
};

export type ContentShareReadErrorCode = 'not_found' | 'gone' | 'temporarily_unavailable';

export class ContentShareReadError extends Error {
  constructor(readonly code: ContentShareReadErrorCode) {
    super(code);
    this.name = 'ContentShareReadError';
  }
}

export async function readContentShare(code: string): Promise<ContentShareRead> {
  if (!isShortShareCode(code)) throw new ContentShareReadError('not_found');
  const response = await fetch(`https://usemingla.com/api/content-share/${encodeURIComponent(code)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 410) throw new ContentShareReadError('gone');
    if (response.status === 404) throw new ContentShareReadError('not_found');
    throw new ContentShareReadError('temporarily_unavailable');
  }
  const body = await response.json();
  if (!body?.contentShare || body.contentShare.shortCode !== code) throw new ContentShareReadError('not_found');
  // Exercise the package-owned canonical grammar at the read boundary too.
  buildShortShareUrl(code);
  return { ...body.contentShare, publicDetails: body.contentShare.publicDetails ?? null } as ContentShareRead;
}
