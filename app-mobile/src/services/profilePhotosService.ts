import { supabase } from './supabase';

export interface ProfilePhoto {
  url: string;
  position: number; // 0, 1, or 2
}

/**
 * Upload a gallery photo to Supabase Storage and update the photos array on profiles.
 * Uses the same storage bucket ("avatars") and upload pattern as avatar uploads.
 */
export async function uploadProfilePhoto(
  userId: string,
  imageUri: string,
  position: number
): Promise<string> {
  if (position < 0 || position > 2) {
    throw new Error('Position must be 0, 1, or 2');
  }

  // 1. Upload to storage
  const fileExt = imageUri.split('.').pop()?.toLowerCase() || 'jpg';
  const fileName = `${userId}_photo_${position}_${Date.now()}.${fileExt}`;
  const filePath = `avatars/${fileName}`;

  const formData = new FormData();
  formData.append('file', {
    uri: imageUri,
    type: `image/${fileExt === 'jpg' || fileExt === 'jpeg' ? 'jpeg' : fileExt}`,
    name: fileName,
  } as any);

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, formData, {
      contentType: `image/${fileExt === 'jpg' || fileExt === 'jpeg' ? 'jpeg' : fileExt}`,
      upsert: false,
    });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  // 2. Get public URL
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);

  // 3. Read current photos array
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('photos')
    .eq('id', userId)
    .single();

  if (readError) throw new Error(`Failed to read profile: ${readError.message}`);

  // 4. Update array at position
  const currentPhotos: string[] = profile?.photos ?? [];
  const updatedPhotos = [...currentPhotos];
  // Pad array if needed
  while (updatedPhotos.length <= position) {
    updatedPhotos.push('');
  }
  updatedPhotos[position] = publicUrl;

  // 5. Write back
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ photos: updatedPhotos })
    .eq('id', userId);

  if (updateError) throw new Error(`Failed to update photos: ${updateError.message}`);

  return publicUrl;
}

/**
 * Delete a gallery photo by clearing the position in the photos array.
 */
export async function deleteProfilePhoto(
  userId: string,
  position: number
): Promise<void> {
  if (position < 0 || position > 2) {
    throw new Error('Position must be 0, 1, or 2');
  }

  // 1. Read current photos array
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('photos')
    .eq('id', userId)
    .single();

  if (readError) throw new Error(`Failed to read profile: ${readError.message}`);

  const currentPhotos: string[] = profile?.photos ?? [];
  if (position >= currentPhotos.length || !currentPhotos[position]) {
    return; // Nothing to delete
  }

  // 2. Remove the URL at position, compact the array (remove empty trailing slots)
  const updatedPhotos = [...currentPhotos];
  updatedPhotos.splice(position, 1);
  // Filter out any empty strings
  const cleanedPhotos = updatedPhotos.filter((url) => url && url.length > 0);

  // 3. Write back
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ photos: cleanedPhotos })
    .eq('id', userId);

  if (updateError) throw new Error(`Failed to update photos: ${updateError.message}`);
}

/**
 * Get gallery photos for a user.
 */
export async function getProfilePhotos(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('photos')
    .eq('id', userId)
    .single();

  if (error) throw new Error(`Failed to get photos: ${error.message}`);
  return (data?.photos ?? []).filter((url: string) => url && url.length > 0);
}
