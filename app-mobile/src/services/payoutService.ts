import * as WebBrowser from 'expo-web-browser';
import { programEdge } from './programApi';
import { ProgramActionError } from './programResult';

/**
 * #3872 — one "Connect bank" flow. The person picks a country; Mingla picks the
 * payout provider underneath. Provider names never reach the screen: Nigeria
 * uses an in-app account check, every other supported country opens secure
 * bank onboarding in the browser.
 */
export type PayoutCountry = { code: string; name: string; currency: string };

export const PAYOUT_COUNTRIES: readonly PayoutCountry[] = [
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'PT', name: 'Portugal', currency: 'EUR' },
  { code: 'BE', name: 'Belgium', currency: 'EUR' },
  { code: 'AT', name: 'Austria', currency: 'EUR' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF' },
  { code: 'SE', name: 'Sweden', currency: 'SEK' },
  { code: 'NO', name: 'Norway', currency: 'NOK' },
  { code: 'DK', name: 'Denmark', currency: 'DKK' },
  { code: 'FI', name: 'Finland', currency: 'EUR' },
  { code: 'PL', name: 'Poland', currency: 'PLN' },
  { code: 'CZ', name: 'Czechia', currency: 'CZK' },
  { code: 'GR', name: 'Greece', currency: 'EUR' },
  { code: 'HU', name: 'Hungary', currency: 'HUF' },
  { code: 'RO', name: 'Romania', currency: 'RON' },
  { code: 'BG', name: 'Bulgaria', currency: 'BGN' },
  { code: 'HR', name: 'Croatia', currency: 'EUR' },
  { code: 'SI', name: 'Slovenia', currency: 'EUR' },
  { code: 'SK', name: 'Slovakia', currency: 'EUR' },
  { code: 'LT', name: 'Lithuania', currency: 'EUR' },
  { code: 'LV', name: 'Latvia', currency: 'EUR' },
  { code: 'EE', name: 'Estonia', currency: 'EUR' },
  { code: 'LU', name: 'Luxembourg', currency: 'EUR' },
  { code: 'MT', name: 'Malta', currency: 'EUR' },
  { code: 'CY', name: 'Cyprus', currency: 'EUR' },
  { code: 'IS', name: 'Iceland', currency: 'ISK' },
  { code: 'LI', name: 'Liechtenstein', currency: 'CHF' },
];

export function payoutCountry(code: string | null | undefined): PayoutCountry | null {
  return PAYOUT_COUNTRIES.find((c) => c.code === (code ?? '').toUpperCase()) ?? null;
}

/** Nigeria checks the account in the app; everywhere else uses secure onboarding. */
export function usesInAppAccountCheck(code: string | null | undefined): boolean {
  return (code ?? '').toUpperCase() === 'NG';
}

export type PayoutStatus = {
  connected: boolean;
  /** "Bank in Nigeria · ending 4242". Never a provider name. */
  summary: string;
  countryCode: string | null;
  pending: boolean;
};

type LinkStatus = { connected?: boolean; status?: string; country?: string | null };
type AccountStatus = { connected?: boolean; status?: string; bank_name?: string | null; account_number_masked?: string | null; currency?: string | null };

export function describePayout(link: LinkStatus | null | undefined, account: AccountStatus | null | undefined): PayoutStatus {
  if (account?.connected) {
    const last4 = (account.account_number_masked ?? '').replace(/\D/g, '').slice(-4);
    const bank = account.bank_name ? `${account.bank_name}` : 'Bank in Nigeria';
    return { connected: true, summary: last4 ? `${bank} · ending ${last4}` : bank, countryCode: 'NG', pending: false };
  }
  if (link?.connected) {
    const country = payoutCountry(link.country)?.name ?? 'your country';
    const ready = (link.status ?? '').toLowerCase() === 'active';
    return {
      connected: ready,
      summary: ready ? `Bank in ${country}` : link.status === 'restricted' ? `Bank in ${country} · needs more details` : `Bank in ${country} · finish the bank details`,
      countryCode: link.country ?? null,
      pending: !ready,
    };
  }
  return { connected: false, summary: 'Not connected', countryCode: null, pending: false };
}

export const payoutService = {
  status: async (): Promise<PayoutStatus> => {
    const [link, account] = await Promise.all([
      programEdge<LinkStatus>('payee-account-stripe-link', { action: 'status' }),
      programEdge<AccountStatus>('payee-account-paystack-recipient', { action: 'status' }),
    ]);
    return describePayout(link, account);
  },
  /** Opens secure bank onboarding for a supported country; resolves when the person comes back. */
  connectWithLink: async (countryCode: string): Promise<void> => {
    const returnUrl = 'mingla://payout-account/return';
    const data = await programEdge<{ onboarding_url?: string; url?: string }>('payee-account-stripe-link', { action: 'link', country: countryCode.toUpperCase(), return_url: returnUrl });
    const url = data.onboarding_url ?? data.url;
    if (!url) throw new ProgramActionError('country_unsupported');
    await WebBrowser.openAuthSessionAsync(url, returnUrl);
  },
  banks: async () => (await programEdge<{ banks?: Array<{ name: string; code: string }> }>('payee-account-paystack-recipient', { action: 'list_banks' })).banks ?? [],
  checkAccount: (input: { accountNumber: string; bankCode: string }) => programEdge<{ account_name: string; account_number_masked: string }>('payee-account-paystack-recipient', { action: 'resolve_account', account_number: input.accountNumber, bank_code: input.bankCode }),
  saveAccount: (input: { accountNumber: string; bankCode: string; bankName: string }) => programEdge('payee-account-paystack-recipient', { action: 'create_recipient', account_number: input.accountNumber, bank_code: input.bankCode, bank_name: input.bankName }),
};
