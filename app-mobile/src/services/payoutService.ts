import * as WebBrowser from 'expo-web-browser';
import { countryToCurrencyMap } from './countryCurrencyService';
import { programEdge } from './programApi';
import { ProgramActionError } from './programResult';

/**
 * #3872 — one "Connect bank" flow. The person picks a country; Mingla picks the
 * payout provider underneath. Provider names never reach the screen: Nigeria
 * uses an in-app account check, every other supported country opens secure
 * bank onboarding in the browser.
 */
export type PayoutCountry = { code: string; name: string; currency: string };

// Currency comes from the app's one country→currency table, so this list only
// names where payouts are offered (USD is the consumer floor, issue #963).
const PAYOUT_COUNTRY_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['US', 'United States'],
  ['NG', 'Nigeria'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['IE', 'Ireland'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['ES', 'Spain'],
  ['IT', 'Italy'],
  ['NL', 'Netherlands'],
  ['PT', 'Portugal'],
  ['BE', 'Belgium'],
  ['AT', 'Austria'],
  ['CH', 'Switzerland'],
  ['SE', 'Sweden'],
  ['NO', 'Norway'],
  ['DK', 'Denmark'],
  ['FI', 'Finland'],
  ['PL', 'Poland'],
  ['CZ', 'Czechia'],
  ['GR', 'Greece'],
  ['HU', 'Hungary'],
  ['RO', 'Romania'],
  ['BG', 'Bulgaria'],
  ['HR', 'Croatia'],
  ['SI', 'Slovenia'],
  ['SK', 'Slovakia'],
  ['LT', 'Lithuania'],
  ['LV', 'Latvia'],
  ['EE', 'Estonia'],
  ['LU', 'Luxembourg'],
  ['MT', 'Malta'],
  ['CY', 'Cyprus'],
  ['IS', 'Iceland'],
  ['LI', 'Liechtenstein'],
];

export const PAYOUT_COUNTRIES: readonly PayoutCountry[] = PAYOUT_COUNTRY_NAMES.map(([code, name]) => ({
  code,
  name,
  currency: countryToCurrencyMap[code] ?? 'USD',
}));

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
