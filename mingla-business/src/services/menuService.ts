import { supabase } from "./supabase";
import { extractFunctionError } from "../utils/extractFunctionError";

export interface ExtractedMenuItem {
  name: string;
  description: string | null;
  price: number;
  category: string;
  dietary_tags: string[];
  confidence: number;
}

export interface PurchaseOptionSuggestion {
  name: string;
  description: string;
  price: number;
  price_unit: "person" | "pair" | "group" | "flat";
  included_items: string[];
}

export interface SavedMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
  dietary_tags: string[];
  sort_order: number;
  ai_confidence: number | null;
  is_active: boolean;
}

/**
 * Upload a menu photo to storage and return its URL.
 */
export async function uploadMenuPhoto(
  businessProfileId: string,
  uri: string,
  pageNumber: number
): Promise<string> {
  const fileName = `page_${pageNumber}_${Date.now()}.jpg`;
  const path = `${businessProfileId}/${fileName}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from("menu-photos")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  // Menu photos are private — return the storage path, not public URL
  // The extract edge function uses service role to read them
  const { data: urlData } = supabase.storage
    .from("menu-photos")
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Call the extract-menu-items edge function.
 */
export async function extractMenuItems(
  businessProfileId: string,
  photoUrls: string[]
): Promise<{
  items: ExtractedMenuItem[];
  categories: string[];
  totalItems: number;
}> {
  const { data, error } = await supabase.functions.invoke(
    "extract-menu-items",
    {
      body: { business_profile_id: businessProfileId, photo_urls: photoUrls },
    }
  );

  if (error) {
    const msg = await extractFunctionError(
      error,
      "Couldn't read the menu. Try again with better lighting."
    );
    throw new Error(msg);
  }

  return {
    items: data.items ?? [],
    categories: data.categories ?? [],
    totalItems: data.total_items ?? 0,
  };
}

/**
 * Call the generate-purchase-options edge function.
 */
export async function generatePurchaseOptions(
  businessProfileId: string,
  menuItems: { name: string; price: number; category: string }[],
  businessType: "food" | "service" = "food"
): Promise<PurchaseOptionSuggestion[]> {
  const { data, error } = await supabase.functions.invoke(
    "generate-purchase-options",
    {
      body: {
        business_profile_id: businessProfileId,
        menu_items: menuItems,
        business_type: businessType,
      },
    }
  );

  if (error) {
    const msg = await extractFunctionError(
      error,
      "Couldn't generate suggestions"
    );
    throw new Error(msg);
  }

  return data.suggestions ?? [];
}

/**
 * Save menu items to the database (after review).
 */
export async function saveMenuItems(
  businessProfileId: string,
  items: ExtractedMenuItem[]
): Promise<string> {
  // Create menu
  const { data: menu, error: menuError } = await supabase
    .from("menus")
    .insert({ business_profile_id: businessProfileId, type: "food" })
    .select("id")
    .single();

  if (menuError) throw new Error(`Couldn't create menu: ${menuError.message}`);

  // Insert items
  const rows = items.map((item, index) => ({
    menu_id: menu.id,
    name: item.name,
    description: item.description,
    price: item.price,
    category: item.category,
    dietary_tags: item.dietary_tags,
    sort_order: index,
    ai_confidence: item.confidence,
    is_active: true,
  }));

  const { error: itemsError } = await supabase
    .from("menu_items")
    .insert(rows);

  if (itemsError)
    throw new Error(`Couldn't save items: ${itemsError.message}`);

  return menu.id;
}

/**
 * Save purchase options to the database (after review).
 */
export async function savePurchaseOptions(
  businessProfileId: string,
  options: {
    name: string;
    description: string;
    price: number;
    price_unit: string;
  }[]
): Promise<void> {
  const rows = options.map((opt, index) => ({
    business_profile_id: businessProfileId,
    name: opt.name,
    description: opt.description,
    price: opt.price,
    price_unit: opt.price_unit,
    sort_order: index,
    is_active: true,
  }));

  const { error } = await supabase.from("purchase_options").insert(rows);

  if (error)
    throw new Error(`Couldn't save purchase options: ${error.message}`);
}
