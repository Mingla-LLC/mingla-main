// ORCH-1197 — minimal stub for react-native-gesture-handler. SheetMobile.tsx
// imports { Gesture } at module top for the NATIVE variant; SheetWeb does not
// use it (it renders via WebSafeGestureDetector.web). Provide a no-op Gesture so
// the web SSR render can import the module without the native TurboModule.
const chain = () => api;
const api = { onUpdate: chain, onEnd: chain, onStart: chain, onChange: chain };
const Gesture = { Pan: () => api, Tap: () => api };
const GestureDetector = ({ children }) => children;

module.exports = { Gesture, GestureDetector };
