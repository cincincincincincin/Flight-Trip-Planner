import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { AirportFeatureProps, SelectedItem } from '../../types';
import { getAirport } from '../../api/search';
import { getLabelPaint } from './utils';

interface AirportsLayerOptions {
  onSelectItemRef: { current: ((item: SelectedItem) => void) | undefined };
}

export function addAirportsLayer(
  map: MapLibreMap,
  data: FeatureCollection<Point, AirportFeatureProps>,
  currentMapStyle: string,
  { onSelectItemRef }: AirportsLayerOptions,
) {
  const labelPaint = getLabelPaint(currentMapStyle);
  const strokeColor = labelPaint.haloColor;

  map.addSource('airports', { type: 'geojson', data });

  map.addLayer({
    id: 'airports-circles',
    type: 'circle',
    source: 'airports',
    paint: {
      'circle-radius': 4,
      'circle-color': '#FF6B6B',
      'circle-stroke-width': 1,
      'circle-stroke-color': strokeColor
    }
  });

  map.addLayer({
    id: 'airports-trip',
    type: 'circle',
    source: 'airports',
    filter: ['in', 'code', ''],
    paint: {
      'circle-radius': 6,
      'circle-color': '#000000',
      'circle-stroke-width': 1,
      'circle-stroke-color': strokeColor
    }
  });

  map.addLayer({
    id: 'airports-highlighted',
    type: 'circle',
    source: 'airports',
    filter: ['in', 'code', ''],
    paint: {
      'circle-radius': 6,
      'circle-color': '#4CAF50',
      'circle-stroke-width': 1,
      'circle-stroke-color': strokeColor
    }
  });

  map.addLayer({
    id: 'airports-hover',
    type: 'circle',
    source: 'airports',
    filter: ['==', 'code', ''],
    paint: {
      'circle-radius': 8,
      'circle-color': '#C62828',
      'circle-stroke-width': 2,
      'circle-stroke-color': strokeColor,
      // No transitions — hover must appear/disappear instantly
      'circle-radius-transition': { duration: 0 },
      'circle-color-transition': { duration: 0 },
      'circle-stroke-width-transition': { duration: 0 },
      'circle-opacity-transition': { duration: 0 },
    }
  });

  map.addLayer({
    id: 'airports-selected',
    type: 'circle',
    source: 'airports',
    filter: ['==', 'code', ''],
    paint: {
      'circle-radius': 8,
      'circle-color': '#000000',
      'circle-stroke-width': 2,
      'circle-stroke-color': strokeColor
    }
  });

  map.addLayer({
    id: 'airports-route-hover',
    type: 'circle',
    source: 'airports',
    filter: ['==', 'code', ''],
    paint: {
      'circle-radius': 10,
      'circle-color': '#FFD700',
      'circle-stroke-width': 2,
      'circle-stroke-color': strokeColor
    }
  });

  map.addLayer({
    id: 'airports-labels-normal',
    type: 'symbol',
    source: 'airports',
    minzoom: 5,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 10,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-font': ["Noto Sans Regular"],
      'symbol-sort-key': 1,
    },
    paint: {
      'text-color': labelPaint.textColor,
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': labelPaint.haloWidth
    }
  });

  // Low-zoom city labels for general airports (single label per city, filtered in MapComponent)
  map.addLayer({
    id: 'airports-labels-normal-city',
    type: 'symbol',
    source: 'airports',
    maxzoom: 5,
    filter: ['in', 'code', ''],
    layout: {
      'text-field': ['coalesce', ['get', 'city_name'], ['get', 'name']],
      'text-size': 11,
      'text-font': ["Noto Sans Regular"],
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-max-width': 8,
      'symbol-sort-key': 1,
    },
    paint: {
      'text-color': labelPaint.textColor,
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': labelPaint.haloWidth
    }
  });

  // Low-zoom city labels for highlighted airports (zoom < 5): MapLibre collision detection
  // naturally shows one label per city cluster since airports in same city are co-located.
  map.addLayer({
    id: 'airports-labels-highlighted-city',
    type: 'symbol',
    source: 'airports',
    maxzoom: 5,
    filter: ['in', 'code', ''],
    layout: {
      'text-field': ['coalesce', ['get', 'city_name'], ['get', 'name']],
      'text-size': 12,
      'text-font': ["Noto Sans Bold"],
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-max-width': 8,
      'symbol-sort-key': 2,
    },
    paint: {
      'text-color': labelPaint.textColor,
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': labelPaint.haloWidth
    }
  });

  // High-zoom airport name labels for highlighted airports (zoom >= 5)
  map.addLayer({
    id: 'airports-labels-highlighted',
    type: 'symbol',
    source: 'airports',
    minzoom: 5,
    filter: ['in', 'code', ''],
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-font': ["Noto Sans Bold"],
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-max-width': 8,
      'symbol-sort-key': 2,
    },
    paint: {
      'text-color': labelPaint.textColor,
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': labelPaint.haloWidth
    }
  });

  // Hover label for general (non-focused) airports
  map.addLayer({
    id: 'airports-labels-hover-general',
    type: 'symbol',
    source: 'airports',
    filter: ['==', 'code', ''],
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-font': ["Noto Sans Bold"],
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': 3,
    },
    paint: {
      'text-color': '#000000',
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': 1.5,
      'text-opacity-transition': { duration: 0 },
      'text-color-transition': { duration: 0 },
    }
  });

  // Hover label for focused airports (starting points, destinations, trip airports)
  map.addLayer({
    id: 'airports-labels-hover',
    type: 'symbol',
    source: 'airports',
    filter: ['==', 'code', ''],
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-font': ["Noto Sans Bold"],
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': 3,
    },
    paint: {
      'text-color': '#FFA500',
      'text-halo-color': labelPaint.haloColor,
      'text-halo-width': 1.5,
      'text-opacity-transition': { duration: 0 },
      'text-color-transition': { duration: 0 },
    }
  });

  // Hover circle + label are handled by a map-level mousemove in MapComponent (more responsive).
  // Here we only handle click and cursor style.
  const clickLayers = ['airports-hover', 'airports-circles', 'airports-trip', 'airports-highlighted', 'airports-selected'];

  clickLayers.forEach(layerId => {
    map.on('click', layerId, async (e: any) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const props = feature.properties as AirportFeatureProps;
      const isHighlighted = layerId === 'airports-highlighted';
      try {
        const data = await getAirport(props.code);
        onSelectItemRef.current?.({ type: 'airport', data, isHighlighted, fromMap: true });
        // On mobile, tap triggers synthetic mousemove before click, leaving hover filters active.
        // Clear them after selecting so highlighted and hover labels don't show simultaneously.
        if (map.getLayer('airports-labels-hover')) map.setFilter('airports-labels-hover', ['==', 'code', '']);
        if (map.getLayer('airports-labels-hover-general')) map.setFilter('airports-labels-hover-general', ['==', 'code', '']);
        if (map.getLayer('airports-route-hover')) map.setFilter('airports-route-hover', ['==', 'code', '']);
        if (map.getLayer('airports-hover')) map.setFilter('airports-hover', ['==', 'code', '']);
      } catch (error) {
        console.error('Error fetching airport details:', error);
      }
    });

    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
  });
}
