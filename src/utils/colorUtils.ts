/**
 * Narzędzia do konwersji kolorów (RGB <-> HSV) oraz parsowania stringów.
 * Wykorzystywane głównie do dynamicznego stylowania mapy i paneli.
 */

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100;
  v /= 100;

  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  // Przeliczanie na podstawie sektora koła barw
  if (h < 60) {
    r = c; g = x;
  } else if (h < 120) {
    r = x; g = c;
  } else if (h < 180) {
    g = c; b = x;
  } else if (h < 240) {
    g = x; b = c;
  } else if (h < 300) {
    r = x; b = c;
  } else {
    r = c; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

export function parseColorString(c: string): [number, number, number, number] {
  if (c.startsWith('rgba(')) {
    const [r, g, b, a] = (c.match(/[\d.]+/g) || []).map(Number);
    return [
      r || 0,
      g || 0,
      b || 0,
      Math.round((a ?? 1) * 255)
    ];
  }

  const h = c.replace('#', '');
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [r, g, b, a];
  }

  return [0, 0, 0, 255]; // fallback na czarny
}

export function colorToString(r: number, g: number, b: number, a: number): string {
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  if (a >= 255) return `#${hex(r)}${hex(g)}${hex(b)}`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
