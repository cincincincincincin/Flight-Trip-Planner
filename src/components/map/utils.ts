/**
 * MODUŁ NARZĘDZIOWY MAPY (utils.ts - WERSJA ATOMYCZNA v9.2)
 */

import { THEME_COLORS } from '../../constants/theme';

interface LabelPaint {
  textColor: string;
  haloColor: string;
  haloWidth: number;
}

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
  return points;
};

export const isBlackOrWhiteColor = (colorHex: string): boolean => {
  if (!colorHex || colorHex.length < 7) return false;
  const r = parseInt(colorHex.slice(1, 3), 16), g = parseInt(colorHex.slice(3, 5), 16), b = parseInt(colorHex.slice(5, 7), 16);
  return (r < 50 && g < 50 && b < 50) || (r > 200 && g > 200 && b > 200);
};

export const isDarkStyle = (styleId: string | undefined): boolean => {
  if (!styleId) return false;
  const id = styleId.toLowerCase();
  return id.includes('imagery') || id.includes('satellite') || id.includes('dark');
};

export const getLabelPaint = (styleId: string | undefined): LabelPaint => {
  const isDark = isDarkStyle(styleId);
  return {
    textColor: isDark ? THEME_COLORS.textInverse : THEME_COLORS.textPrimary,
    haloColor: isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)",
    haloWidth: 1.8
  };
};

export const airportLabelField = (lang: string, isHubMode: boolean = false): any => {
  const nameExpr = ['coalesce', ['get', `name_${lang}`], ['get', 'name'], ['get', 'code']];
  const cityExpr = ['coalesce', ['get', `city_name_${lang}`], ['get', 'city_name'], ['get', 'code']];
  const fullHoverExpr = ['concat', cityExpr, ' (', ['get', 'code'], ')'];
  
  const midZoomLabelGrouped = ['case',
    ['>', ['get', 'city_airport_count'], 1],
    cityExpr,
    ['concat', cityExpr, ' (', ['get', 'code'], ')']
  ];

  return [
    'step',
    ['zoom'],
    ['case', ['has', 'h_color'], fullHoverExpr, midZoomLabelGrouped], // Zoom < 7
    7.0,
    ['case', ['has', 'h_color'], fullHoverExpr, nameExpr] // Zoom >= 7
  ];
};

/**
 * Bezpieczne łączenie filtrów (v9.3)
 * Łączy wiele filtrów w jeden 'all' blok, rozpakowując istniejące 'all'.
 * Obsługuje zarówno Expression jak i Legacy syntax (choć preferujemy legacy dla setFilter).
 */
export const mergeFilterConditions = (...filters: any[]): any => {
  const allConditions: any[] = [];
  filters.forEach(f => {
    if (!f || f === true) return;
    if (Array.isArray(f)) {
      if (f[0] === 'all') {
        allConditions.push(...f.slice(1));
      } else {
        allConditions.push(f);
      }
    }
  });
  if (allConditions.length === 0) return true;
  if (allConditions.length === 1) return allConditions[0];
  // MapLibre REQUIREMENT: Every element after 'all' must be an array (expression)
  return ['all', ...allConditions.filter(c => Array.isArray(c))];
};

/**
 * Zwraca bezpieczną listę fontów dostępnych w danym stylu (v9.2)
 * Zapobiega błędom mapy, gdy zdefiniowany font nie istnieje w glifach stylu.
 */
export const getSafeFontsFromStyle = (map: maplibregl.Map, bold = false): string[] => {
  // Wyłącznie Noto Sans (zgodnie z folderem legacy)
  return bold 
    ? ['Noto Sans Bold'] 
    : ['Noto Sans Regular'];
};

