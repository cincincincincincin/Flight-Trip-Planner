import { CONFIG } from '../../constants/config';

/**
 * Dobiera odpowiedni poziom zoomu dla mapy na podstawie liczby lotnisk w kraju.
 * Im więcej lotnisk tym mniejszy zoom (szerszy widok) aby objąć całą infrastrukturę.
 * @param airportCount Liczba lotnisk w wybranym kraju
 * @returns Poziom przybliżenia (number)
 */
export const calculateZoomByAirportCount = (airportCount: number): number => {
  const levels = CONFIG.COUNTRY_ZOOM_LEVELS;
  
  if (airportCount >= 100) return levels['100'];
  if (airportCount >= 40) return levels['40'];
  if (airportCount >= 15) return levels['15'];
  if (airportCount >= 5) return levels['5'];
  if (airportCount > 0) return levels['0'];
  
  return levels['default'];
};
