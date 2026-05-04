// ORCH-0708 Phase 0 — labelsService
//
// Thin Supabase wrapper for photo_aesthetic_labels CRUD. AnchorsTab and
// FixturesTab share these helpers so cache shape + query keys + error
// contracts stay consistent.

import { supabase } from "../../lib/supabase";

const PLACE_POOL_COLS =
  "id, name, primary_type, types, rating, review_count, address, city, stored_photo_urls, photo_aesthetic_data";

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchAnchorLabels() {
  const { data, error } = await supabase
    .from("photo_aesthetic_labels")
    .select(`*, place:place_pool!place_pool_id(${PLACE_POOL_COLS})`)
    .eq("role", "anchor")
    .order("labeled_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchFixtureLabels() {
  const { data, error } = await supabase
    .from("photo_aesthetic_labels")
    .select(`*, place:place_pool!place_pool_id(${PLACE_POOL_COLS})`)
    .eq("role", "fixture")
    .order("labeled_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function insertAnchorLabel({
  place_pool_id,
  label_category,
  expected_aggregate,
  notes,
  commit,
}) {
  const labeledBy = (await supabase.auth.getUser()).data?.user?.id || null;
  const { data, error } = await supabase
    .from("photo_aesthetic_labels")
    .insert({
      place_pool_id,
      role: "anchor",
      label_category,
      expected_aggregate,
      notes,
      labeled_by: labeledBy,
      committed_at: commit ? new Date().toISOString() : null,
    })
    .select(`*, place:place_pool!place_pool_id(${PLACE_POOL_COLS})`)
    .single();
  if (error) throw error;
  return data;
}

export async function insertFixtureLabel({
  place_pool_id,
  city,
  expected_aggregate,
  notes,
  commit,
}) {
  const labeledBy = (await supabase.auth.getUser()).data?.user?.id || null;
  const { data, error } = await supabase
    .from("photo_aesthetic_labels")
    .insert({
      place_pool_id,
      role: "fixture",
      city,
      expected_aggregate,
      notes,
      labeled_by: labeledBy,
      committed_at: commit ? new Date().toISOString() : null,
    })
    .select(`*, place:place_pool!place_pool_id(${PLACE_POOL_COLS})`)
    .single();
  if (error) throw error;
  return data;
}

export async function updateLabel({ id, expected_aggregate, notes, commit }) {
  const patch = { expected_aggregate, notes };
  if (commit === true) patch.committed_at = new Date().toISOString();
  if (commit === false) patch.committed_at = null;
  const { data, error } = await supabase
    .from("photo_aesthetic_labels")
    .update(patch)
    .eq("id", id)
    .select(`*, place:place_pool!place_pool_id(${PLACE_POOL_COLS})`)
    .single();
  if (error) throw error;
  return data;
}

// Anchor swap collision: un-commit the existing committed anchor for a category
// before committing a new one. This avoids the partial unique index conflict.
export async function uncommitAnchorByCategory(label_category) {
  const { error } = await supabase
    .from("photo_aesthetic_labels")
    .update({ committed_at: null })
    .eq("role", "anchor")
    .eq("label_category", label_category)
    .not("committed_at", "is", null);
  if (error) throw error;
}

export async function deleteLabel(id) {
  const { error } = await supabase
    .from("photo_aesthetic_labels")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
