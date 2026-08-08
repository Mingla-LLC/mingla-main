import type { SharedCardCreateResult } from './sharedCardService';
import { sanitizeReferralCode } from '@mingla/sharing';

export function externalSharedCardUrl(result: SharedCardCreateResult): string {
  return result.canonicalUrl;
}

export function referralCodeFromSharedCardAppUrl(appUrl: string): string | null {
  try {
    return sanitizeReferralCode(new URL(appUrl).searchParams.get('af_sub1'));
  } catch {
    return null;
  }
}
