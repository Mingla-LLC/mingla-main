'use strict';

/**
 * The browser-runtime subset of Direction C.
 *
 * Keep S6's measured descriptor and plate material here so the eager buyer-web
 * shell imports only the values it renders. `index.js` consumes these same
 * objects for the seven-surface oracle, preserving one source without pulling
 * the whole oracle/math module into every browser route.
 */
const S6_PLATE_BOUNDARY = Object.freeze({
  color: 'rgba(255,255,255,0.38)',
  rgb: Object.freeze([255, 255, 255]),
  alpha: 0.38,
  width: 1,
});

const S6_PLATE = Object.freeze({
  fallbackSolid: 'rgb(53,56,63)',
  fallbackSolidRgb: Object.freeze([53, 56, 63]),
});

const S6_PHONE = Object.freeze({
  label: 'S6 public web page — phone breakpoint',
  w: 390, h: 480, cardR: 24,
  sideInset: 16, bottomInset: 16,
  plateW: 358, plateH: 96, plateR: 22,
  titleSize: 30, titleLH: 36, titleLines: 2, titleWeight: '700', titleInset: 16,
  metaSize: 14,
  metaLines: 2,
  gap: 20,
  titleOnPlate: false,
  controls: true,
  topScrim: false,
  curated: true,
  plateBoundary: 'standard',
  sliverBoundary: 'none',
  sliver: Object.freeze({
    height: 4,
    radius: 2,
    alpha: 0.44,
    opaque: Object.freeze(['rgb(143,143,143)', 'rgb(145,145,145)']),
    forcedOpaque: false,
    insets: Object.freeze([24, 34]),
  }),
});

module.exports = { S6_PHONE, S6_PLATE, S6_PLATE_BOUNDARY };
