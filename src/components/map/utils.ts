interface LabelPaint {
  textColor: string;
  haloColor: string;
  haloWidth: number;
}

// Generates great-circle (orthodrome) intermediate points between two [lng, lat] coordinates
export const generateGreatCircle = (
  from: [number, number],
  to: [number, number],
  numPoints = 64,
): [number, number][] => {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;

  const φ1 = toRad(from[1]), λ1 = toRad(from[0]);
  const φ2 = toRad(to[1]),   λ2 = toRad(to[0]);

  const Δλ = λ2 - λ1;
  const a = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (d < 0.0001) return [from, to];

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    points.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }

  // Unwrap longitudes so consecutive points never jump by more than 180°.
  // This prevents antimeridian artifacts on both flat and globe projections –
  // MapLibre handles extended coordinates (e.g. 203° = -157°) correctly.
  for (let i = 1; i < points.length; i++) {
    const diff = points[i][0] - points[i - 1][0];
    if (diff > 180) points[i][0] -= 360;
    else if (diff < -180) points[i][0] += 360;
  }

  return points;
};

// Helper: detect if a color is pure black or white (allowing slight variations)
export const isBlackOrWhiteColor = (colorHex: string): boolean => {
  if (!colorHex.startsWith('#') || colorHex.length < 7) return false;
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  const isBlack = r < 20 && g < 20 && b < 20;
  const isWhite = r > 235 && g > 235 && b > 235;
  return isBlack || isWhite;
};

// Helper: get halo color for text color
// Always return opposite color based on luminance for maximum contrast
export const getHaloColorForTextColor = (textColor: string, styleUrl: string | undefined): string => {
  if (!textColor.startsWith('#') || textColor.length < 7) return '#FFFFFF';
  
  const r = parseInt(textColor.slice(1, 3), 16);
  const g = parseInt(textColor.slice(3, 5), 16);
  const b = parseInt(textColor.slice(5, 7), 16);
  
  // Calculate perceived brightness (luminance)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Always return opposite: if text is bright, use dark halo; if text is dark, use bright halo
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

// Helper: get text color opposite to halo color for contrast
export const getTextColorForHaloColor = (haloColor: string): string => {
  if (!haloColor.startsWith('#') || haloColor.length < 7) return '#FFFFFF';
  
  const r = parseInt(haloColor.slice(1, 3), 16);
  const g = parseInt(haloColor.slice(3, 5), 16);
  const b = parseInt(haloColor.slice(5, 7), 16);
  
  // Calculate perceived brightness (luminance)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // If halo is bright, return dark text; if halo is dark, return bright text
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

export const getLabelPaint = (styleUrl: string | undefined): LabelPaint => {
  const lightScheme: LabelPaint = {
    textColor: '#333333',
    haloColor: '#FFFFFF',
    haloWidth: 1
  };
  const darkScheme: LabelPaint = {
    textColor: '#FFFFFF',
    haloColor: '#000000',
    haloWidth: 1.5
  };

  if (!styleUrl) return lightScheme;
  if (styleUrl.includes('dark-matter') || styleUrl.includes('satelite')) {
    return darkScheme;
  }
  return lightScheme;
};
