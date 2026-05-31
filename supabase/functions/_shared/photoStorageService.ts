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
const DOWNLOAD_TIMEOUT_MS = 12000;
const DELAY_BETWEEN_PHOTOS_MS = 200;
const RATE_LIMIT_DELAY_MS = 2000;

export type PlacePhotoMetadata = {
  name: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: unknown[];
};

export type PhotoBackfillFailureStage =
  | 'media_cached'
  | 'details_refresh'
  | 'media_refreshed'
  | 'storage'
  | 'thumb';

export interface PhotoBackfillFailure {
  stage: PhotoBackfillFailureStage;
  status?: number;
  code: string;
  message: string;
  retryable: boolean;
  refreshable?: boolean;
  photoName?: string;
}

export interface PhotoBackfillDiagnosticResult {
  storedUrls: string[];
  refreshed: boolean;
  freshPhotoCount: number;
  failures: PhotoBackfillFailure[];
}

export interface PhotoBackfillFailedPlace {
  placePoolId: string;
  googlePlaceId: string;
  error: string;
  code: string;
  retryable: boolean;
  refreshed: boolean;
  failures: PhotoBackfillFailure[];
}

interface PhotoDownloadOptions {
  fetchImpl?: typeof fetch;
  delayBetweenPhotosMs?: number;
  rateLimitDelayMs?: number;
}

