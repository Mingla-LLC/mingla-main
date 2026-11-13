/**
 * #3872 — one formatter for every Creator and Local screen.
 *
 * Copy rule: people never see raw values. No minor units ("USD 30000"), no ISO
 * dates ("2026-12-05"), no status keys ("script_sent"),
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
  return groupMoneyTyping(Number.isInteger(whole) ? String(whole) : whole.toFixed(currencyExponent(currency)));
}

/**
 * #4402: digits are grouped while typing ("40000" → "40,000", "1200.5" → "1,200.5").
 * Anything that is not a digit or the first dot is dropped; parseMoneyInput reads the commas back out.
 */
export function groupMoneyTyping(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  const whole = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const fraction = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === null ? grouped : `${grouped || '0'}.${fraction}`;
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

/**
 * A persisted calendar-day value → "2026-11-14" without moving it across
 * time zones. Postgres can serialize a `date` cast into a timestamptz as
 * midnight UTC; parsing that instant in a negative offset would show the
 * previous day even though the person selected the correct calendar date.
 */
export function persistedDayString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const leadingDay = /^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/.exec(value);
    if (leadingDay) return leadingDay[1];
  }
  const parsed = parseDay(value);
  return parsed ? toDayString(parsed) : null;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** #4402: one month helper for every date, always with an initial capital ("Nov", never "nov"). */
export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

function monthShort(date: Date, locale?: string): string {
  try { return capitalizeFirst(new Intl.DateTimeFormat(locale, { month: 'short' }).format(date)); }
  catch { return MONTHS_SHORT[date.getMonth()]; }
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
  try { return capitalizeFirst(new Intl.DateTimeFormat(locale, { month: style }).format(date)); }
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

// ── Pay ────────────────────────────────────────────────────────────────────

/** "Pays up to $300" in the gig's own currency, or null when no pay was stored. */
export function payUpToText(gig: { pay_up_to_minor?: number | null; currency?: string | null }): string | null {
  const minor = gig.pay_up_to_minor;
  if (typeof minor !== 'number' || !Number.isFinite(minor) || minor <= 0) return null;
  return `Pays up to ${formatMoney(minor, gig.currency)}`;
}

/** "10% of sales" (short enough for one row value). Null without a share. */
export function salesShareText(bps: number | null | undefined): string | null {
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps <= 0) return null;
  return `${Math.round(bps / 100)}% of sales`;
}

/**
 * The price an interest sheet opens with: the creator's saved rate, or the
 * gig's ceiling when the rate is higher (only when both are in one currency).
 */
export function interestPricePrefill(rateMinor: number, rateCurrency: string, gig: { pay_up_to_minor?: number | null; currency?: string | null }): number {
  const cap = gig.pay_up_to_minor;
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) return rateMinor;
  if ((gig.currency ?? rateCurrency).toUpperCase() !== rateCurrency.toUpperCase()) return rateMinor;
  return Math.min(rateMinor, cap);
}

/** A calm note when the price typed is above what the gig pays; null otherwise. */
export function overPayUpToNote(priceMinor: number | null, priceCurrency: string, gig: { pay_up_to_minor?: number | null; currency?: string | null }): string | null {
  const cap = gig.pay_up_to_minor;
  if (priceMinor === null || typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) return null;
  const currency = gig.currency ?? priceCurrency;
  if (currency.toUpperCase() !== priceCurrency.toUpperCase() || priceMinor <= cap) return null;
  return `This gig pays up to ${formatMoney(cap, currency)}. Hosts can still offer you a different fee.`;
}

// ── Video due + shoot days ─────────────────────────────────────────────────

/**
 * "Nov 20, 7:00 PM" from the stored due time (device locale and clock), or the
 * post-by day alone ("Nov 20") when no time is stored.
 */
export function videoDueText(videoDueAt: string | null | undefined, postBy: string | null | undefined, now: Date = new Date(), locale?: string): string {
  const due = typeof videoDueAt === 'string' && videoDueAt.length > 10 ? parseDay(videoDueAt) : null;
  if (due) return `${formatShortDate(due, now, locale)}, ${formatTime(due, locale)}`;
  return formatShortDate(postBy ?? null, now, locale);
}

