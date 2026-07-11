/**
 * ORCH-1322 [consumer-android-media-permission-latent] —
 * shared gallery (media-library) permission wrapper.
 *
 * WHY: Google Play's Photo & Video Permissions policy forbids an app that only
 * PICKS occasional media from holding READ_MEDIA_* / *_EXTERNAL_STORAGE. The
 * consumer app now force-strips those permissions (app.json
 * expo.android.blockedPermissions) and relies on the Android Photo Picker
 * (launchImageLibraryAsync), which needs NO runtime permission on any supported
 * Android version. So on Android this wrapper short-circuits to a granted
 * response WITHOUT calling the underlying expo-image-picker
 * requestMediaLibraryPermissionsAsync — otherwise, on Android <= 12, the OS
 * would deny the now-stripped storage permission and the two block-on-denial
 * gallery gates (BetaFeedbackModal, MessageInterface) would DEAD-TAP.
 *
 * iOS is unchanged: it still gates on NSPhotoLibraryUsageDescription, so this
 * delegates to the real expo-image-picker permission request and returns its
 * result verbatim.
 *
 * Mirrors the shipped ORCH-1321 business wrapper (mingla-business
 * src/utils/platformImagePicker.native.ts requestMediaLibraryPermissionsAsync).
 *
 * Enforced by:
 *  - .github/scripts/strict-grep/orch-1322-gallery-permission-wrapper-routed.mjs
 *  - I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/**
 * Request gallery (media-library) permission for a library pick.
 *
 * Android: returns a granted response synchronously WITHOUT invoking the
 * underlying expo-image-picker request (the Android Photo Picker needs none).
 * iOS: delegates to ImagePicker.requestMediaLibraryPermissionsAsync() and
 * returns its result verbatim (still gated on NSPhotoLibraryUsageDescription).
 */
export async function requestGalleryPermission(): Promise<ImagePicker.MediaLibraryPermissionResponse> {
  if (Platform.OS === 'android') {
    return {
      granted: true,
      canAskAgain: true,
      status: ImagePicker.PermissionStatus.GRANTED,
      expires: 'never',
    };
  }
  return ImagePicker.requestMediaLibraryPermissionsAsync();
}
