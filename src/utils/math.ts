import { CONFIG } from '../constants/config';

export const haversineKm = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const R = CONFIG.EARTH_RADIUS_KM;
  const toRad = (d: number) => d * CONFIG.DEG_TO_RAD;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
