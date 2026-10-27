import { supabase } from './supabase';
import { toProgramError, unwrapProgramResult } from './programResult';

/**
 * #3872 shared transport for Creator and Local calls. Reads raise mapped
 * errors; writes also turn `{ ok: false }` into a thrown ProgramActionError so
 * no screen can mistake a refusal for success.
 */
export async function programRead<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw toProgramError(error);
  return data as T;
}

export async function programWrite<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw toProgramError(error);
  return unwrapProgramResult(data as T);
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
