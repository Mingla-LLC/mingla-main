import type { SharedCardCreateResult } from './sharedCardService';

export function externalSharedCardUrl(result: SharedCardCreateResult): string {
  return result.canonicalUrl;
}

export function referralCodeFromSharedCardAppUrl(appUrl: string): string | null {
  try {
    const referralCode = new URL(appUrl).searchParams.get('af_sub1');
    return referralCode?.trim() || null;
  } catch {
    return null;
  }
}
