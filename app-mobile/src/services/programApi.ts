import { supabase } from './supabase';
import { ProgramActionError, toProgramError, unwrapProgramResult } from './programResult';

/**
 * #4430 L-1: a refused call names its code in Metro and in Sentry breadcrumbs:
 * the mapped code plus the PostgREST code (SQLSTATE). Never the input or the
 * message body.
 */
export function logProgramFailure(kind: 'programRead' | 'programWrite', name: string, error: unknown, mapped: ProgramActionError): void {
  const sqlState = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;
  console.warn(`[${kind}]`, name, mapped.code, sqlState);
}

/**
 * #3872 shared transport for Creator and Local calls. Reads raise mapped
 * errors; writes also turn `{ ok: false }` into a thrown ProgramActionError so
 * no screen can mistake a refusal for success.
 */
export async function programRead<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) {
    const mapped = toProgramError(error);
    logProgramFailure('programRead', name, error, mapped);
    throw mapped;
  }
  return data as T;
}

export async function programWrite<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) {
    const mapped = toProgramError(error);
    logProgramFailure('programWrite', name, error, mapped);
    throw mapped;
  }
  try {
    return unwrapProgramResult(data as T);
  } catch (refusal) {
    if (refusal instanceof ProgramActionError) logProgramFailure('programWrite', name, null, refusal);
    throw refusal;
  }
}

/** Edge call: non-2xx bodies (`{ error, detail }`) become the same mapped errors. */
export async function programEdge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let payload: unknown = null;
    const context = (error as { context?: unknown }).context as Response | undefined;
    if (context && typeof context.json === 'function') {
      try { payload = await context.clone().json(); } catch { payload = null; }
    }
    throw toProgramError(error, payload);
  }
  return unwrapProgramResult(data as T);
}