// ── Changing the video-due date after hire ─────────────────────────────────
// Seth's decision (#3872): a change carries a date AND a time, and the
// contract shows the agreed (current terms) due date and time.

type DueSource = { video_due_at?: unknown; post_by?: unknown } | null | undefined;

/** The agreed due: the current terms' exact time and day, else the gig's. */
export function agreedVideoDue(terms: DueSource, gig: DueSource): { videoDueAt: string | null; postBy: string | null } {
  const pick = (key: 'video_due_at' | 'post_by'): string | null => {
    const fromTerms = terms?.[key];
    if (typeof fromTerms === 'string' && fromTerms.length > 0) return fromTerms;
    // An older server without terms.video_due_at: the gig's time only while
    // the terms still sit on the gig's day.
    if (key === 'video_due_at' && typeof terms?.post_by === 'string' && typeof gig?.post_by === 'string' && terms.post_by !== gig.post_by) return null;
    const fromGig = gig?.[key];
    return typeof fromGig === 'string' && fromGig.length > 0 ? fromGig : null;
  };
  return { videoDueAt: pick('video_due_at'), postBy: pick('post_by') };
}

/** "Nov 22, 6:00 PM" for the agreed due. */
export function agreedVideoDueText(terms: DueSource, gig: DueSource, now: Date = new Date(), locale?: string): string {
  const due = agreedVideoDue(terms, gig);
  return videoDueText(due.videoDueAt, due.postBy, now, locale);
}

