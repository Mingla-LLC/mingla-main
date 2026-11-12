/**
 * #4389 Door mode — the payment method remembered for an event on this phone.
 *
 * AsyncStorage is per device, and the key carries the user and the event
 * (doorMethodMemoryKey), so two hosts on one phone, or one host on two events,
 * never share a choice. The screen reads it once after mount and picks a method
 * only once the read has finished (hydration), so a remembered Cash never
 * flashes as Tap to Pay first.
 *
 * A storage failure never blocks a sale: reads fall back to "never set" and
 * writes are reported, not thrown.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import {
  doorMethodMemoryKey,
  parseDoorMethodMemory,
  type DoorMethodMemory,
  type DoorModeChipMethod,
} from "./doorModeState";

export const readDoorMethodMemory = async (userId: string, eventId: string): Promise<DoorMethodMemory> => {
  try {
    return parseDoorMethodMemory(await AsyncStorage.getItem(doorMethodMemoryKey(userId, eventId)));
  } catch (error) {
    reportNonFatal("door-mode.method-read", error);
    return { method: null, noted: false };
  }
};

export const writeDoorMethodMemory = async (
  userId: string,
  eventId: string,
  memory: { method: DoorModeChipMethod; noted: boolean },
): Promise<void> => {
  try {
    await AsyncStorage.setItem(doorMethodMemoryKey(userId, eventId), JSON.stringify(memory));
  } catch (error) {
    reportNonFatal("door-mode.method-write", error);
  }
};
