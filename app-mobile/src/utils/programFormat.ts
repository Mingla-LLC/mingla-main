/**
 * #3872 — one formatter for every Creator and Local screen.
 *
 * Copy rule: people never see raw values. No minor units ("USD 30000"), no ISO
 * dates ("2026-12-05"), no status keys ("script_sent"), no budget codes ("b2"),
 * no follower-band keys ("10k_50k"). Every screen formats through here.
 *
 * Pure on purpose (no imports): it runs under `node --experimental-strip-types`
 * in the unit suite exactly as it runs in the app.
 */

// ── Money ──────────────────────────────────────────────────────────────────

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF']);
const SYMBOLS: Record<string, string> = {
  USD: '$', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', GBP: '£', EUR: '€', NGN: '₦', GHS: 'GH₵', KES: 'KSh',
  ZAR: 'R', JPY: '¥', INR: '₹', CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ', DKK: 'kr ', PLN: 'zł ',
};

/** Number of minor-unit digits for a currency (USD 2, JPY 0). */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' && digits >= 0 && digits <= 3 ? digits : 2;
  } catch {
    return 2;
  }
}

/** Minor units → whole currency number (30000 USD → 300). */
export function minorToWhole(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}

/**
 * Money from minor units in the record's own currency: "$300", "$4.75",
 * "₦120,000". Cents only show when there are cents.
 */
export function formatMoney(minor: number | null | undefined, currency: string | null | undefined, locale?: string): string {
  const code = (currency ?? '').toUpperCase();
  const value = typeof minor === 'number' && Number.isFinite(minor) ? minor : 0;
  if (!/^[A-Z]{3}$/.test(code)) return formatPlainNumber(value / 100, locale);
  const exponent = currencyExponent(code);
  const whole = value / 10 ** exponent;
  const fraction = Number.isInteger(whole) ? 0 : exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: code, currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fraction, maximumFractionDigits: fraction,
    }).format(whole);
  } catch {
    const symbol = SYMBOLS[code] ?? `${code} `;
    return `${whole < 0 ? '-' : ''}${symbol}${formatPlainNumber(Math.abs(whole), locale, fraction)}`;
  }
}

function formatPlainNumber(value: number, locale?: string, fraction = 0): string {
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value);
  } catch {
    return value.toFixed(fraction);
  }
}

/** The currency's symbol on its own, for an input prefix ("$", "₦"). */
export function currencySymbol(currency: string, locale?: string): string {
  const code = currency.toUpperCase();
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency');
    if (part?.value) return part.value;
  } catch { /* fall through */ }
  return (SYMBOLS[code] ?? code).trim();
}

/**
 * What a person typed as whole currency ("$300", "1,200.50") → minor units.
 * Returns null for anything that is not a positive amount with at most the
 * currency's decimal places.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '').replace(/^[^0-9.]+/, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const exponent = currencyExponent(currency);
  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > exponent) return null;
  const minor = Number(whole) * 10 ** exponent + Number((fraction + '000').slice(0, exponent) || '0');
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Minor units → the whole-currency text an input field shows ("300"). */
export function moneyInputValue(minor: number | null | undefined, currency: string): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor) || minor <= 0) return '';
  const whole = minorToWhole(minor, currency);
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(currencyExponent(currency));
}

// ── Dates ──────────────────────────────────────────────────────────────────

/** "2026-11-14" is a calendar day, not midnight UTC: parse it as a local date. */
export function parseDay(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A Date → "2026-11-14" in local time (what date RPC params expect). */
export function toDayString(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function monthShort(date: Date, locale?: string): string {
  try { return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date); }
  catch { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]; }
}