/** Day ("YYYY-MM-DD") and time ("HH:MM") to prefill the change sheet with. */
export function dueChangeInitial(due: { videoDueAt: string | null; postBy: string | null }): { day: string | null; time: string | null } {
  const at = due.videoDueAt && due.videoDueAt.length > 10 ? parseDay(due.videoDueAt) : null;
  if (at) return { day: toDayString(at), time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` };
  return { day: due.postBy ?? null, time: due.postBy ? '23:59' : null };
}

/** The change sent to gig_change_proposal_save: local date and time. */
export function dueChangePayload(day: string, time: string): { video_due_at: string } {
  return { video_due_at: `${day}T${time}` };
}

/** Time chips for the change sheet: the usual times plus the agreed one. */
export function dueTimeOptions(current: string | null): string[] {
  const base = ['12:00', '15:00', '17:00', '18:00', '19:00', '20:00', '21:00', '23:59'];
  return current && /^\d{2}:\d{2}$/.test(current) && !base.includes(current) ? [...base, current].sort() : base;
}

/** The line a proposal card shows for a due change, or null for other changes. */
export function proposalDueText(changes: Record<string, unknown>, now: Date = new Date(), locale?: string): string | null {
  const due = typeof changes.video_due_at === 'string' ? changes.video_due_at : null;
  const day = typeof changes.post_by === 'string' ? changes.post_by : null;
  if (!due && !day) return null;
  return `Video due ${videoDueText(due, day, now, locale)}`;
}

/**
 * Which days the creator may pick for the shoot: inside the host's window and
 * never before today. The calendar opens on the picked day, else the first day
 * that can be picked (the window's first month).
 */
export function shootPickRange(window: { start?: string | null; end?: string | null } | null | undefined, pickedAt: string | null | undefined, now: Date = new Date()): {
  minDate: string; maxDate: string | null; initialDay: string | null;
} {
  const today = toDayString(now);
  const start = window?.start && /^\d{4}-\d{2}-\d{2}$/.test(window.start) ? window.start : null;
  const end = window?.end && /^\d{4}-\d{2}-\d{2}$/.test(window.end) ? window.end : null;
  const minDate = start && start > today ? start : today;
  const maxDate = end;
  if (maxDate && maxDate < minDate) return { minDate, maxDate, initialDay: null };
  const picked = parseDay(pickedAt);
  const pickedDay = picked ? toDayString(picked) : null;
  const initialDay = pickedDay && pickedDay >= minDate && (!maxDate || pickedDay <= maxDate) ? pickedDay : minDate;
  return { minDate, maxDate, initialDay };
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

// ── Contract status card (creator) ─────────────────────────────────────────

const RELEASED_STATES = ['released', 'day30'];

/** "due Nov 25" from "Due Nov 25": lower-case the first word only, keep the month capitalised. */
function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The small line on top of the contract's status card.
 * Working states: "Next · due Nov 25" (W3.1: the month stays "Nov", never "nov").
 * After release the creator has no Next; the card shows "Day-30 check · Nov 25" (W3.2).
 */
export function contractCardLabel(state: string | null | undefined, deadlineAt: string | null | undefined, now: Date = new Date(), locale?: string): string {
  if (RELEASED_STATES.includes(state ?? '')) {
    const day = formatShortDate(deadlineAt, now, locale);
    return day ? `Day-30 check · ${day}` : 'Day-30 check';
  }
  if (state === 'completed') return 'Done';
  if ((state ?? '').startsWith('resolved_')) return 'Dispute settled';
  const due = formatDue(deadlineAt, now, locale);
  return due ? `Next · ${lowerFirst(due)}` : 'Next';
}

/** Contract `money_state` from `gig_contract_workspace`. */
export type ContractMoneyState = 'on_the_way' | 'ready' | 'paid' | 'refunded' | 'partially_refunded';

/**
 * What happened to the creator's fee once the gig is released (W3.3), from the
 * server's `money_state`. Never says Paid before the server says paid, and says
 * nothing ('') while `money_state` is null (no money captured yet).
 */
export function contractMoneyLine(moneyState: string | null | undefined, paidAt?: string | null, now: Date = new Date(), locale?: string): string {
  switch (moneyState) {
    case 'paid': {
      const day = formatShortDate(paidAt, now, locale);
      return day ? `Paid to your bank on ${day}` : 'Paid to your bank';
    }
    case 'ready': return 'Released and on its way to your bank';
    case 'refunded': return 'The host was refunded';
    case 'partially_refunded': return 'Part of the fee was refunded to the host';
    case 'on_the_way': return 'On its way to your bank';
    default: return '';
  }
}

/** The status card's body text after release: the money line plus the 30-day reminder. */
export function releasedCardText(state: string | null | undefined, moneyState: string | null | undefined, paidAt?: string | null, now: Date = new Date(), locale?: string): string {
  const line = contractMoneyLine(moneyState, paidAt, now, locale);
  const money = line ? `${line}.` : '';
  const reminder = RELEASED_STATES.includes(state ?? '') ? 'Keep the posts live for 30 days.' : '';
  return [money, reminder].filter(Boolean).join(' ');
}

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

// ── #4402: zone-labelled times ─────────────────────────────────────────────

const ZONE_NAMES: Record<string, string> = { UTC: 'UTC', GMT: 'UTC', 'Etc/UTC': 'UTC', 'Etc/GMT': 'UTC' };

/** "Africa/Lagos" → "Lagos time"; "America/Argentina/Buenos_Aires" → "Buenos Aires time". Never a raw offset. */
export function zoneLabel(timeZone: string | null | undefined): string {
  if (!timeZone) return '';
  if (ZONE_NAMES[timeZone]) return ZONE_NAMES[timeZone];
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ').trim();
  return city ? `${city} time` : '';
}

function zoneParts(date: Date, timeZone: string, locale: string): Record<string, string> | null {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(date);
    return Object.fromEntries(parts.map((p) => [p.type, p.value]));
  } catch { return null; }
}

/**
 * "Tue Dec 15, 6:00 PM Lagos time": a moment shown in the listing's own zone, so a
 * host in London and a creator in Lagos read the same hour. No zone known: the device's
 * own time, with no label.
 */
export function formatInZone(value: string | Date | null | undefined, timeZone: string | null | undefined, now: Date = new Date()): string {
  const date = parseDay(value);
  if (!date) return '';
  const parts = timeZone ? zoneParts(date, timeZone, 'en-US') : null;
  if (!parts) return formatDateTime(date, now).replace(' · ', ', ');
  const sameYear = Number(parts.year) === now.getFullYear();
  const day = `${capitalizeFirst(parts.month)} ${parts.day}${sameYear ? '' : `, ${parts.year}`}`;
  return `${parts.weekday} ${day}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod ?? '').toUpperCase()} ${zoneLabel(timeZone)}`.trim();
}

/** "Tue Dec 15" for a calendar day ("2026-12-15") or an instant read in a zone. */
export function formatDayWithWeekday(value: string | Date | null | undefined, timeZone?: string | null, now: Date = new Date()): string {
  if (!value) return '';
  const isDay = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = parseDay(value);
  if (!date) return '';
  if (isDay || !timeZone) return `${WEEKDAYS_SHORT[date.getDay()]} ${formatShortDate(date, now)}`;
  const parts = zoneParts(date, timeZone, 'en-US');
  if (!parts) return `${WEEKDAYS_SHORT[date.getDay()]} ${formatShortDate(date, now)}`;
  return `${parts.weekday} ${capitalizeFirst(parts.month)} ${parts.day}${Number(parts.year) === now.getFullYear() ? '' : `, ${parts.year}`}`;
}
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The agreed video due as "Sun Dec 13, 11:59 PM Lagos time" (zone known) or the older device-time text. */
export function agreedVideoDueZoned(terms: DueSource, gig: DueSource, timeZone: string | null | undefined, now: Date = new Date(), locale?: string): string {
  const due = agreedVideoDue(terms, gig);
  if (timeZone && due.videoDueAt && due.videoDueAt.length > 10) return formatInZone(due.videoDueAt, timeZone, now);
  return videoDueText(due.videoDueAt, due.postBy, now, locale);
}

// ── #4402: the posting deadline ────────────────────────────────────────────

/**
 * The server's deadline is the end of the post-by day in the listing's zone plus a
 * 24 hour grace, stored as the first instant after that. People read the last minute:
 * one minute earlier, so "00:00" shows as "11:59 PM".
 */
export function postDeadlineShown(deadlineAt: string | null | undefined): Date | null {
  const date = parseDay(deadlineAt);
  return date ? new Date(date.getTime() - 60_000) : null;
}

/** "Wed Dec 16, 11:59 PM Lagos time" for the posting deadline. */
export function postDeadlineText(deadlineAt: string | null | undefined, timeZone: string | null | undefined, now: Date = new Date()): string {
  const shown = postDeadlineShown(deadlineAt);
  return shown ? formatInZone(shown, timeZone, now) : '';
}

/** "Due in 9 hours" with under a day left; null otherwise (or once it has passed). */
export function postDueSoonLabel(deadlineAt: string | null | undefined, now: Date = new Date()): string | null {
  const date = parseDay(deadlineAt);
  if (!date) return null;
  const ms = date.getTime() - now.getTime();
  if (ms <= 0 || ms > 86_400_000) return null;
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return `Due in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** Why the upload date is what it is, in one sentence. Null without a post-by date. */
export function uploadDueReason(due: { videoDueAt: string | null; postBy: string | null }, timeZone: string | null | undefined, now: Date = new Date()): string | null {
  if (!due.postBy) return null;
  const postBy = formatDayWithWeekday(due.postBy, null, now);
  const uploadLabel = due.videoDueAt && due.videoDueAt.length > 10 ? formatDayWithWeekday(due.videoDueAt, timeZone, now) : null;
  if (!uploadLabel) return `Upload your video before your post-by date of ${postBy}, so the host has time to review.`;
  const byDays = Math.round((startOfDay(parseDay(due.postBy)!) - startOfDay(parseDay(persistedDayInZone(due.videoDueAt!, timeZone))!)) / DAY_MS);
  return byDays === 2
    ? `Upload by ${uploadLabel} — two days before your post-by date of ${postBy}, so the host has time to review.`
    : `Upload by ${uploadLabel}, before your post-by date of ${postBy}, so the host has time to review.`;
}

