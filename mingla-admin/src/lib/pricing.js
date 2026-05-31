// ORCH-1006 [Universal all-in pricing engine] — admin take-rate persist layer.
// Wraps the locked SECURITY DEFINER RPCs (amendment §D.2) over the existing
// Supabase client. One writer per op; returns the persisted value; throws a
// human-readable message on reject. Pessimistic (money safety) — callers await
// and reflect the server-returned value, never optimistic.
import { supabase } from './supabase';

// bps (integer) <-> percent (string, 2dp) helpers. The operator only ever sees
// percent; storage is integer basis points (amendment §A.1, no float drift).
export function bpsToPct(bps) {
  return (Number(bps) / 100).toFixed(2);
}

export function pctToBps(pct) {
  return Math.round(parseFloat(pct) * 100);
}

export function formatPct(bps) {
  if (bps === null || bps === undefined) return '—';
  return `${bpsToPct(bps)}%`;
}

// Guardrail (amendment §A.6): 0–30.00% = 0–3000 bps. Returns null when valid,
// else an error string for inline display.
export function validatePctInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return 'Enter a rate, e.g. 6.00.';
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return 'Use a number with at most two decimals (e.g. 6.25).';
  }
  const val = parseFloat(trimmed);
  if (Number.isNaN(val) || val < 0 || val > 30) {
    return 'Enter a rate between 0% and 30%.';
  }
  return null;
}

export async function getPricingConfig() {
  const { data, error } = await supabase.rpc('admin_get_pricing_config');
  if (error) throw new Error(error.message || 'Could not load pricing config.');
  return data;
}

export async function setGlobalDefault(bps) {
  const { data, error } = await supabase.rpc('admin_set_platform_take_rate', {
    p_bps: bps,
  });
  if (error) throw new Error(humanizeRpcError(error));
  return data;
}

export async function setBrandOverride(brandId, bps) {
  const { data, error } = await supabase.rpc(
    'admin_set_brand_take_rate_override',
    { p_brand_id: brandId, p_bps: bps },
  );
  if (error) throw new Error(humanizeRpcError(error));
  return data;
}

export async function clearBrandOverride(brandId) {
  const { error } = await supabase.rpc('admin_clear_brand_take_rate_override', {
    p_brand_id: brandId,
  });
  if (error) throw new Error(humanizeRpcError(error));
}

function humanizeRpcError(error) {
  const msg = error?.message || '';
  if (msg.includes('not_authorized')) {
    return "You don't have permission to change pricing.";
  }
  if (msg.includes('take_rate_out_of_bounds')) {
    return 'Enter a rate between 0% and 30%.';
  }
  if (msg.includes('brand_not_found')) {
    return 'That brand could not be found.';
  }
  return msg || 'Couldn’t save — try again.';
}
