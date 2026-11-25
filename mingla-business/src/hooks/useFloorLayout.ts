/**
 * #4490 spec 08 §2 — `useFloorLayout`: the width class of the floor screens
 * (Till, kitchen and bar), from `useWindowDimensions` on every platform so it
 * follows rotation and browser resizing.
 */
import { useWindowDimensions } from "react-native";

import { floorLayoutFor, stationBoardColumns, type FloorLayout } from "../utils/floorLayout";

export interface FloorLayoutState {
  layout: FloorLayout;
  width: number;
  height: number;
  /** Station board: three columns (true; desk, or a tablet in landscape) or Tabs (false). */
  boardColumns: boolean;
}

export function useFloorLayout(): FloorLayoutState {
  const { width, height } = useWindowDimensions();
  const layout = floorLayoutFor(width);
  return { layout, width, height, boardColumns: stationBoardColumns(layout, width, height) };
}