/** "Nov 14" (with the year only when it isn't this year: "Jan 3, 2028"). */
export function formatShortDate(value: string | Date | null | undefined, now: Date = new Date(), locale?: string): string {
  const date = parseDay(value);
  if (!date) return '';
  const base = `${monthShort(date, locale)} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** "Nov 14–16", "Nov 28 – Dec 2", "Dec 30, 2026 – Jan 2, 2027". */
export function formatDateRange(start: string | Date | null | undefined, end: string | Date | null | undefined, now: Date = new Date(), locale?: string): string {
  const a = parseDay(start);
  const b = parseDay(end);
  if (!a && !b) return '';
  if (!a || !b) return formatShortDate(a ?? b, now, locale);
  if (a.getFullYear() !== b.getFullYear()) {
    return `${formatShortDate(a, new Date(0), locale)} – ${formatShortDate(b, new Date(0), locale)}`;
  }
  const yearSuffix = a.getFullYear() === now.getFullYear() ? '' : `, ${a.getFullYear()}`;
  if (a.getMonth() === b.getMonth()) {
    if (a.getDate() === b.getDate()) return `${monthShort(a, locale)} ${a.getDate()}${yearSuffix}`;
    return `${monthShort(a, locale)} ${a.getDate()}–${b.getDate()}${yearSuffix}`;
  }
  return `${monthShort(a, locale)} ${a.getDate()} – ${monthShort(b, locale)} ${b.getDate()}${yearSuffix}`;
}

/** "8:00 PM". */
export function formatTime(value: string | Date | null | undefined, locale?: string): string {
  const date = parseDay(value);
  if (!date) return '';
  try { return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date); }
  catch {
    const h = date.getHours() % 12 || 12;
    return `${h}:${String(date.getMinutes()).padStart(2, '0')} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
  }
}

/** "Fri, Nov 21 · 8:00 PM". */
export function formatDateTime(value: string | Date | null | undefined, now: Date = new Date(), locale?: string): string {
  const date = parseDay(value);
  if (!date) return '';
  let weekday = '';
  try { weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date); }
  catch { weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]; }
  return `${weekday}, ${formatShortDate(date, now, locale)} · ${formatTime(date, locale)}`;
}