interface AttemptResult {
  storedUrls: string[];
  failures: PhotoBackfillFailure[];
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeGooglePlaceId(googlePlaceId: string): string {
  return googlePlaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeBarePlaceId(googlePlaceId: string): string {
  return googlePlaceId.startsWith('places/')
    ? googlePlaceId.slice('places/'.length)
    : googlePlaceId;
}

function summarizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim().substring(0, 200);
}

function classifyMediaHttpFailure(
  stage: 'media_cached' | 'media_refreshed',
  status: number,
  body: string,
  photoName: string,
): PhotoBackfillFailure {
  const normalizedBody = body.toLowerCase();
  if (status === 429) {
    return {
      stage,
      status,
      code: 'PHOTO_MEDIA_RATE_LIMIT',
      message: 'Google Places media request was rate limited',
      retryable: true,
      refreshable: false,
      photoName,
    };
  }
  if (status >= 500) {
    return {
      stage,
      status,
      code: 'PHOTO_MEDIA_PROVIDER_5XX',
      message: 'Google Places media request failed with a provider error',
      retryable: true,
      refreshable: false,
      photoName,
    };
  }
  if (status === 401 || status === 403) {
    return {
      stage,
      status,
      code: 'PHOTO_MEDIA_AUTH_OR_QUOTA',
      message: `Google Places media request was denied${body ? `: ${summarizeBody(body)}` : ''}`,
      retryable: false,
      refreshable: false,
      photoName,
    };
  }
  if (
    status === 400 ||
    status === 404 ||
    normalizedBody.includes('invalid_argument') ||
    (normalizedBody.includes('invalid') && normalizedBody.includes('photo'))
  ) {
    return {
      stage,
      status,
      code: 'PHOTO_MEDIA_NAME_INVALID',
      message: `Google Places photo media name was invalid or expired${body ? `: ${summarizeBody(body)}` : ''}`,
      retryable: false,
      refreshable: true,
      photoName,
    };
  }
  return {
    stage,
    status,
    code: 'PHOTO_MEDIA_HTTP_ERROR',
    message: `Google Places media request failed with HTTP ${status}${body ? `: ${summarizeBody(body)}` : ''}`,
    retryable: false,
    refreshable: false,
    photoName,
  };
}

function shouldRefreshPhotoNames(failures: PhotoBackfillFailure[]): boolean {
  return failures.length > 0 && failures.every((failure) => failure.refreshable === true);
}

function isRetryableProviderPressure(failures: PhotoBackfillFailure[]): boolean {
  return failures.length > 0 && failures.every((failure) => failure.retryable === true);
}

export function photoBackfillFailureSummary(result: PhotoBackfillDiagnosticResult): {
  error: string;
  code: string;
  retryable: boolean;
} {
  if (result.failures.some((failure) => failure.stage === 'details_refresh')) {
    const detailsFailure = result.failures.find((failure) => failure.stage === 'details_refresh');
    return {
      error: detailsFailure?.message ?? 'Google Place Details photo refresh failed',
      code: detailsFailure?.code ?? 'PHOTO_DETAILS_REFRESH_FAILED',
      retryable: detailsFailure?.retryable ?? false,
    };
  }

  const decisiveFailures = result.refreshed
    ? result.failures.filter((failure) => !(failure.stage === 'media_cached' && failure.refreshable === true))
    : result.failures;

  if (result.refreshed) {
    const retryable = isRetryableProviderPressure(decisiveFailures);
    if (retryable && decisiveFailures[0]) {
      return {
        error: decisiveFailures[0].message,
        code: decisiveFailures[0].code,
        retryable: true,
      };
    }
    return {
      error: 'Photo media names expired; Place Details refresh returned no usable media',
      code: 'PHOTO_NAME_REFRESH_EXHAUSTED',
      retryable,
    };
  }

  const firstFailure = decisiveFailures[0];
  if (firstFailure) {
    return {
      error: firstFailure.message,
      code: firstFailure.code,
      retryable: isRetryableProviderPressure(decisiveFailures),
    };
  }

  return {
    error: 'All photo downloads failed',
    code: 'PHOTO_DOWNLOAD_FAILED',
    retryable: false,
  };
}

export function formatPhotoBackfillFailedPlace(
  placePoolId: string,
  googlePlaceId: string,
  result: PhotoBackfillDiagnosticResult,
): PhotoBackfillFailedPlace {
  const summary = photoBackfillFailureSummary(result);
  return {
    placePoolId,
    googlePlaceId,
    error: summary.error,
    code: summary.code,
    retryable: summary.retryable,
    refreshed: result.refreshed,
    failures: result.failures,
  };
}

export async function fetchFreshPlacePhotos(
  googlePlaceId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ photos: PlacePhotoMetadata[]; failure?: PhotoBackfillFailure }> {
  if (!googlePlaceId || !apiKey) {
    return {
      photos: [],
      failure: {
        stage: 'details_refresh',
        code: 'PHOTO_DETAILS_REFRESH_CONFIG_MISSING',
        message: 'Missing Google place ID or API key for Place Details photo refresh',
        retryable: false,
      },
    };
  }

  const barePlaceId = normalizeBarePlaceId(googlePlaceId);
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(barePlaceId)}`;

  try {
    const response = await fetchImpl(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,photos',
      },
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return {
        photos: [],
        failure: {
          stage: 'details_refresh',
          status: response.status,
          code: 'PHOTO_DETAILS_REFRESH_FAILED',
          message: `Google Place Details photo refresh failed with HTTP ${response.status}${errBody ? `: ${summarizeBody(errBody)}` : ''}`,
          retryable: response.status === 429 || response.status >= 500,
        },
      };
    }

    const body = await response.json().catch(() => null) as { photos?: unknown } | null;
    const photos = Array.isArray(body?.photos)
      ? body.photos.filter((photo): photo is PlacePhotoMetadata =>
        !!photo &&
        typeof photo === 'object' &&
        typeof (photo as { name?: unknown }).name === 'string' &&
        (photo as { name: string }).name.trim().length > 0
      )
      : [];

    if (photos.length === 0) {
      return {
        photos: [],
        failure: {
          stage: 'details_refresh',
          code: 'PHOTO_DETAILS_REFRESH_NO_PHOTOS',
          message: 'Google Place Details photo refresh returned no usable photos',
          retryable: false,
        },
      };
    }

    return { photos };
  } catch (err) {
    return {
      photos: [],
      failure: {
        stage: 'details_refresh',
        code: (err as any)?.name === 'AbortError'
          ? 'PHOTO_DETAILS_REFRESH_TIMEOUT'
          : 'PHOTO_DETAILS_REFRESH_NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      },
    };
  }
}

async function attemptStorePhotos(
  supabaseAdmin: SupabaseClient,
  googlePlaceId: string,
  photos: PlacePhotoMetadata[],
  apiKey: string,
  stage: 'media_cached' | 'media_refreshed',
  options: Required<Pick<PhotoDownloadOptions, 'fetchImpl' | 'delayBetweenPhotosMs' | 'rateLimitDelayMs'>>,
): Promise<AttemptResult> {
  const storedUrls: string[] = [];
  const failures: PhotoBackfillFailure[] = [];
  const photosToProcess = photos.slice(0, MAX_PHOTOS);
  const safePlaceId = safeGooglePlaceId(googlePlaceId);

  for (let i = 0; i < photosToProcess.length; i++) {
    const photo = photosToProcess[i];
    if (!photo.name) {
      failures.push({
        stage,
        code: 'PHOTO_NAME_MISSING',
        message: 'Google photo metadata is missing a photo name',
        retryable: false,
        refreshable: true,
      });
      continue;
    }

    try {
      const googleUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      const response = await options.fetchImpl(googleUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'image/jpeg, image/png, image/webp, */*' },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        const failure = classifyMediaHttpFailure(stage, response.status, errBody, photo.name);
        failures.push(failure);
        console.warn(`[photo-storage] Download failed for ${safePlaceId}/${i}: HTTP ${response.status} - ${summarizeBody(errBody)}`);
        if (response.status === 429) {
          await delay(options.rateLimitDelayMs);
        }
        continue;
      }

      const imageData = await response.arrayBuffer();
      if (imageData.byteLength === 0) {
        failures.push({
          stage,
          code: 'PHOTO_MEDIA_EMPTY_BODY',
          message: 'Google Places media response body was empty',
          retryable: false,
          refreshable: false,
          photoName: photo.name,
        });
        continue;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const storagePath = `${safePlaceId}/${i}.${ext}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, imageData, {
          contentType,
          upsert: true,
          cacheControl: '31536000',
        });

      if (uploadError) {
        failures.push({
          stage: 'storage',
          code: 'PHOTO_STORAGE_UPLOAD_FAILED',
          message: uploadError.message,
          retryable: false,
          photoName: photo.name,
        });
        console.warn(`[photo-storage] Upload failed for ${storagePath}:`, uploadError.message);
        continue;
      }

      const { data: urlData } = supabaseAdmin.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      if (urlData?.publicUrl) {
        storedUrls.push(urlData.publicUrl);
      }

      if (i < photosToProcess.length - 1) {
        await delay(options.delayBetweenPhotosMs);
      }
    } catch (err) {
      const isTimeout = (err as any)?.name === 'AbortError';
      failures.push({
        stage,
        code: isTimeout ? 'PHOTO_MEDIA_TIMEOUT' : 'PHOTO_MEDIA_NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        refreshable: false,
        photoName: photo.name,
      });
      if (isTimeout) {
        console.warn(`[photo-storage] Download timeout for ${safePlaceId}/${i}`);
      } else {
        console.error(`[photo-storage] Download error for ${safePlaceId}/${i}:`,
          err instanceof Error ? err.message : String(err));
      }
    }
  }

  return { storedUrls, failures };
}

