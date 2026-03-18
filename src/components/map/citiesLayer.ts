import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { CityFeatureProps, SelectedItem } from '../../types';
import { getCity } from '../../api/search';
import { getLabelPaint } from './utils';

export function addCitiesLayer(
  map: MapLibreMap,
  data: FeatureCollection<Point, CityFeatureProps>,
  currentMapStyle: string,
  onSelectItemRef: { current: ((item: SelectedItem) => void) | undefined },
) {
  const labelPaint = getLabelPaint(currentMapStyle);
  const strokeColor = labelPaint.haloColor;

  map.addSource('cities', { type: 'geojson', data });
  map.addLayer({
    id: 'cities-circles',
    type: 'circle',
    source: 'cities',
    paint: {
      'circle-radius': 5,
      'circle-color': '#4ECDC4',
      'circle-stroke-width': 1,
      'circle-stroke-color': strokeColor
    }
  });
  map.addLayer({
    id: 'cities-labels',
    type: 'symbol',
    source: 'cities',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-offset': [0, 1.8],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-font': ["Noto Sans Regular"]
    },
    paint: {
      'text-color': labelPaint.textColor,
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': labelPaint.haloWidth
    }
  });

  map.addLayer({
    id: 'cities-highlighted',
    type: 'circle',
    source: 'cities',
    paint: {
      'circle-radius': 8,
      'circle-color': '#4CAF50',
      'circle-stroke-width': 2,
      'circle-stroke-color': 'white',
      'circle-opacity': 0.9,
    },
    filter: ['in', 'code', ''] // empty by default
  });

  map.addLayer({
    id: 'cities-labels-highlighted',
    type: 'symbol',
    source: 'cities',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 13,
      'text-offset': [0, 1.8],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-font': ["Noto Sans Bold"],
    },
    paint: {
      'text-color': '#2e7d32',
      'text-halo-color': 'white',
      'text-halo-width': 2,
    },
    filter: ['in', 'code', ''] // empty by default
  });

  map.on('click', 'cities-circles', async (e: any) => {
    if (!e.features || e.features.length === 0) return;
    const feature = e.features[0];
    const props = feature.properties as CityFeatureProps;
    try {
      const data = await getCity(props.code);
      onSelectItemRef.current?.({ type: 'city', data, fromMap: true });
    } catch (error) {
      console.error('Error fetching city details:', error);
    }
  });

  map.on('mouseenter', 'cities-circles', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'cities-circles', () => {
    map.getCanvas().style.cursor = '';
  });
}