function persistedDayInZone(iso: string, timeZone: string | null | undefined): string {
  const date = parseDay(iso)!;
  const parts = timeZone ? zoneParts(date, timeZone, 'en-CA') : null;
  if (!parts) return toDayString(date);
  const month = String(new Date(`${parts.month} 1, 2000`).getMonth() + 1).padStart(2, '0');
  return `${parts.year}-${month}-${parts.day.padStart(2, '0')}`;
}

/** "2 passes under Ada Obi" for the text door pass. */
export function doorPassLine(passes: unknown, name: string | null | undefined): string {
  const n = typeof passes === 'number' && Number.isFinite(passes) && passes > 0 ? Math.floor(passes) : 1;
  return `${n} pass${n === 1 ? '' : 'es'} under ${name?.trim() || 'your name'}`;
}

/** A reason from the review team as a sentence: trimmed, with a closing full stop. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The creator's status-card words for the three posting states, with the deadline in the listing's zone.
 * `accent` is the small line on top ("Due in 9 hours" with under a day left).
 */
export function postingStatusCopy(state: string, deadlineAt: string | null | undefined, timeZone: string | null | undefined, reason: string | null, now: Date = new Date()): { accent: string | null; title: string; text: string } | null {
  const when = postDeadlineText(deadlineAt, timeZone, now);
  const accent = postDueSoonLabel(deadlineAt, now);
  if (state === 'approved') return { accent, title: 'Post your video', text: when ? `Post by ${when}. Add your live links here once it’s up.` : 'Add your live links here once it’s up.' };
  if (state === 'posting') return { accent, title: 'Add your live links', text: when ? `Post by ${when}. If the links aren’t added by then, the gig is cancelled and the host is refunded.` : 'If the links aren’t added in time, the gig is cancelled and the host is refunded.' };
  if (state === 'posts_failed') {
    const fix = reason ? `${sentence(reason)} Edit the caption, then submit the link again.` : 'Edit the post or the link, then submit the link again.';
    return { accent, title: 'One of your posts needs a fix', text: when ? `${fix} Fix by ${when}.` : fix };
  }
  return null;
}

