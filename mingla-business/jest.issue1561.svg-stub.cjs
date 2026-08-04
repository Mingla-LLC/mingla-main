// issue #1561 — `react-native-svg` boundary stub for the WEB render-proof.
//
// `react-native-svg` ships a native build and a web build and selects between
// them with a metro platform extension (`.web.ts`), which jest does not apply;
// pointed at either entry directly it drags in the Fabric native component
// registry and the suite dies on `__fbBatchedBridgeConfig` before a single
// assertion runs.
//
// The claims in this suite are about LAYOUT — the hero's `aspect-ratio` box,
// the answer bar's `flex-direction`, and one text string. No claim is about
// vector drawing. So the elements are replaced by host elements that occupy the
// same position in the tree: the layout under test is unaffected, and nothing
// is faked that anything asserts. The real SVG paths (`EventCover`'s stripes,
// the chrome glyphs) are covered by the suites that own them.
const React = require("react");

const host =
  (name) =>
  (props) =>
    React.createElement(name, null, props && props.children);

const Svg = host("SvgStub");

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Path: host("SvgPathStub"),
  Rect: host("SvgRectStub"),
  Circle: host("SvgCircleStub"),
  Line: host("SvgLineStub"),
  G: host("SvgGStub"),
  Defs: host("SvgDefsStub"),
  ClipPath: host("SvgClipPathStub"),
  LinearGradient: host("SvgLinearGradientStub"),
  Stop: host("SvgStopStub"),
  Polyline: host("SvgPolylineStub"),
  Polygon: host("SvgPolygonStub"),
  Ellipse: host("SvgEllipseStub"),
  Text: host("SvgTextStub"),
  Mask: host("SvgMaskStub"),
};
