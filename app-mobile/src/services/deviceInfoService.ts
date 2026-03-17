import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeviceInfo {
  device_os: string;
  device_os_version: string;
  device_model: string;
  app_version: string;
}

// ── Implementation ──────────────────────────────────────────────────────────

export function getDeviceInfo(): DeviceInfo {
  return {
    device_os: Platform.OS,
    device_os_version: Device.osVersion ?? 'unknown',
    device_model: Device.modelName ?? 'unknown',
    app_version: Constants.expoConfig?.version ?? 'unknown',
  };
}
