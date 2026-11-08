/**
 * #4304 — media speed (C). Sign-out empties expo-image's memory and disk
 * caches so a shared phone never shows the previous account's Brand-group
 * photos (Constitution #6). Called from clearAllStores() on every sign-out
 * path, including app launches where the chat was never opened (the disk
 * cache outlives the process). expo-image is resolved at use so this file
 * adds no module-scope expo import to the boot path.
 */
export async function clearBrandGroupImageCaches(): Promise<void> {
  const { Image } = await import("expo-image");
  const results = await Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) throw new Error(`image_cache_clear_failed:${failed.length}`);
}
