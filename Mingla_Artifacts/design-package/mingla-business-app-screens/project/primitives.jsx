/* global React */
const { useState, useEffect, useRef } = React;

// =================================================================
// SHARED PRIMITIVES
// =================================================================

const Icon = ({ name, size = 22, color = "currentColor", strokeWidth = 1.75 }) => {
  const paths = {
    home: <><path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
    chat: <><path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chevR: <><path d="M9 6l6 6-6 6"/></>,
    chevL: <><path d="M15 6l-6 6 6 6"/></>,
    chevD: <><path d="M6 9l6 6 6-6"/></>,
    chevU: <><path d="M6 15l6-6 6 6"/></>,
    close: <><path d="M18 6L6 18M6 6l12 12"/></>,
    check: <><path d="M5 13l4 4L19 7"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    bell: <><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16l-2-3zM10 21a2 2 0 0 0 4 0"/></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M17 17h4v4"/></>,
    scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M21 7V5a2 2 0 0 0-2-2h-2M3 17v2a2 2 0 0 0 2 2h2M21 17v2a2 2 0 0 1-2 2h-2M7 12h10"/></>,
    share: <><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8L15.8 7.2M8.2 13.2L15.8 16.8"/></>,
    edit: <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></>,
    pound: <><path d="M16 5a4 4 0 0 0-7 3l-1 6H6m11 4a4 4 0 0 1-3-1.5 4 4 0 0 0-3-1.5H6m12 0H6"/></>,
    trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    google: <><path d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5c-.2 1.3-1 2.4-2 3.1v2.6h3.3c2-1.8 3-4.5 3-7.5z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 5-1 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3v2.6A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3a10 10 0 0 0 0 8.8L6.4 14z" fill="#FBBC04" stroke="none"/><path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2A10 10 0 0 0 3 7.6L6.4 10c.8-2.4 3-4.1 5.6-4.1z" fill="#EA4335" stroke="none"/></>,
    apple: <><path d="M16.5 2c.1 1.4-.4 2.7-1.3 3.6-.9 1-2.3 1.7-3.6 1.6-.1-1.3.5-2.7 1.4-3.6.9-1 2.3-1.5 3.5-1.6zM20.7 17c-.6 1.3-.9 1.9-1.6 3-1 1.6-2.4 3.5-4.2 3.5-1.6 0-2-1-4.2-1-2.2 0-2.7 1-4.2 1-1.8 0-3.1-1.7-4.1-3.3-2.7-4.4-3-9.5-1.3-12.3 1.2-2 3.1-3.1 4.9-3.1 1.8 0 3 1 4.5 1 1.5 0 2.4-1 4.5-1 1.6 0 3.3.9 4.5 2.4-4 2.2-3.3 7.9.2 9.8z" fill="currentColor" stroke="none"/></>,
    arrowL: <><path d="M19 12H5M12 19l-7-7 7-7"/></>,
    moreH: <><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></>,
    flash: <><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></>,
    location: <><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    ticket: <><path d="M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M13 5v3M13 12v0M13 16v3"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    cash: <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v0M18 14v0"/></>,
    tap: <><circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    refund: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></>,
    sparkle: <><path d="M12 3l1.5 5L18 9.5l-4.5 1.5L12 16l-1.5-5L6 9.5 10.5 8 12 3zM18 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></>,
    flag: <><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></>,
    flashOn: <><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" fill="currentColor"/></>,
    keypad: <><circle cx="6" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/><circle cx="6" cy="18" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/><circle cx="18" cy="18" r="1.5" fill="currentColor"/></>,
    backspace: <><path d="M22 5H9l-7 7 7 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM18 9l-6 6M12 9l6 6"/></>,
    star: <><path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14l-5-4.5 6.5-.5L12 3z" fill="currentColor"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
    sms: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></>,
    chart: <><path d="M3 3v18h18M7 16l4-4 4 4 5-5"/></>,
    pieChart: <><path d="M21 15.5A9 9 0 1 1 8.5 3 M21 12A9 9 0 0 0 12 3v9h9z"/></>,
    funnel: <><path d="M3 4h18l-7 9v7l-4-2v-5L3 4z"/></>,
    link: <><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
    tag: <><path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></>,
    send: <><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></>,
    play: <><path d="M5 3v18l15-9-15-9z" fill="currentColor"/></>,
    pause: <><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></>,
    template: <><rect x="3" y="3" width="18" height="6" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
    filter: <><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></>,
    branch: <><circle cx="6" cy="3" r="2"/><circle cx="6" cy="21" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 5v14M18 8a4 4 0 0 1-4 4H8"/></>,
    shield: <><path d="M12 3l8 3v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/></>,
    receipt: <><path d="M4 4v18l3-2 2 2 2-2 2 2 2-2 3 2V4l-3 2-2-2-2 2-2-2-2 2-3-2zM8 9h8M8 13h8M8 17h5"/></>,
    bank: <><path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10h20L12 3 2 10z"/></>,
    nfc: <><path d="M5 12C5 8 8 5 12 5s7 3 7 7-3 7-7 7M9 12a3 3 0 0 1 3-3 3 3 0 0 1 3 3"/></>,
    swap: <><path d="M3 7h13l-3-3M21 17H8l3 3"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>,
    calendarPlus: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v6M9 16h6"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></>,
    rocket: <><path d="M12 2c4 3 6 7 6 12l-3 3-3-2-3 2-3-3c0-5 2-9 6-12z"/><circle cx="12" cy="10" r="2"/></>,
    notebook: <><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M8 4v18M11 8h6M11 12h6M11 16h4"/></>,
    award: <><circle cx="12" cy="9" r="6"/><path d="M9 14l-2 7 5-3 5 3-2-7"/></>,
    trending: <><path d="M3 17l6-6 4 4 8-8M14 7h7v7"/></>,
    inbox: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 13h5l2 3h4l2-3h5"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
};

// Mingla M monogram - geometric, faceted
const MinglaMark = ({ size = 28, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="mGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fb923c"/>
        <stop offset="1" stopColor="#eb7825"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#mGrad)"/>
    <path d="M7 23 V10 L12 17 L16 11 L20 17 L25 10 V23" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

// Subtly striped placeholder for event imagery
const EventCover = ({ hue = 25, label = "Cover", height = "100%", radius = 16, children }) => (
  <div style={{
    position: "relative",
    width: "100%",
    height,
    borderRadius: radius,
    overflow: "hidden",
    background: `
      linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.72) 100%),
      repeating-linear-gradient(135deg, oklch(0.55 0.18 ${hue}) 0px, oklch(0.55 0.18 ${hue}) 14px, oklch(0.50 0.16 ${hue}) 14px, oklch(0.50 0.16 ${hue}) 28px),
      oklch(0.45 0.14 ${hue})
    `,
  }}>
    <div style={{
      position: "absolute", top: 12, left: 12,
      fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.55)",
      letterSpacing: 0.5,
    }}>{label.toUpperCase()}</div>
    {children}
  </div>
);

const QRCode = ({ size = 200 }) => {
  // Pseudo-random QR-looking grid
  const cells = 21;
  const rng = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const square = (x, y, s) => (
    <g key={`f${x}${y}`}>
      <rect x={x} y={y} width={s*7} height={s*7} fill="#fff"/>
      <rect x={x+s} y={y+s} width={s*5} height={s*5} fill="#000"/>
      <rect x={x+s*2} y={y+s*2} width={s*3} height={s*3} fill="#fff"/>
    </g>
  );
  const cell = size / cells;
  const dots = [];
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // skip finder pattern zones
      if ((x < 7 && y < 7) || (x > cells-8 && y < 7) || (x < 7 && y > cells-8)) continue;
      if (rng(x * cells + y) > 0.55) {
        dots.push(<rect key={`${x}-${y}`} x={x*cell} y={y*cell} width={cell} height={cell} fill="#000"/>);
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{background: "#fff", borderRadius: 12}}>
      <rect width={size} height={size} fill="#fff"/>
      {dots}
      {square(0, 0, cell)}
      {square((cells-7)*cell, 0, cell)}
      {square(0, (cells-7)*cell, cell)}
    </svg>
  );
};

window.MinglaIcon = Icon;
window.MinglaMark = MinglaMark;
window.EventCover = EventCover;
window.QRCode = QRCode;