/** "November 2026" style month label for a month switcher ("Nov" when short). */
export function formatMonth(value: string | Date | null | undefined, style: 'long' | 'short' = 'long', locale?: string): string {
  const date = parseDay(value);
  if (!date) return '';
  try { return new Intl.DateTimeFormat(locale, { month: style }).format(date); }
  catch { return monthShort(date, locale); }
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Due today", "Due tomorrow", "Due Nov 18", "Overdue". */
export function formatDue(value: string | Date | null | undefined, now: Date = new Date(), locale?: string): string {
  const date = parseDay(value);
  if (!date) return '';
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (date.getTime() < now.getTime() && days < 0) return 'Overdue';
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${formatShortDate(date, now, locale)}`;
}

/** Whole hours left until a deadline, never negative. */
export function hoursLeft(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const date = parseDay(value);
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 3_600_000));
}

/** "47 hours left to answer" / "Less than an hour left" / "Time's up". */
export function formatTimeLeft(value: string | Date | null | undefined, now: Date = new Date(), what = 'to answer'): string {
  const date = parseDay(value);
  if (!date) return '';
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return 'Time’s up';
  if (ms < 3_600_000) return `Less than an hour left ${what}`;
  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 72) return `${hours} hour${hours === 1 ? '' : 's'} left ${what}`;
  const days = Math.floor(hours / 24);
  return `${days} days left ${what}`;
}

/** Days left in a pick window etc.: "5 days left", "Last day". */
export function formatDaysLeft(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = parseDay(value);
  if (!date) return '';
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (days < 0) return 'Closed';
  if (days === 0) return 'Last day';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

// ── Age ────────────────────────────────────────────────────────────────────

export const MIN_CREATOR_AGE = 18;

/** Age in whole years on `now`. */
export function ageOn(dateOfBirth: string | Date, now: Date = new Date()): number | null {
  const dob = parseDay(dateOfBirth);
  if (!dob || dob.getTime() > now.getTime()) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday = now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** True only for a real birth date at least 18 years ago (18th birthday counts). */
export function isAdult(dateOfBirth: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!dateOfBirth) return false;
  const age = ageOn(dateOfBirth, now);
  return age !== null && age >= MIN_CREATOR_AGE && age <= 120;
}

/** The latest birth date the picker allows (exactly 18 years ago today). */
export function latestAdultBirthDate(now: Date = new Date()): Date {
  return new Date(now.getFullYear() - MIN_CREATOR_AGE, now.getMonth(), now.getDate());
}

// ── Labels ─────────────────────────────────────────────────────────────────

const FOLLOWER_BANDS: Record<string, string> = {
  lt1k: 'Under 1k', '1k_10k': '1k–10k', '10k_50k': '10k–50k', '50k_250k': '50k–250k', '250k_1m': '250k–1M', gt1m: '1M+',
};
export const FOLLOWER_BAND_KEYS = Object.keys(FOLLOWER_BANDS);

/** "10k_50k" → "10k–50k". Unknown keys never leak: they read "Not set". */
export function followerBandLabel(key: string | null | undefined): string {
  if (!key) return 'Not set';
  return FOLLOWER_BANDS[key] ?? 'Not set';
}

const PLATFORMS: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', snapchat: 'Snapchat' };
export const PLATFORM_KEYS = Object.keys(PLATFORMS);
export function platformLabel(key: string | null | undefined): string {
  if (!key) return '';
  return PLATFORMS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

const NICHES: Record<string, string> = {
  food: 'Food', nightlife: 'Nightlife', culture: 'Culture', outdoors: 'Outdoors', wellness: 'Wellness', music: 'Music', family: 'Family', travel: 'Travel',
};
export function nicheLabel(key: string): string {
  return NICHES[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

export type FormatInfo = { key: string; name: string; oneLine: string; seconds: [number, number] };
export const FORMAT_INFO: readonly FormatInfo[] = [
  { key: 'night_out_30', name: 'Night out in 30 seconds', oneLine: 'A fast night-out story: the atmosphere, the experience and why someone should go.', seconds: [20, 40] },
  { key: 'first_timer_reaction', name: 'First-timer reaction', oneLine: 'A genuine first visit: arrival, first impression, one useful detail and the invitation to book.', seconds: [20, 45] },
  { key: 'three_reasons', name: 'Three reasons to go', oneLine: 'Three specific reasons that make the place or event worth going to.', seconds: [15, 30] },
  { key: 'what_price_gets', name: 'What the price gets you', oneLine: 'A concrete look at what the price includes.', seconds: [20, 45] },
  { key: 'behind_the_scenes', name: 'Behind the scenes', oneLine: 'The people, preparation and craft behind the place or event.', seconds: [25, 60] },
  { key: 'date_idea', name: 'Date idea', oneLine: 'A practical date plan: the mood, what to do and how to book it.', seconds: [20, 45] },
];
export function formatInfo(key: string | null | undefined): FormatInfo | null {
  return FORMAT_INFO.find((f) => f.key === key) ?? null;
}
export function formatName(key: string | null | undefined): string {
  return formatInfo(key)?.name ?? 'Short video';
}

/** "1 Instagram Reel", "2 TikTok videos". */
export function deliverableLabel(item: { platform?: string; kind?: string; count?: number }): string {
  const count = typeof item.count === 'number' && item.count > 0 ? item.count : 1;
  const platform = platformLabel(item.platform);
  const kindKey = (item.kind ?? '').toLowerCase();
  const kinds: Record<string, [string, string]> = {
    reel: ['Reel', 'Reels'], video: ['video', 'videos'], short: ['Short', 'Shorts'], story: ['Story', 'Stories'], post: ['post', 'posts'], tiktok: ['video', 'videos'],
  };
  const [one, many] = kinds[kindKey] ?? ['video', 'videos'];
  return `${count} ${platform ? `${platform} ` : ''}${count === 1 ? one : many}`;
}

export function deliverablesLabel(items: Array<{ platform?: string; kind?: string; count?: number }> | null | undefined): string {
  if (!items?.length) return '1 short video';
  return items.map(deliverableLabel).join(', ');
}

export function usageLabel(days: number | null | undefined): string {
  if (!days) return 'Not included';
  if (days === 365) return '1 year';
  return `${days} days`;
}

// ── Budget ─────────────────────────────────────────────────────────────────

export type BudgetDisplay = { kind: 'range'; text: string } | { kind: 'level'; level: number; text: string };

/**
 * Real money range when Admin configured one for the gig's currency, else a
 * 4-step level ("b2" → level 2 of 4). The raw band key never reaches the screen.
 */
export function budgetDisplay(gig: { budget_band?: string | null; budget_min_minor?: number | null; budget_max_minor?: number | null; budget_currency?: string | null }): BudgetDisplay {
  const { budget_min_minor: min, budget_max_minor: max, budget_currency: currency } = gig;
  if (typeof min === 'number' && typeof max === 'number' && currency) {
    return { kind: 'range', text: min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)}–${formatMoney(max, currency)}` };
  }
  const match = /^b([1-4])$/i.exec(gig.budget_band ?? '');
  const level = match ? Number(match[1]) : 1;
  return { kind: 'level', level, text: ['Starter budget', 'Mid budget', 'High budget', 'Top budget'][level - 1] };
}

