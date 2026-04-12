/**
 * MODUŁ NARZĘDZIOWY MAPY (utils.ts - WERSJA ATOMYCZNA v9.2)
 */

import { THEME_COLORS } from '../../constants/theme';

interface LabelPaint {
  textColor: string;
  haloColor: string;
  haloWidth: number;
}

/** Helper dla bezpiecznych liczb (v10.6+) */
export const n = (v: any, fallback: number): number => {
  const num = Number(v);
  return isNaN(num) ? fallback : num;
};

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
  
  let prevLon = from[0];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    
    let lon = toDeg(Math.atan2(y, x));
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    
    // ANTIMERIDIAN WRAP FIX (v11.57):
    // Jeśli skok długości geograficznej jest zbyt duży (>180), "odwijamy" ją,
    // aby zachować ciągłość linii dla silnika GPU.
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    
    points.push([lon, lat]);
    prevLon = lon;
  }
  return points;
};

export const isBlackOrWhiteColor = (colorHex: string): boolean => {
  if (!colorHex || colorHex.length < 7) return false;
  const r = parseInt(colorHex.slice(1, 3), 16), g = parseInt(colorHex.slice(3, 5), 16), b = parseInt(colorHex.slice(5, 7), 16);
  return (r < 50 && g < 50 && b < 50) || (r > 200 && g > 200 && b > 200);
};

export const isSystemColor = (color: string | undefined): boolean => {
  if (!color) return false;
  const c = color.toLowerCase();
  return c === '#000000' || c === '#ffffff' || c === 'rgb(0,0,0)' || c === 'rgb(255,255,255)';
};

export const getLabelPaint = (styleId: string | undefined): LabelPaint => {
  const isImg = (styleId || '').toLowerCase().includes('imagery');
  return {
    textColor: isImg ? "#ffffff" : "#000000",
    haloColor: isImg ? "#000000" : "rgba(255,255,255,0.95)",
    haloWidth: isImg ? 2.5 : 1.8
  };
};

export const airportLabelField = (lang: string, isHubMode: boolean = false): any => {
  const lblSearch = ['get', 'cl_search'];
  const lblGrouped = ['get', 'cl_grouped'];
  const lblHigh = ['get', 'cl_high'];

  return [
    'step',
    ['zoom'],
    // 1. PONIŻEJ ZOOM 4.2: Tylko huby (>1 lotnisko) lub podświetlone (v11.44)
    ['case',
      ['has', 'h_color'], lblSearch,
      ['>', ['coalesce', ['get', 'city_airport_count'], 0], 1], lblGrouped,
      "" // Puste poniżej 4.2 (Twarde cięcie)
    ],
    4.2,
    // 2. ZOOM 4.2 - 7.0: Wszystkie miasta
    ['case',
      ['has', 'h_color'], lblSearch,
      ['>', ['coalesce', ['get', 'city_airport_count'], 0], 1], lblGrouped,
      lblSearch
    ],
    7.0,
    // 3. POWYŻEJ ZOOM 7.0: Pełna szczegółowość
    ['case',
      ['has', 'h_color'], lblSearch,
      lblHigh
    ]
  ];
};

/**
 * Logika etykiet hybrydowych (v11.52)
 * Do użytku w warstwie Highlighted/Selected.
 * Zawsze pokazuje Miasto + Lotnisko, z kodem dopiero przy przybliżeniu.
 */
export const airportHighlightedLabelField = (): any => {
  return [
    'step',
    ['zoom'],
    ['get', 'cl_hl_low'],  // Poniżej 9: Miasto - Lotnisko
    9.0,
    ['get', 'cl_hl_high']  // Powyżej 9: Miasto - Lotnisko (KOD)
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

/**
 * SNAJPERSKI RADIUS (v11.68 - PURE UTILITY)
 * Oblicza promień wizualny kropki na podstawie zooma i jej typu.
 * 
 * @param isHover - jeśli true, zwraca promień powiększony (sticky area)
 */
export const getVisualRadius = (
  code: string,
  zoom: number,
  cS: any,
  isHover: boolean,
  sac: string[],
  ha: string[],
  tvac: string[],
  eac: string[],
  mtac: string[]
): number => {
  const n = (v: any, fallback: number): number => {
    const num = Number(v);
    return isNaN(num) ? fallback : num;
  };

  const isSelected = sac.includes(code);
  const isDest = ha.includes(code);
  const isTrip = tvac.includes(code);
  const isExp = eac.includes(code);
  const isMan = mtac.includes(code);

  const zMin = n(cS?.zoomRangeMin, 1.3);
  const zMax = n(cS?.zoomRangeMax, 12);
  const t = Math.max(0, Math.min(1, (zoom - zMin) / (zMax - zMin)));

  // Wyznaczamy progi na podstawie tego, czy obiekt jest "Ważny" (Enlarged)
  const isHigh = isSelected || isDest || isTrip || isExp || isMan;

  let minR: number, maxR: number;
  if (isHover) {
    // Promień HOVER (Sticky)
    minR = isHigh ? n(cS?.highlightedAirportHoverRadiusMin, 10) : n(cS?.generalAirportHoverRadiusMin, 6);
    maxR = isHigh ? n(cS?.highlightedAirportHoverRadiusMax, 22) : n(cS?.generalAirportHoverRadiusMax, 14);
  } else {
    // Promień NORMALNY (Edge)
    minR = isHigh ? n(cS?.highlightedAirportRadiusMin, 6) : n(cS?.generalAirportRadiusMin, 2);
    maxR = isHigh ? n(cS?.highlightedAirportRadiusMax, 16) : n(cS?.generalAirportRadiusMax, 8);
  }

  return minR + t * (maxR - minR);
};

