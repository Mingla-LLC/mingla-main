/**
 * #4430 L-7: a second Pick for the same month hits the database's one-pick-per-month
 * unique key. That is not a failure for the Local: the pick is saved, the screen only
 * needs to refresh. Pure on purpose (no imports) so the unit suite runs it under Deno.
 */
export const MONTH_ALREADY_PICKED = 'month_already_picked';
export const MONTH_PICK_CONSTRAINT = 'local_months_local_id_month_key';

/** True for the mapped ProgramActionError and for the raw PostgREST unique-violation shapes. */
export function isMonthAlreadyPicked(error: unknown): boolean {
  if (typeof error === 'string') return error.includes(MONTH_PICK_CONSTRAINT);
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  if (e.code === MONTH_ALREADY_PICKED) return true;
  const text = [e.message, e.details].filter((v): v is string => typeof v === 'string').join(' ');
  if (text.includes(MONTH_PICK_CONSTRAINT)) return true;
  return e.code === '23505' && /local_months/.test(text);
}
