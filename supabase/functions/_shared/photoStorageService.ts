/**
 * Photo Storage Service — downloads Google Places photos and stores them
 * permanently in Supabase Storage. Eliminates dependency on expiring
 * Google photo references and removes per-view Google API costs.
 *
 * Flow: Google photo reference → download JPEG → upload to Supabase Storage → return public URL
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'place-photos';

const DEFAULT_PLACEHOLDER = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

const CATEGORY_PLACEHOLDERS: Record<string, string> = {
  'Nature': 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80',
  'First Meet': 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&q=80',
  'Picnic & Park': 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=800&q=80',
  'Drink': 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&q=80',
  'Casual Eats': 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80',
  'Fine Dining': 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
  'Watch': 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
  'Creative Arts': 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&q=80',
  'Play': 'https://images.unsplash.com/photo-1526481280693-3bfa7568e0f3?w=800&q=80',
  'Wellness': 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&q=80',
  'Groceries & Flowers': 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80',
  'Work & Business': 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
};

export function getPlaceholderForCategory(category?: string | null): string {
  if (category && CATEGORY_PLACEHOLDERS[category]) {
    return CATEGORY_PLACEHOLDERS[category];
  }
  return DEFAULT_PLACEHOLDER;
}
const MAX_PHOTOS = 5;
const DOWNLOAD_TIMEOUT_MS = 8000;

/**
 * Download photos from Google Places API and store them in Supabase Storage.
 * Returns an array of public Supabase Storage URLs.
 *
 * This function is designed to be called fire-and-forget — it never throws.
 * If any photo fails to download/upload, it's skipped silently.
 */
export async function downloadAndStorePhotos(
  supabaseAdmin: SupabaseClient,
  googlePlaceId: string,
  photos: Array<{ name: string; widthPx?: number; heightPx?: number }>,
  apiKey: string,
): Promise<string[]> {
  if (!photos || photos.length === 0 || !apiKey || !googlePlaceId) return [];

  const storedUrls: string[] = [];
  const photosToProcess = photos.slice(0, MAX_PHOTOS);

  // Sanitize googlePlaceId for use as a storage path (remove special chars)
  const safePlaceId = googlePlaceId.replace(/[^a-zA-Z0-9_-]/g, '_');

  for (let i = 0; i < photosToProcess.length; i++) {
    const photo = photosToProcess[i];
    if (!photo.name) continue;

    try {
      // Download from Google Places Media API
      const googleUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      const response = await fetch(googleUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'image/jpeg, image/png, image/webp, */*' },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[photo-storage] Download failed for ${safePlaceId}/${i}: HTTP ${response.status}`);
        continue;
      }

      // Read as array buffer
      const imageData = await response.arrayBuffer();
      if (imageData.byteLength === 0) continue;

      // Determine content type from response
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const storagePath = `${safePlaceId}/${i}.${ext}`;

      // Upload to Supabase Storage (upsert — overwrites if exists)
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, imageData, {
          contentType,
          upsert: true,
          cacheControl: '31536000', // 1 year cache (photos don't change)
        });

      if (uploadError) {
        console.warn(`[photo-storage] Upload failed for ${storagePath}:`, uploadError.message);
        continue;
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      if (urlData?.publicUrl) {
        storedUrls.push(urlData.publicUrl);
      }
    } catch (err) {
      // Individual photo failure is non-fatal — skip and continue
      if ((err as any)?.name === 'AbortError') {
        console.warn(`[photo-storage] Download timeout for ${safePlaceId}/${i}`);
      }
      // Other errors are silently skipped
    }
  }

  // Update place_pool with stored URLs
  if (storedUrls.length > 0) {
    await supabaseAdmin
      .from('place_pool')
      .update({ stored_photo_urls: storedUrls })
      .eq('google_place_id', googlePlaceId)
      .catch(() => {}); // Non-fatal
  }

  return storedUrls;
}

/**
 * Get the best available photo URL for a place.
 * Prefers stored Supabase URL over constructing a Google URL.
 */
export function resolvePhotoUrl(
  storedPhotoUrls: string[] | null | undefined,
  googlePhotoName: string | null | undefined,
  apiKey: string,
  fallback?: string,
  category?: string | null,
): string {
  if (storedPhotoUrls && storedPhotoUrls.length > 0 && storedPhotoUrls[0]) {
    return storedPhotoUrls[0];
  }
  return fallback || getPlaceholderForCategory(category);
}

/**
 * Get all available photo URLs for a place (up to max).
 * Prefers stored Supabase URLs, fills remaining from Google references.
 */
export function resolveAllPhotoUrls(
  storedPhotoUrls: string[] | null | undefined,
  googlePhotos: Array<{ name?: string }> | null | undefined,
  apiKey: string,
  max: number = 5,
): string[] {
  const urls: string[] = [];

  if (storedPhotoUrls) {
    for (const url of storedPhotoUrls) {
      if (url && urls.length < max) urls.push(url);
    }
  }
  return urls;
}