// ── Contract words (creator view) ──────────────────────────────────────────

export type ContractWordsInput = { deadlineAt?: string | null; fixRoundsUsed?: number | null; now?: Date };

/** The status-words table, creator column. Unknown states read "In progress". */
export function creatorStateWords(state: string | null | undefined, input: ContractWordsInput = {}): string {
  const now = input.now ?? new Date();
  switch (state) {
    case 'offered': {
      const hours = hoursLeft(input.deadlineAt, now);
      return hours === null ? 'Offer waiting' : `Offer waiting · answer in ${hours}h`;
    }
    case 'accepted':
    case 'shoot_planned': return 'Plan the shoot';
    case 'script_drafting': return 'Write the script';
    case 'script_sent': return 'Script with the host';
    case 'script_locked': return 'Film and upload';
    case 'delivered': return 'Video with the host';
    case 'fix_requested': return `Fix requested (${Math.min(2, Math.max(1, input.fixRoundsUsed ?? 1))} of 2)`;
    case 'approved':
    case 'posting': return 'Post it and add links';
    case 'posts_submitted': return 'Checking your posts';
    case 'posts_failed': return 'Fix your post links';
    case 'posts_verified': return 'Posts verified · paid in 48h';
    case 'released':
    case 'day30': return 'Payment released';
    case 'completed': return 'Done';
    case 'disputed': return 'In dispute';
    case 'resolved_release':
    case 'resolved_partial':
    case 'resolved_refund': return 'Dispute settled';
    case 'declined': return 'Declined';
    case 'expired': return 'Expired';
    case 'cancelled': return 'Cancelled';
    default: return 'In progress';
  }
}

/** States where the next move is the creator's. */
export function creatorOwnsNextStep(state: string | null | undefined): boolean {
  return ['offered', 'accepted', 'shoot_planned', 'script_drafting', 'script_locked', 'fix_requested', 'approved', 'posting', 'posts_failed'].includes(state ?? '');
}

export const CLOSED_CONTRACT_STATES = ['completed', 'declined', 'expired', 'cancelled', 'resolved_release', 'resolved_partial', 'resolved_refund'] as const;

// ── Money states ───────────────────────────────────────────────────────────

export type MoneyState = 'on_the_way' | 'ready' | 'paid';

