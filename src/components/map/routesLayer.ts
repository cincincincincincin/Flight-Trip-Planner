/*
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import type { RouteFeatureProps, SelectedItem } from '../../types';
import { getRoute } from '../../api/geo';
import { THEME_COLORS } from '../../constants/theme';

export function addRoutesLayer(
  map: MapLibreMap,
  data: FeatureCollection<LineString, RouteFeatureProps>,
  onSelectItemRef: { current: ((item: SelectedItem) => void) | undefined },
) {
  map.addSource('routes', { type: 'geojson', data });
  map.addLayer({
    id: 'routes-lines',
    type: 'line',
    source: 'routes',
    paint: {
      'line-color': ['case', ['==', ['get', 'codeshare'], true], THEME_COLORS.cCoral, THEME_COLORS.accent],
      'line-width': 1,
      'line-opacity': 0.6
    }
  });

  map.on('click', 'routes-lines', async (e: any) => {
    if (!e.features || e.features.length === 0) return;
    const feature = e.features[0];
    const props = feature.properties as RouteFeatureProps;
    try {
      const data = await getRoute(props.id);
      onSelectItemRef.current?.({ type: 'route', data });
    } catch (error) {
      console.error('Error fetching route details:', error);
      onSelectItemRef.current?.({
        type: 'route',
        data: {
          id: props.id,
          airline_iata: props.airline_iata,
          departure_airport_iata: props.departure_airport_iata,
          arrival_airport_iata: props.arrival_airport_iata,
          codeshare: props.codeshare,
          transfers: props.transfers
        }
      });
    }
  });

  map.on('mouseenter', 'routes-lines', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'routes-lines', () => {
    map.getCanvas().style.cursor = '';
  });
}
*/
