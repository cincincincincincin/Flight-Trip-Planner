import RBush from 'rbush';

/**
 * Element indeksu przestrzennego RBush.
 * Przechowuje pozycję pikselową (x, y) jako punkt (min=max).
 */
export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  code: string;
}

/**
 * Klaster punktów w wybranym promieniu.
 */
export interface SearchResult {
  code: string;
  distance: number;
}

/**
 * Serwis zarządzający indeksem przestrzennym R-Tree.
 * Pozwala na błyskawiczne wyszukiwanie lotnisk w promieniu kursora (O(log N)).
 * Indeks jest przebudowywany po każdym przesunięciu mapy (moveend).
 */
class SpatialIndexService extends RBush<SpatialItem> {
  /**
   * Inicjalizuje indeks nowymi danymi rzutowanymi na piksele.
   * @param items Lista lotnisk z aktualnymi współrzędnymi X, Y (px).
   */
  public update(items: Array<{ code: string; x: number; y: number }>) {
    this.clear();
    const spatialItems: SpatialItem[] = items.map(item => ({
      minX: item.x,
      minY: item.y,
      maxX: item.x,
      maxY: item.y,
      code: item.code
    }));
    this.load(spatialItems);
  }

  /**
   * Wyszukuje lotniska w promieniu (koło) od punktu.
   * @param x Współrzędna X (px)
   * @param y Współrzędna Y (px)
   * @param radius Promień wyszukiwania (px)
   */
  public searchRadius(x: number, y: number, radius: number): SearchResult[] {
    const results: SearchResult[] = [];
    const radiusSq = radius * radius;

    // Pobierz obiekty z obwiedni kwadratowej (szybkie)
    const candidates = this.search({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius
    });

    // Filtruj dokładnie po promieniu (koło)
    for (const item of candidates) {
      const dx = item.minX - x;
      const dy = item.minY - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= radiusSq) {
        results.push({
          code: item.code,
          distance: Math.sqrt(distSq)
        });
      }
    }

    return results;
  }
}

export const spatialIndex = new SpatialIndexService();