// ── #4402: minimum creator fee ─────────────────────────────────────────────

/** Mirrors the server (issue_4402_gig_min_fee_minor): ₦5,000 / $10 / €10 / £10. Other currencies have none. */
const MIN_FEE_MINOR: Record<string, number> = { NGN: 500_000, USD: 1_000, EUR: 1_000, GBP: 1_000 };
export const BOOKING_FEE_PERCENT = 15;

export function minFeeMinor(currency: string | null | undefined): number | null {
  return MIN_FEE_MINOR[(currency ?? '').toUpperCase()] ?? null;
}

export function isBelowMinFee(minor: number | null | undefined, currency: string | null | undefined): boolean {
  const min = minFeeMinor(currency);
  return min !== null && typeof minor === 'number' && minor > 0 && minor < min;
}

/** "The minimum creator fee is ₦5,000." Empty when the currency has no minimum. */
export function minFeeError(currency: string | null | undefined): string {
  const min = minFeeMinor(currency);
  return min === null ? '' : `The minimum creator fee is ${formatMoney(min, currency)}.`;
}

/**
 * The hint under a fee field. Creator wording ("the host also pays"); `withBooking` adds the
 * 15% booking fee line with the host's total for the fee typed so far.
 */
export function minFeeHint(currency: string | null | undefined, feeMinor: number | null, options: { withBooking?: boolean } = {}): string {
  const min = minFeeMinor(currency);
  const parts: string[] = [];
  if (min !== null) parts.push(`Minimum ${formatMoney(min, currency)}.`);
  if (options.withBooking) {
    const base = `The host also pays Mingla’s ${BOOKING_FEE_PERCENT}% booking fee on top`;
    parts.push(feeMinor && feeMinor > 0
      ? `${base}, so ${formatMoney(feeMinor, currency)} costs the host ${formatMoney(Math.round(feeMinor * (100 + BOOKING_FEE_PERCENT) / 100), currency)}.`
      : `${base}.`);
  }
  return parts.join(' ');
}

// ── #4402: earnings below the payout floor ─────────────────────────────────

export type HeldBelowFloor = { currency: string; held_minor: number; floor_minor: number };

