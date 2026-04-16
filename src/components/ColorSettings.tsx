import React, { useEffect, useCallback, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useColorStore, type ColorKey, type SizeKey } from '../stores/colorStore';
import { useMapStore } from '../stores/mapStore';
import './ColorSettings.css';
import { useTexts } from '../hooks/useTexts';
import { CONFIG } from '../constants/config';
import ColorPicker from './colorSettings/ColorPicker';
import RangeSlider from './colorSettings/RangeSlider';

interface ColorSettingsProps {
  showOnlySizes?: boolean;
  showSizes?: boolean;
}

const ColorSettings: React.FC<ColorSettingsProps> = ({
  showOnlySizes = false,
  showSizes = true
}) => {
  const t = useTexts();

  const MAP_AIRPORT_ROWS: { key: ColorKey; label: string; hoverKey: ColorKey; labelKey: ColorKey; labelHoverKey: ColorKey }[] = [
    { key: 'generalAirport', label: t.colorSettings.generalAirports, hoverKey: 'generalAirportHover', labelKey: 'generalLabelColor', labelHoverKey: 'generalLabelHoverColor' },
    { key: 'destinationAirport', label: t.colorSettings.destinationAirports, hoverKey: 'destinationAirportHover', labelKey: 'destinationLabelColor', labelHoverKey: 'destinationLabelHoverColor' },
    { key: 'tripAirport', label: t.colorSettings.tripAirports, hoverKey: 'tripAirportHover', labelKey: 'tripLabelColor', labelHoverKey: 'tripLabelHoverColor' },
  ];

  const FC_HIGHLIGHT_ROWS: { bgKey: ColorKey; borderKey: ColorKey; label: string }[] = [
    { bgKey: 'fcHighlightAirportBg', borderKey: 'fcHighlightAirportBorder', label: t.colorSettings.sameAirport },
    { bgKey: 'fcHighlightCityBg', borderKey: 'fcHighlightCityBorder', label: t.colorSettings.sameCity },
    { bgKey: 'fcHighlightCountryBg', borderKey: 'fcHighlightCountryBorder', label: t.colorSettings.sameCountry },
    { bgKey: 'fcHighlightSoonBg', borderKey: 'fcHighlightSoonBorder', label: t.colorSettings.departsTooSoon },
  ];

  const MAP_ROUTE_ROWS: { key: ColorKey; label: string; hoverKey?: ColorKey; hint?: string }[] = [
    { key: 'tripRoute', label: t.colorSettings.tripRoute, hoverKey: 'tripRouteHover' },
    { key: 'transferRoute', label: t.colorSettings.transferRoute, hoverKey: 'transferRouteHover' },
    { key: 'transferRoute', label: t.colorSettings.transferPreview },
  ];

  const SIZE_ROWS: { minKey: SizeKey; maxKey: SizeKey; label: string; min: number; max: number; step: number }[] = [
    { minKey: 'generalAirportRadiusMin', maxKey: 'generalAirportRadiusMax', label: t.colorSettings.generalDotSize, min: 0.5, max: 30, step: 0.5 },
    { minKey: 'generalAirportHoverRadiusMin', maxKey: 'generalAirportHoverRadiusMax', label: t.colorSettings.generalDotHoverSize, min: 0.5, max: 40, step: 0.5 },
    { minKey: 'generalAirportLabelSizeMin', maxKey: 'generalAirportLabelSizeMax', label: t.colorSettings.generalLabelSize, min: 6, max: 40, step: 1 },
    { minKey: 'generalLabelHoverSizeMin', maxKey: 'generalLabelHoverSizeMax', label: t.colorSettings.generalLabelHoverSize, min: 6, max: 48, step: 1 },
    { minKey: 'highlightedAirportRadiusMin', maxKey: 'highlightedAirportRadiusMax', label: t.colorSettings.highlightedDotSize, min: 0.5, max: 30, step: 0.5 },
    { minKey: 'highlightedAirportHoverRadiusMin', maxKey: 'highlightedAirportHoverRadiusMax', label: t.colorSettings.highlightedDotHoverSize, min: 0.5, max: 40, step: 0.5 },
    { minKey: 'highlightedLabelSizeMin', maxKey: 'highlightedLabelSizeMax', label: t.colorSettings.highlightedLabelSize, min: 6, max: 40, step: 1 },
    { minKey: 'highlightedLabelHoverSizeMin', maxKey: 'highlightedLabelHoverSizeMax', label: t.colorSettings.highlightedLabelHoverSize, min: 6, max: 48, step: 1 },
    { minKey: 'routeLineWidthMin', maxKey: 'routeLineWidthMax', label: t.colorSettings.routeLineWidth, min: 0.2, max: 16, step: 0.2 },
    { minKey: 'routeLineHoverWidthMin', maxKey: 'routeLineHoverWidthMax', label: t.colorSettings.routeLineHoverWidth, min: 0.2, max: 20, step: 0.2 },
    { minKey: 'tripRouteWidthMin', maxKey: 'tripRouteWidthMax', label: t.colorSettings.tripRouteWidth, min: 0.2, max: 18, step: 0.2 },
    { minKey: 'tripRouteHoverWidthMin', maxKey: 'tripRouteHoverWidthMax', label: t.colorSettings.tripRouteHoverWidth, min: 0.2, max: 22, step: 0.2 },
  ];

  const { startPoints, setStartPointColor, setColor, setSize, setZoomRange, resetColors, resetSizes, ...colors } = useColorStore();

  const [activeTooltip, setActiveTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!activeTooltip) return;
    const close = () => setActiveTooltip(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [activeTooltip]);

  const helpBtn = useCallback((text: string) => (
    <button
      className="color-col-help"
      title={text}
      onClick={e => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setActiveTooltip(prev => prev?.text === text ? null : {
          text,
          x: rect.left + rect.width / 2,
          y: rect.top - 4,
        });
      }}
    >?</button>
  ), []);

  const { viewport, mapStyle } = useMapStore();
  const zoom = viewport.zoom;

  const sizes = colors as unknown as Record<string, number>;
  const colorValues = colors as unknown as Record<string, string>;
  const zoomRangeMin = useColorStore(s => s.zoomRangeMin);
  const zoomRangeMax = useColorStore(s => s.zoomRangeMax);

  return (
    <div className="color-settings">
      {!showOnlySizes && (
        <>
          <div className="color-settings-header">
            <span className="color-settings-title">{t.colorSettings.colors}</span>
            <button className="color-settings-reset" onClick={() => resetColors(mapStyle)}>{t.controls.resetAll}</button>
          </div>

          <div className="color-section-label">{t.colorSettings.startingPoints}</div>
          <div className="color-settings-col-headers color-settings-col-headers--sp7">
            <span className="color-col-label" style={{ textAlign: 'left' }}></span>
            {helpBtn(t.colorSettings.help.airportDot)}
            {helpBtn(t.colorSettings.help.airportDotHover)}
            {helpBtn(t.colorSettings.help.routeLine)}
            {helpBtn(t.colorSettings.help.routeLineHover)}
            {helpBtn(t.colorSettings.help.labelColor)}
            {helpBtn(t.colorSettings.help.labelHoverColor)}
          </div>
          {startPoints.map((sp, i) => (
            <div key={i} className="color-row color-row--sp7">
              <span className="color-row-label">{t.colorSettings.pointLabel(i + 1)}</span>
              <ColorPicker color={sp.airport} onChange={c => setStartPointColor(i, 'airport', c)} title={`${t.colorSettings.pointLabel(i + 1)} - kropka`} />
              <ColorPicker color={sp.airportHover} onChange={c => setStartPointColor(i, 'airportHover', c)} title={`${t.colorSettings.pointLabel(i + 1)} - kropka (najechanie)`} />
              <ColorPicker color={sp.route} onChange={c => setStartPointColor(i, 'route', c)} title={`${t.colorSettings.pointLabel(i + 1)} - linia`} />
              <ColorPicker color={sp.routeHover} onChange={c => setStartPointColor(i, 'routeHover', c)} title={`${t.colorSettings.pointLabel(i + 1)} - linia (najechanie)`} />
              <ColorPicker color={sp.label} onChange={c => setStartPointColor(i, 'label', c)} title={`${t.colorSettings.pointLabel(i + 1)} - etykieta`} />
              <ColorPicker color={sp.labelHover} onChange={c => setStartPointColor(i, 'labelHover', c)} title={`${t.colorSettings.pointLabel(i + 1)} - etykieta (najechanie)`} />
            </div>
          ))}

          <hr className="color-divider" />

          <div className="color-section-label">{t.colorSettings.mapElements}</div>
          <div className="color-subsection-label">{t.colorSettings.airports}</div>
          <div className="color-settings-col-headers color-settings-col-headers--elem4">
            <span className="color-col-label" style={{ textAlign: 'left' }}></span>
            {helpBtn(t.colorSettings.help.dotColor)}
            {helpBtn(t.colorSettings.help.dotHoverColor)}
            {helpBtn(t.colorSettings.help.labelColor)}
            {helpBtn(t.colorSettings.help.labelHoverColor)}
          </div>
          {MAP_AIRPORT_ROWS.map(({ key, label, hoverKey, labelKey, labelHoverKey }) => (
            <div key={key} className="color-row color-row--elem4">
              <span className="color-row-label">{label}</span>
              <ColorPicker color={colorValues[key]} onChange={c => setColor(key, c)} title={`${label} - kropka`} />
              <ColorPicker color={colorValues[hoverKey]} onChange={c => setColor(hoverKey, c)} title={`${label} - kropka (najechanie)`} />
              <ColorPicker color={colorValues[labelKey]} onChange={c => setColor(labelKey, c)} title={`${label} - etykieta`} />
              <ColorPicker color={colorValues[labelHoverKey]} onChange={c => setColor(labelHoverKey, c)} title={`${label} - etykieta (najechanie)`} />
            </div>
          ))}

          <div className="color-subsection-label">{t.colorSettings.routes}</div>
          <div className="color-settings-col-headers color-settings-col-headers--elem2">
            <span className="color-col-label" style={{ textAlign: 'left' }}></span>
            {helpBtn(t.colorSettings.help.color)}
            {helpBtn(t.colorSettings.help.hoverColor)}
          </div>
          {MAP_ROUTE_ROWS.map(({ key, label, hoverKey, hint }) => (
            <div key={`${label}-${key}`} className="color-row color-row--elem2">
              <span className="color-row-label">
                {label}
                {hint && <span className="color-row-hint"> - {hint}</span>}
              </span>
              <ColorPicker color={colorValues[key]} onChange={c => setColor(key, c)} title={label} />
              {hoverKey ? (
                <ColorPicker color={colorValues[hoverKey]} onChange={c => setColor(hoverKey, c)} title={`${label} - najechanie`} />
              ) : (
                <div />
              )}
            </div>
          ))}

          <div className="color-subsection-label">{t.colorSettings.flightCardHighlights}</div>
          <div className="color-settings-col-headers color-settings-col-headers--elem2">
            <span className="color-col-label" style={{ textAlign: 'left' }}></span>
            {helpBtn(t.colorSettings.help.bgColor)}
            {helpBtn(t.colorSettings.help.borderColor)}
          </div>
          {FC_HIGHLIGHT_ROWS.map(({ bgKey, borderKey, label }) => (
            <div key={bgKey} className="color-row color-row--elem2">
              <span className="color-row-label">{label}</span>
              <ColorPicker color={colorValues[bgKey]} onChange={c => setColor(bgKey, c)} title={`${label} - tło`} />
              <ColorPicker color={colorValues[borderKey]} onChange={c => setColor(borderKey, c)} title={`${label} - obramowanie`} />
            </div>
          ))}

          <hr className="color-divider" />
        </>
      )}

      {showSizes && (
        <>
          <div className="color-section-label">{t.colorSettings.sizes}</div>

          <div className="size-row">
            <div className="size-row-header">
              <span className="color-row-label">{t.colorSettings.zoomRange}</span>
              <span className="size-value">{Math.min(zoomRangeMin, zoomRangeMax).toFixed(1)}–{Math.max(zoomRangeMin, zoomRangeMax).toFixed(1)}</span>
            </div>
            <RangeSlider
              min={CONFIG.MIN_ZOOM}
              max={CONFIG.MAX_ZOOM}
              step={0.1}
              minVal={zoomRangeMin}
              maxVal={zoomRangeMax}
              onMinChange={(v) => setZoomRange(v, zoomRangeMax)}
              onMaxChange={(v) => setZoomRange(zoomRangeMin, v)}
            />
          </div>
          <div className="zoom-info-row">
            <span className="zoom-label">{t.controls.zoom}</span>
            <span className="zoom-value">{zoom.toFixed(2)}</span>
            <button className="zoom-copy-btn" onClick={resetSizes} title="Zresetuj wszystkie suwaki rozmiarów do wartości domyślnych">
              {t.controls.resetSizes}
            </button>
          </div>

          {SIZE_ROWS.map(({ minKey, maxKey, label, min, max, step }) => {
            const minVal = sizes[minKey] as number;
            const maxVal = sizes[maxKey] as number;
            const precision = step < 1 ? 1 : 0;
            const loZ = Math.min(zoomRangeMin, zoomRangeMax).toFixed(1);
            const hiZ = Math.max(zoomRangeMin, zoomRangeMax).toFixed(1);
            return (
              <div key={`${minKey}-${maxKey}`} className="size-group">
                <span className="color-row-label">{label}</span>
                <span className="size-value">
                  {minVal.toFixed(precision)} (Oddalenie @{loZ}) → {maxVal.toFixed(precision)} (Przybliżenie @{hiZ})
                </span>
                <RangeSlider
                  min={min} max={max} step={step}
                  minVal={minVal} maxVal={maxVal}
                  onMinChange={(v) => setSize(minKey, v)}
                  onMaxChange={(v) => setSize(maxKey, v)}
                />
              </div>
            );
          })}
        </>
      )}

      {activeTooltip && ReactDOM.createPortal(
        <div className="color-col-tooltip" style={{
          position: 'fixed',
          left: activeTooltip.x,
          top: activeTooltip.y,
          transform: 'translateX(-50%) translateY(-100%)',
        }}>
          {activeTooltip.text}
        </div>,
        document.body
      )}
    </div>
  );
};

export default ColorSettings;