/** On the way · Ready · Paid. Never "Paid" unless the server says paid. */
export function moneyStateWord(state: string | null | undefined): string {
  if (state === 'paid') return 'Paid';
  if (state === 'ready') return 'Ready';
  return 'On the way';
}

export function moneyStateHint(state: MoneyState): string {
  if (state === 'paid') return 'Your bank confirmed it';
  if (state === 'ready') return 'Released, on its way to your bank';
  return 'Held until the work or event is done';
}

// ── Setup checks ───────────────────────────────────────────────────────────

export const SETUP_CHECK_ORDER = ['profile', 'rates', 'showcase', 'socials', 'payout', 'agreement'] as const;
export type SetupCheckKey = (typeof SETUP_CHECK_ORDER)[number];
const CHECK_TITLES: Record<SetupCheckKey, string> = {
  profile: 'Profile', rates: 'Rates', showcase: 'Showcase video', socials: 'Verify a social account', payout: 'Payout account', agreement: 'Agreement',
};
export function setupCheckTitle(key: string): string {
  return CHECK_TITLES[key as SetupCheckKey] ?? 'Setup step';
}

/** Rough minutes left: each open step takes about two to three minutes. */
export function setupMinutesLeft(openSteps: number): number {
  return Math.max(0, Math.round(openSteps * 2.5));
}

// ── Program copy that depends on data ──────────────────────────────────────


type CityProgram = { city_id: string; city: string; monthly_rate_minor?: number | null; payout_currency?: string | null; monthly_usd_minor?: number | null };
type Landing = {
  enabled: boolean;
  programs: CityProgram[];
  applications: Array<{ status: string }>;
  local: null | { city: string };
  viewer_city_id?: string | null;
};

/** City rate in minor units + currency, preferring the per-city config. */
export function localCityRate(program: CityProgram | null | undefined): { minor: number; currency: string } | null {
  if (!program) return null;
  if (typeof program.monthly_rate_minor === 'number' && program.monthly_rate_minor > 0 && program.payout_currency) {
    return { minor: program.monthly_rate_minor, currency: program.payout_currency };
  }
  if (typeof program.monthly_usd_minor === 'number' && program.monthly_usd_minor > 0) return { minor: program.monthly_usd_minor, currency: 'USD' };
  return null;
}

export const LOCAL_APPLICATION_LINE: Record<string, string> = {
  submitted: 'Application in review. We’ll tell you here.',
  shortlisted: 'You’re shortlisted. We’ll be in touch soon.',
  accepted: 'You’re in. Open to pick your first place.',
  waitlisted: 'You’re on the waitlist for the next open seat.',
  rejected: 'Not selected this time. You can apply again in 90 days.',
};

/**
 * W1.2 — Local pay differs by city: the viewer's city rate when known
 * ("Get paid $150 a month in Raleigh"), else a general line. Null when there
 * is nothing to offer or track.
 */
export function localRowCopy(local: Landing | null | undefined): string | null {
  if (!local) return null;
  if (local.local) return `Your Local seat in ${local.local.city}`;
  const application = local.applications[0];
  if (application) return LOCAL_APPLICATION_LINE[application.status] ?? LOCAL_APPLICATION_LINE.submitted;
  if (!local.enabled || local.programs.length === 0) return null;
  const mine = local.viewer_city_id ? local.programs.find((p) => p.city_id === local.viewer_city_id) : undefined;
  const rate = localCityRate(mine);
  if (mine && rate) return `Get paid ${formatMoney(rate.minor, rate.currency)} a month in ${mine.city}`;
  return 'Get paid monthly to review one place in your city';
}

/** W1.1 — how hosts see you: "Ada Films · Food, Nightlife". */
export function hostsSeeYouAs(name: string | null | undefined, niches: string[], nicheLabel: (key: string) => string): string {
  return [name?.trim() || '', niches.slice(0, 3).map(nicheLabel).join(', ')].filter(Boolean).join(' · ');
}