async function updateStoredPhotoUrls(
  supabaseAdmin: SupabaseClient,
  googlePlaceId: string,
  storedUrls: string[],
): Promise<PhotoBackfillFailure | null> {
  if (storedUrls.length === 0) return null;

  try {
    const updatePayload: Record<string, unknown> = { stored_photo_urls: storedUrls };
    const { error: updateErr } = await supabaseAdmin
      .from('place_pool')
      .update(updatePayload)
      .eq('google_place_id', googlePlaceId);

    if (updateErr) {
      console.error(`[photo-storage] DB update failed for ${googlePlaceId}:`, updateErr.message);
      return {
        stage: 'storage',
        code: 'PHOTO_DB_STORED_URL_UPDATE_FAILED',
        message: updateErr.message,
        retryable: false,
      };
    }
  } catch (err) {
    console.error(`[photo-storage] DB update error for ${googlePlaceId}:`,
      err instanceof Error ? err.message : String(err));
    return {
      stage: 'storage',
      code: 'PHOTO_DB_STORED_URL_UPDATE_ERROR',
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }

  return null;
}

async function updateFreshPhotoMetadata(
  supabaseAdmin: SupabaseClient,
  googlePlaceId: string,
  freshPhotos: PlacePhotoMetadata[],
): Promise<PhotoBackfillFailure | null> {
  try {
    const { error } = await supabaseAdmin
      .from('place_pool')
      .update({ photos: freshPhotos })
      .eq('google_place_id', googlePlaceId);
    if (error) {
      return {
        stage: 'details_refresh',
        code: 'PHOTO_DETAILS_METADATA_UPDATE_FAILED',
        message: error.message,
        retryable: false,
      };
    }
  } catch (err) {
    return {
      stage: 'details_refresh',
      code: 'PHOTO_DETAILS_METADATA_UPDATE_ERROR',
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }
  return null;
}

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
  photos: PlacePhotoMetadata[],
  apiKey: string,
): Promise<string[]> {
  const result = await downloadAndStorePhotosWithDiagnostics(
    supabaseAdmin,
    googlePlaceId,
    photos,
    apiKey,
  );
  return result.storedUrls;
}

export async function downloadAndStorePhotosWithDiagnostics(
  supabaseAdmin: SupabaseClient,
  googlePlaceId: string,
  photos: PlacePhotoMetadata[],
  apiKey: string,
  options: PhotoDownloadOptions = {},
): Promise<PhotoBackfillDiagnosticResult> {
  if (!photos || photos.length === 0 || !apiKey || !googlePlaceId) {
    return { storedUrls: [], refreshed: false, freshPhotoCount: 0, failures: [] };
  }

  const resolvedOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    delayBetweenPhotosMs: options.delayBetweenPhotosMs ?? DELAY_BETWEEN_PHOTOS_MS,
    rateLimitDelayMs: options.rateLimitDelayMs ?? RATE_LIMIT_DELAY_MS,
  };

  const cachedAttempt = await attemptStorePhotos(
    supabaseAdmin,
    googlePlaceId,
    photos,
    apiKey,
    'media_cached',
    resolvedOptions,
  );
  const failures = [...cachedAttempt.failures];

  if (cachedAttempt.storedUrls.length > 0) {
    const updateFailure = await updateStoredPhotoUrls(
      supabaseAdmin,
      googlePlaceId,
      cachedAttempt.storedUrls,
    );
    if (updateFailure) failures.push(updateFailure);
    return {
      storedUrls: cachedAttempt.storedUrls,
      refreshed: false,
      freshPhotoCount: 0,
      failures,
    };
  }

  if (!shouldRefreshPhotoNames(cachedAttempt.failures)) {
    return {
      storedUrls: [],
      refreshed: false,
      freshPhotoCount: 0,
      failures,
    };
  }

  const refresh = await fetchFreshPlacePhotos(googlePlaceId, apiKey, resolvedOptions.fetchImpl);
  if (refresh.failure) {
    failures.push(refresh.failure);
    return {
      storedUrls: [],
      refreshed: true,
      freshPhotoCount: 0,
      failures,
    };
  }

  const metadataUpdateFailure = await updateFreshPhotoMetadata(
    supabaseAdmin,
    googlePlaceId,
    refresh.photos,
  );
  if (metadataUpdateFailure) failures.push(metadataUpdateFailure);

  const refreshedAttempt = await attemptStorePhotos(
    supabaseAdmin,
    googlePlaceId,
    refresh.photos,
    apiKey,
    'media_refreshed',
    resolvedOptions,
  );
  failures.push(...refreshedAttempt.failures);

  if (refreshedAttempt.storedUrls.length > 0) {
    const updateFailure = await updateStoredPhotoUrls(
      supabaseAdmin,
      googlePlaceId,
      refreshedAttempt.storedUrls,
    );
    if (updateFailure) failures.push(updateFailure);
  }

  return {
    storedUrls: refreshedAttempt.storedUrls,
    refreshed: true,
    freshPhotoCount: refresh.photos.length,
    failures,
  };
}

/**
 * Get the best available photo URL for a place.
 * Prefers stored Supabase URL over constructing a Google URL.
 */
export function resolvePhotoUrl(
  storedPhotoUrls: string[] | null | undefined,
  googlePhotoName: string | null | undefined,
  apiKey: string,
  fallback?: string | null,
  category?: string | null,
): string | null {
  if (storedPhotoUrls && storedPhotoUrls.length > 0 && storedPhotoUrls[0]) {
    return storedPhotoUrls[0];
  }
  return fallback || null;
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
