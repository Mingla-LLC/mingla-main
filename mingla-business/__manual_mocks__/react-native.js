// Lightweight react-native mock — #1062 [biz-jest-residual-burndown] Wave 1 / B3a.
//
// react-native's package entry is `index.js.flow` (Flow-typed ESM) that the
// default node/ts-jest config cannot parse ("Cannot use import statement outside a
// module"). A node-env unit test whose chain transitively VALUE-imports react-native
// (e.g. draftRsvpValidation → draftEventStore → … → AuthContext, or
// venueGalleryDeviceMedia → expo-image-picker) therefore dies at module-load. No
// currently-green suite value-imports react-native successfully (the ESM entry can't
// load), and a suite that self-mocks react-native via jest.mock() OVERRIDES this map
// — so mapping the bare `^react-native$` specifier can only clear currently-red
// loads, never red a green suite. Proven by the mandatory full-suite re-run (SC-8).
//
// These node tests never RENDER — they exercise pure logic — so the components are
// inert placeholders and only the module-load-time primitives (StyleSheet.create,
// Platform.OS/select, Dimensions.get) carry realistic shapes. Nothing is faked at the
// product-logic layer. Activated ONLY via an explicit moduleNameMapper entry.

const React = require("react");

const passthrough = (name) => {
  const C = React.forwardRef((props, ref) =>
    React.createElement(name, { ...props, ref }, props && props.children),
  );
  C.displayName = name;
  return C;
};

const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) =>
    Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
  compose: (a, b) => [a, b],
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
};

const Platform = {
  OS: "web",
  Version: 0,
  isPad: false,
  isTV: false,
  select: (spec) =>
    spec ? (spec.web !== undefined ? spec.web : spec.default) : undefined,
};

const Dimensions = {
  get: () => ({ width: 375, height: 812, scale: 2, fontScale: 2 }),
  addEventListener: () => ({ remove() {} }),
  removeEventListener: () => {},
};

const AnimatedValue = class {
  constructor(v) {
    this._value = v;
  }
  setValue(v) {
    this._value = v;
  }
  interpolate() {
    return new AnimatedValue(0);
  }
  addListener() {
    return "0";
  }
  removeListener() {}
  removeAllListeners() {}
  stopAnimation() {}
};
const animation = () => ({ start: (cb) => cb && cb({ finished: true }), stop() {}, reset() {} });
const Animated = {
  View: passthrough("Animated.View"),
  Text: passthrough("Animated.Text"),
  ScrollView: passthrough("Animated.ScrollView"),
  Image: passthrough("Animated.Image"),
  Value: AnimatedValue,
  ValueXY: AnimatedValue,
  timing: animation,
  spring: animation,
  decay: animation,
  parallel: animation,
  sequence: animation,
  loop: animation,
  createAnimatedComponent: (c) => c,
  event: () => () => {},
};

module.exports = {
  __esModule: true,
  Platform,
  StyleSheet,
  Dimensions,
  Animated,
  Alert: { alert: () => {}, prompt: () => {} },
  Linking: {
    openURL: () => Promise.resolve(),
    canOpenURL: () => Promise.resolve(true),
    getInitialURL: () => Promise.resolve(null),
    addEventListener: () => ({ remove() {} }),
  },
  Keyboard: {
    dismiss: () => {},
    addListener: () => ({ remove() {} }),
    removeAllListeners: () => {},
  },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove() {} }),
  },
  Appearance: {
    getColorScheme: () => "light",
    addChangeListener: () => ({ remove() {} }),
  },
  I18nManager: { isRTL: false, allowRTL: () => {}, forceRTL: () => {} },
  PixelRatio: { get: () => 2, getFontScale: () => 2, roundToNearestPixel: (n) => n },
  NativeModules: {},
  NativeEventEmitter: class {
    addListener() {
      return { remove() {} };
    }
    removeAllListeners() {}
    emit() {}
  },
  DeviceEventEmitter: { addListener: () => ({ remove() {} }), emit: () => {} },
  TurboModuleRegistry: { get: () => null, getEnforcing: () => ({}) },
  UIManager: { getViewManagerConfig: () => null },
  findNodeHandle: () => null,
  useColorScheme: () => "light",
  useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 2 }),
  InteractionManager: {
    runAfterInteractions: (cb) => {
      cb && cb();
      return { cancel() {} };
    },
    createInteractionHandle: () => 0,
    clearInteractionHandle: () => {},
  },
  LayoutAnimation: { configureNext: () => {}, create: () => ({}), Presets: {} },
  // Components (inert placeholders — node tests never render).
  View: passthrough("View"),
  Text: passthrough("Text"),
  Image: passthrough("Image"),
  ImageBackground: passthrough("ImageBackground"),
  ScrollView: passthrough("ScrollView"),
  FlatList: passthrough("FlatList"),
  SectionList: passthrough("SectionList"),
  TextInput: passthrough("TextInput"),
  TouchableOpacity: passthrough("TouchableOpacity"),
  TouchableHighlight: passthrough("TouchableHighlight"),
  TouchableWithoutFeedback: passthrough("TouchableWithoutFeedback"),
  Pressable: passthrough("Pressable"),
  Modal: passthrough("Modal"),
  ActivityIndicator: passthrough("ActivityIndicator"),
  Switch: passthrough("Switch"),
  KeyboardAvoidingView: passthrough("KeyboardAvoidingView"),
  SafeAreaView: passthrough("SafeAreaView"),
  RefreshControl: passthrough("RefreshControl"),
};
