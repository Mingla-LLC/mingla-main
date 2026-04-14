import Constants from 'expo-constants';
import type { DiscoverMapProviderKind } from './types';

const DEMO_MAPLIBRE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readExpoExtraString(key: string) {
  const extraValue = expoExtra[key];
  return typeof extraValue === 'string' && extraValue.trim().length > 0
    ? extraValue.trim()
    : undefined;
}

// ORCH-0410: Android will use react-native-maps (Google Maps) once a native build
// includes the API key in AndroidManifest.xml. Until then, Android stays on MapLibre
// to prevent crash: "API key not found" (Sentry 2026-04-14).
//
// iOS: Apple Maps via react-native-maps (working).
// Android: MapLibre until next native build, then react-native-maps + Google Maps.
//
// Native build with Google Maps API key deployed — safe to unify now.
// History: dual-provider introduced in 649d2d1e. MapLibre was first implementation;
// iOS fell back to react-native-maps when MapLibre crashed (EXC_BAD_ACCESS).
// Revert: change to `Platform.OS === 'ios' ? 'react-native-maps' : 'maplibre'`
export const ACTIVE_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind = 'react-native-maps';

// [DEAD CODE after ORCH-0410] MapLibre style URL — only referenced by MapLibreProvider.tsx
// which is no longer the active provider. Kept for rollback path.
export const MAPLIBRE_STYLE_URL =
  process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL ??
  readExpoExtraString('EXPO_PUBLIC_MAPLIBRE_STYLE_URL') ??
  DEMO_MAPLIBRE_STYLE_URL;
