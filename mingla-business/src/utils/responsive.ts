import { Dimensions, PixelRatio } from "react-native";

const BASE_WIDTH = 390;
const BASE_HEIGHT = 844;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const widthScale = SCREEN_WIDTH / BASE_WIDTH;
const heightScale = SCREEN_HEIGHT / BASE_HEIGHT;

export function scale(size: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(size * widthScale));
}

export function verticalScale(size: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(size * heightScale));
}

export { SCREEN_WIDTH, SCREEN_HEIGHT };
export const s = scale;
export const vs = verticalScale;