/** "₦100 waiting. Paid once you have ₦1,000 or more in NGN." The floor always comes from the server. */
export function heldBelowFloorText(item: HeldBelowFloor): string {
  return `${formatMoney(item.held_minor, item.currency)} waiting. Paid once you have ${formatMoney(item.floor_minor, item.currency)} or more in ${item.currency.toUpperCase()}.`;
}

export function waitingToReachText(item: HeldBelowFloor): string {
  return `Waiting to reach ${formatMoney(item.floor_minor, item.currency)}`;
}

// ── #4402: the Local pick window ───────────────────────────────────────────

export type PickWindow = { open: boolean; reason?: 'month_start' | 'new_seat' | 'admin' | null; open_until?: string | null; opens_on?: string | null };

function utcDay(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** The last day a pick is accepted. Month-start and new-seat windows end at 00:00 UTC, so that day is the one before. */
export function pickWindowLastDay(window: PickWindow): string | null {
  const until = parseDay(window.open_until ?? null);
  if (!until) return null;
  if (window.reason === 'admin') return toDayString(until);
  return utcDay(new Date(until.getTime() - 1));
}

/** The words for the Local home: an open window with its last day and reason, or the closed line. */
export function pickWindowWords(window: PickWindow | null | undefined, seatStartedOn?: string | null, now: Date = new Date()): { open: boolean; headline: string; detail: string | null } {
  if (!window || window.open) {
    const last = window ? pickWindowLastDay(window) : null;
    const headline = last ? `Pick your place by ${formatDayWithWeekday(last, null, now)}.` : 'Pick your place for this month.';
    const detail = window?.reason === 'new_seat' && seatStartedOn ? `You started on ${formatShortDate(persistedDayString(seatStartedOn), now)}, so you get 7 days to pick.` : null;
    return { open: true, headline, detail };
  }
  const opens = window.opens_on ? ` The next window opens on ${formatDayWithWeekday(persistedDayString(window.opens_on), null, now)}.` : '';
  return { open: false, headline: `Picks for this month are closed.${opens}`, detail: null };
}

// ── #4402: date of birth (typed or picked) and the agreement's sign button ──

/** "15032001" → "15 / 03 / 2001". Digits only; the separators are drawn, never typed. */
export function formatTypedDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join(' / ');
}

/** A complete, real calendar date typed as DD / MM / YYYY → "2001-03-15"; anything else is null. */
export function typedDobToDay(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const day = Number(digits.slice(0, 2)); const month = Number(digits.slice(2, 4)); const year = Number(digits.slice(4, 8));
  if (year < 1900) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toDayString(date);
}

/** "2001-03-15" → "15 / 03 / 2001" (what the typed field shows for a saved date). */
export function dayToTypedDob(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  return m ? `${m[3]} / ${m[2]} / ${m[1]}` : '';
}

export const CREATOR_UNDER_18_ERROR = 'You need to be 18 or older to join as a creator.';

/** The wheel opens 21 years back from today (never later than the last allowed birth date). */
export function dobWheelStart(now: Date = new Date()): Date {
  const start = new Date(now.getFullYear() - 21, now.getMonth(), now.getDate());
  const latest = latestAdultBirthDate(now);
  return start.getTime() > latest.getTime() ? latest : start;
}

/** Why "Sign and continue" is disabled, shown right under it; null when signing is possible. */
export function signBlockReason(input: { hasVersion: boolean; birthDate: string | null; agreed: boolean }, now: Date = new Date()): string | null {
  if (!input.hasVersion) return 'The agreement isn’t ready to sign yet.';
  if (!input.birthDate) return 'Add your date of birth to sign.';
  if (!isAdult(input.birthDate, now)) return CREATOR_UNDER_18_ERROR;
  if (!input.agreed) return 'Tick the box to agree, then sign.';
  return null;
}

/** E21: true when the bank's account name shares no word with the profile name (both must have words). */
export function accountNameMismatch(accountName: string | null | undefined, profileName: string | null | undefined): boolean {
  const words = (text: string | null | undefined): string[] => (text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const a = words(accountName); const b = words(profileName);
  if (!a.length || !b.length) return false;
  return !a.some((w) => b.includes(w));
}
