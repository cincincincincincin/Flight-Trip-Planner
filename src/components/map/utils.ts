/**
 * MODUŁ NARZĘDZIOWY MAPY (Geometry & Aesthetics Utils)
 * Zawiera funkcje pomocnicze do obliczeń geograficznych oraz zarządzania kontrastem UI.
 */

import { THEME_COLORS } from '../../constants/theme';
import { CONFIG } from '../../constants/config';

interface LabelPaint {
  textColor: string;
  haloColor: string;
  haloWidth: number;
  circleStrokeColor: string;
}

/**
 * GENERATOR ORTODROMY (Great Circle Path)
 * Oblicza punkty pośrednie na najkrótszej drodze między dwoma punktami na sferze.
 * 
 * MATEMATYKA: Implementacja interpolacji sferycznej (Slerp) oparta na trygonometrii sferycznej.
 * 1. Zamiana współrzędnych [lon, lat] na radiany.
 * 2. Obliczenie odległości kątowej 'd' przy użyciu wzoru Haversine.
 * 3. Wyznaczenie punktów pośrednich dla parametru t ∈ [0, 1].
 * 
 * @param from - Współrzędne startowe [longitude, latitude]
 * @param to - Współrzędne docelowe [longitude, latitude]
 * @param numPoints - Liczba segmentów linii (domyślnie 64 dla płynności)
 */
export const generateGreatCircle = (
  from: [number, number],
  to: [number, number],
  numPoints = 64,
): [number, number][] => {
  if (!from || !to || !Array.isArray(from) || !Array.isArray(to)) return [];
  
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

  // UNWRAP LONGITUDES: Zapewnia ciągłość linii przy przekraczaniu południka 180°.
  // MapLibre obsługuje współrzędne rozszerzone (np. 203° zamiast -157°), co zapobiega 
  // "przeskokom" linii przez całą mapę.
  for (let i = 1; i < points.length; i++) {
    const diff = points[i][0] - points[i - 1][0];
    if (diff > 180) points[i][0] -= 360;
    else if (diff < -180) points[i][0] += 360;
  }

  return points;
};

/** Detekcja kolorów skrajnych (czarny/biały) z tolerancją zdefiniowaną w CONFIG. */
export const isBlackOrWhiteColor = (colorHex: string): boolean => {
  if (!colorHex.startsWith('#') || colorHex.length < 7) return false;
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  const isBlack = r < CONFIG.COLOR_THRESHOLDS.BLACK_RGB && g < CONFIG.COLOR_THRESHOLDS.BLACK_RGB && b < CONFIG.COLOR_THRESHOLDS.BLACK_RGB;
  const isWhite = r > CONFIG.COLOR_THRESHOLDS.WHITE_RGB && g > CONFIG.COLOR_THRESHOLDS.WHITE_RGB && b > CONFIG.COLOR_THRESHOLDS.WHITE_RGB;
  return isBlack || isWhite;
};

/** Detekcja czy styl mapy jest ciemny (Dark lub Imagery) */
export const isDarkStyle = (styleId: string | undefined): boolean => {
  if (!styleId) return false;
  const id = styleId.toLowerCase();
  return id.includes('imagery') || id.includes('satellite') || id.includes('dark') || id.includes('human');
};

/** 
 * Wyznacza optymalny kolor tekstu na podstawie stylu mapy.
 * Na mapach satelitarnych (Imagery) wymusza wysoki kontrast dla czytelności etykiet.
 */
export const getTextColorForStyle = (textColor: string, styleUrl: string | undefined): string => {
  const isDark = isDarkStyle(styleUrl);
  if (!isDark) return textColor;

  // On Dark/Imagery, if the color is too dark, force it to white
  if (!textColor.startsWith('#') || textColor.length < 7) return THEME_COLORS.textInverse;
  
  const r = parseInt(textColor.slice(1, 3), 16);
  const g = parseInt(textColor.slice(3, 5), 16);
  const b = parseInt(textColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance < 0.4 ? THEME_COLORS.textInverse : textColor;
};

/** 
 * Automatyczny dobór koloru obwódki (halo) dla tekstu.
 */
export const getHaloColorForTextColor = (textColor: string, styleUrl: string | undefined): string => {
  if (!textColor.startsWith('#') || textColor.length < 7) return THEME_COLORS.textInverse;
  
  const r = parseInt(textColor.slice(1, 3), 16);
  const g = parseInt(textColor.slice(3, 5), 16);
  const b = parseInt(textColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  const isDark = isDarkStyle(styleUrl);
  
  if (isDark && luminance > 0.3) {
    return THEME_COLORS.textBlack;
  }
  
  return luminance > 0.5 ? THEME_COLORS.textBlack : THEME_COLORS.textInverse;
};

/** Zwraca kolor tekstu o przeciwnym kontraście do koloru halo. */
export const getTextColorForHaloColor = (haloColor: string): string => {
  if (!haloColor.startsWith('#') || haloColor.length < 7) return THEME_COLORS.textInverse;
  
  const r = parseInt(haloColor.slice(1, 3), 16);
  const g = parseInt(haloColor.slice(3, 5), 16);
  const b = parseInt(haloColor.slice(5, 7), 16);
  
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5 ? THEME_COLORS.textBlack : THEME_COLORS.textInverse;
};

/**
 * Główny selektor stylu etykiet (Label Scheme Selector).
 * Agreguje schematy kolorystyczne dla jasnych, ciemnych i satelitarnych wariantów mapy.
 */
export const getLabelPaint = (styleId: string | undefined): LabelPaint => {
  const lightScheme: LabelPaint = {
    textColor: THEME_COLORS.textPrimary,
    haloColor: THEME_COLORS.textInverse,
    haloWidth: 1.5,
    circleStrokeColor: "rgba(0, 0, 0, 0.4)" // Delikatne ciemne obramowanie na jasnej mapie
  };
  const darkScheme: LabelPaint = {
    textColor: THEME_COLORS.textInverse,
    haloColor: THEME_COLORS.textBlack,
    haloWidth: 2,
    circleStrokeColor: THEME_COLORS.textInverse // Jasne obramowanie na ciemnej mapie
  };

  const imageryScheme: LabelPaint = {
    textColor: THEME_COLORS.textInverse,
    haloColor: "rgba(0,0,0,0.8)",
    haloWidth: 2,
    circleStrokeColor: THEME_COLORS.textInverse // Mocny kontrast na satelicie
  };

  if (!styleId) return lightScheme;
  
  const id = styleId.toLowerCase();
  
  if (id.includes('imagery') || id.includes('satellite')) {
    return imageryScheme;
  }
  
  if (id.includes('dark') || id.includes('human')) {
    return darkScheme;
  }
  
  return lightScheme;
};
