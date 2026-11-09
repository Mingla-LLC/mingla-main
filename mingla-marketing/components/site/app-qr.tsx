import QRCode from 'react-qr-code'

// #4339 speed fix — moved out of download-toggle.tsx (a client module) so
// /download draws its QR codes on the server: react-qr-code renders a plain
// <svg> with no hooks, so the page ships none of its encoder.

/** A QR code for an app link (the Host OneLink), near-black on white. */
export function AppQr({ value, title, size = 152 }: { value: string; title: string; size?: number }) {
  return <QRCode value={value} size={size} title={title} fgColor="#111110" bgColor="#FFFFFF" level="M" />
}
