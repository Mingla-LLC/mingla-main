const React = require("react");
const { Animated: RNAnimated, Easing: RNEasing } = require("react-native");

const identity = (value) => value;
const linear = (value) => value;
const bezier =
  RNEasing?.bezier ??
  ((_x1, _y1, _x2, _y2) => linear);

const Easing = {
  ...(RNEasing ?? {}),
  linear: RNEasing?.linear ?? linear,
  bezier,
  cubic: RNEasing?.cubic ?? ((value) => value * value * value),
  in: RNEasing?.in ?? identity,
  out: RNEasing?.out ?? identity,
  inOut: RNEasing?.inOut ?? identity,
};

const useSharedValue = (initialValue) => {
  const ref = React.useRef({ value: initialValue });
  return ref.current;
};

const useAnimatedStyle = (factory) => {
  try {
    return factory();
  } catch {
    return {};
  }
};

const useAnimatedProps = useAnimatedStyle;
const useDerivedValue = (factory) => useSharedValue(factory());
const useReducedMotion = () => true;

const finish = (value, callback) => {
  if (typeof callback === "function") {
    setTimeout(() => callback(true), 0);
  }
  return value;
};

const withTiming = (value, _config, callback) => finish(value, callback);
const withSpring = (value, _config, callback) => finish(value, callback);
const withDelay = (_delayMs, value) => value;
const withRepeat = (value) => value;
const withSequence = (...values) => values[values.length - 1];
const cancelAnimation = () => {};
const runOnJS = (fn) => (...args) => fn(...args);
const interpolate = (value) => value;
const interpolateColor = (_value, _input, output) => output?.[0] ?? "transparent";

const Animated = {
  ...RNAnimated,
  View: RNAnimated.View,
  Text: RNAnimated.Text,
  ScrollView: RNAnimated.ScrollView,
  Image: RNAnimated.Image,
  createAnimatedComponent:
    RNAnimated.createAnimatedComponent ?? ((Component) => Component),
};

module.exports = {
  __esModule: true,
  default: Animated,
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
};
