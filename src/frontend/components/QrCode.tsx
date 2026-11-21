import { useMemo } from 'react';
import QRCode from 'qrcode';

/** QR rendered client-side as inline SVG (no network, no canvas, prints crisply). */
export function QrCode({
  value,
  size = 132,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const { path, count } = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const data = qr.modules.data;
      let d = '';
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
        }
      }
      return { path: d, count: n };
    } catch {
      return { path: '', count: 0 };
    }
  }, [value]);
  if (!count) return <p className="t-caption">QR unavailable — type the code instead.</p>;
  const quiet = 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      shapeRendering="crispEdges"
    >
      <rect
        x={-quiet}
        y={-quiet}
        width={count + quiet * 2}
        height={count + quiet * 2}
        fill="#fff"
      />
      <path d={path} fill="#000" />
    </svg>
  );
}
