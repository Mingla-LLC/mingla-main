import { buildShortShareUrl, isShortShareCode, type ShareFactsV1, type ShareMediaIdentity } from '@mingla/sharing';

export type ContentShareRead = {
  state: 'active'; gone: false; shortCode: string; version: number;
  facts: ShareFactsV1; media: ShareMediaIdentity | null;
  destination: Record<string, unknown>;
};

export async function readContentShare(code: string): Promise<ContentShareRead> {
  if (!isShortShareCode(code)) throw new Error('not_found');
  const response = await fetch(`https://usemingla.com/api/content-share/${encodeURIComponent(code)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(response.status === 410 ? 'gone' : 'not_found');
  const body = await response.json();
  if (!body?.contentShare || body.contentShare.shortCode !== code) throw new Error('not_found');
  // Exercise the package-owned canonical grammar at the read boundary too.
  buildShortShareUrl(code);
  return body.contentShare as ContentShareRead;
}
