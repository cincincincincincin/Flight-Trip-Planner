// Promień Ziemi w kilometrach - potrzebny do wzoru Haversine
const EARTH_RADIUS_KM = 6371;

/**
 * Oblicza dystans między dwoma punktami na kuli (wzór Haversine).
 * Zwraca wynik w kilometrach.
 */
export const haversineKm = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

/**
 * Oblicza medianę. Sortujemy na kopii tablicy, żeby nie zmienić kolejności 
 * w naszych danych źródłowych, bo metoda .sort() w JS nadpisuje oryginalną tablicę.
 */
export const medianVal = (arr: number[]): number => {
  if (arr.length === 0) return 0;

  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};
