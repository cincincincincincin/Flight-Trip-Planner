import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Airport } from '../types';
import { useAirportsQuery } from '../hooks/queries';
import './AirportTransferPicker.css';

interface AirportTransferPickerProps {
  currentAirport: Airport;
  onSelectAirport: (code: string) => void;
  onSelectAirports?: (codes: string[]) => void;
  onPreviewAirport?: (code: string) => void;
  onClearPreview?: () => void;
  maxSelect?: number;
  /** Always show the input field; no collapsible display mode */
  inline?: boolean;
  /** Already-selected codes — shown checked + locked in the dropdown */
  preCheckedCodes?: string[];
}

const formatDist = (km: number) => {
  if (km < 1000) return `${km} km`;
  return `${(km / 1000).toFixed(1)}k km`;
};

const AirportTransferPicker = ({
  currentAirport,
  onSelectAirport,
  onSelectAirports,
  onPreviewAirport,
  onClearPreview,
  maxSelect = 6,
  inline = false,
  preCheckedCodes = [],
}: AirportTransferPickerProps) => {
  const { data: airportsData } = useAirportsQuery();
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [displayCount, setDisplayCount] = useState(30);
  const [checkedCodes, setCheckedCodes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sortedAirports = useMemo(() => {
    if (!airportsData || !currentAirport) return [];
    const coords = currentAirport.coordinates;
    const lat = coords?.lat ?? 0;
    const lng = coords?.lon ?? coords?.lng ?? 0;
    const latRad = lat * Math.PI / 180;
    return airportsData.features
      .filter(f => f.properties.code && f.properties.code !== currentAirport.code)
      .map(f => {
        const [fLng, fLat] = f.geometry.coordinates;
        const dLat = (fLat - lat) * 111;
        const dLng = (fLng - lng) * 111 * Math.cos(latRad);
        const distKm = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
        return {
          code: f.properties.code,
          name: f.properties.name,
          city_name: f.properties.city_name,
          country_name: f.properties.country_name,
          distKm,
        };
      })
      .sort((a, b) => a.distKm - b.distKm);
  }, [airportsData, currentAirport]);

  const filteredAirports = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return sortedAirports;

    let result;
    if (q.length === 3) {
      const exactCode = sortedAirports.filter(a => a.code?.toLowerCase() === q);
      const exactSet = new Set(exactCode.map(a => a.code));
      const namePrefix = sortedAirports.filter(
        a => !exactSet.has(a.code) &&
          (a.name?.toLowerCase().startsWith(q) || a.city_name?.toLowerCase().startsWith(q))
      );
      result = [...exactCode, ...namePrefix];
    } else {
      const codePrefix = sortedAirports.filter(a => a.code?.toLowerCase().startsWith(q));
      const codePrefixSet = new Set(codePrefix.map(a => a.code));
      const namePrefix = sortedAirports.filter(
        a => !codePrefixSet.has(a.code) &&
          (a.name?.toLowerCase().startsWith(q) || a.city_name?.toLowerCase().startsWith(q))
      );
      result = [...codePrefix, ...namePrefix];
    }

    if (result.length === 0) {
      const codeContains = sortedAirports.filter(a => a.code?.toLowerCase().includes(q));
      const codeContainsSet = new Set(codeContains.map(a => a.code));
      const nameContains = sortedAirports.filter(
        a => !codeContainsSet.has(a.code) &&
          (a.name?.toLowerCase().includes(q) ||
            a.city_name?.toLowerCase().includes(q) ||
            a.country_name?.toLowerCase().includes(q))
      );
      result = [...codeContains, ...nameContains];
    }

    return result;
  }, [sortedAirports, searchText]);

  // In inline mode: pre-checked airports appear first so they're always visible
  const displayedAirports = useMemo(() => {
    if (!inline || preCheckedCodes.length === 0) {
      return filteredAirports.slice(0, displayCount);
    }
    const preSet = new Set(preCheckedCodes);
    const pre = filteredAirports.filter(a => preSet.has(a.code));
    const rest = filteredAirports.filter(a => !preSet.has(a.code));
    return [...pre, ...rest].slice(0, displayCount);
  }, [filteredAirports, displayCount, inline, preCheckedCodes]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchText('');
        setDisplayCount(30);
        setCheckedCodes([]);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchText('');
        setDisplayCount(30);
        setCheckedCodes([]);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Toggle mode: open from display div
  const handleOpen = () => {
    setIsOpen(true);
    setDisplayCount(30);
    setSearchText('');
    setCheckedCodes([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Inline mode: open when input is clicked
  const handleInputClick = () => {
    if (!isOpen) {
      setIsOpen(true);
      setCheckedCodes([]);
      setDisplayCount(30);
    }
  };

  const handleConfirm = () => {
    if (checkedCodes.length === 0) return;
    if (onSelectAirports) {
      onSelectAirports(checkedCodes);
    } else {
      onSelectAirport(checkedCodes[0]);
    }
    setIsOpen(false);
    setSearchText('');
    setDisplayCount(30);
    setCheckedCodes([]);
  };

  const handleToggle = (code: string) => {
    setCheckedCodes(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code);
      if (prev.length >= maxSelect) return prev;
      return [...prev, code];
    });
  };

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      setDisplayCount(prev => prev + 30);
    }
  };

  const displayName = [currentAirport.name, currentAirport.city_name, currentAirport.country_name]
    .filter(Boolean)
    .join(', ');

  // ── Inline mode ───────────────────────────────────────────────────────────────
  if (inline) {
    return (
      <div ref={containerRef} className="airport-transfer-picker airport-transfer-picker--inline">
        <div className="atp-header">
          <input
            ref={inputRef}
            className="atp-input"
            value={searchText}
            onChange={e => {
              setSearchText(e.target.value);
              setDisplayCount(30);
              if (!isOpen) setIsOpen(true);
            }}
            onClick={handleInputClick}
            placeholder="Search airports to add..."
          />
          {isOpen && <span className="atp-counter">{checkedCodes.length}/{maxSelect}</span>}
        </div>
        {isOpen && (
          <>
            <div className="atp-dropdown" onScroll={handleListScroll} onMouseLeave={() => onClearPreview?.()}>
              {displayedAirports.length === 0 ? (
                <div className="atp-no-results">No airports found</div>
              ) : (
                displayedAirports.map(airport => {
                  const isPreChecked = preCheckedCodes.includes(airport.code);
                  const isNewChecked = checkedCodes.includes(airport.code);
                  const checked = isPreChecked || isNewChecked;
                  const disabled = isPreChecked || (!isNewChecked && checkedCodes.length >= maxSelect);
                  return (
                    <label
                      key={airport.code}
                      className={`atp-option ${checked ? 'atp-checked' : ''} ${disabled ? 'atp-disabled' : ''} ${isPreChecked ? 'atp-pre-checked' : ''}`}
                      onMouseEnter={() => !isPreChecked && !disabled && onPreviewAirport?.(airport.code)}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => !isPreChecked && handleToggle(airport.code)}
                        className="atp-checkbox"
                      />
                      <span className="atp-option-code">{airport.code}</span>
                      <div className="atp-option-info">
                        <span className="atp-option-name">{airport.name}</span>
                        {(airport.city_name || airport.country_name) && (
                          <span className="atp-option-location">
                            {[airport.city_name, airport.country_name].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </div>
                      <span className="atp-option-dist">({formatDist(airport.distKm)})</span>
                    </label>
                  );
                })
              )}
            </div>
            {checkedCodes.length > 0 && (
              <button className="atp-confirm-btn" onClick={handleConfirm}>
                Add {checkedCodes.length === 1 ? checkedCodes[0] : `${checkedCodes.length} airports`} to search
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Toggle mode (original behavior) ───────────────────────────────────────────
  return (
    <div ref={containerRef} className="airport-transfer-picker">
      {isOpen ? (
        <>
          <div className="atp-header">
            <input
              ref={inputRef}
              className="atp-input"
              value={searchText}
              onChange={e => {
                setSearchText(e.target.value);
                setDisplayCount(30);
              }}
              placeholder={displayName}
            />
            <span className="atp-counter">{checkedCodes.length}/{maxSelect}</span>
          </div>
          <div className="atp-dropdown" onScroll={handleListScroll} onMouseLeave={() => onClearPreview?.()}>
            {displayedAirports.length === 0 ? (
              <div className="atp-no-results">No airports found</div>
            ) : (
              displayedAirports.map(airport => {
                const checked = checkedCodes.includes(airport.code);
                const disabled = !checked && checkedCodes.length >= maxSelect;
                return (
                  <label
                    key={airport.code}
                    className={`atp-option ${checked ? 'atp-checked' : ''} ${disabled ? 'atp-disabled' : ''}`}
                    onMouseEnter={() => !disabled && onPreviewAirport?.(airport.code)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => handleToggle(airport.code)}
                      className="atp-checkbox"
                    />
                    <span className="atp-option-code">{airport.code}</span>
                    <div className="atp-option-info">
                      <span className="atp-option-name">{airport.name}</span>
                      {(airport.city_name || airport.country_name) && (
                        <span className="atp-option-location">
                          {[airport.city_name, airport.country_name].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                    <span className="atp-option-dist">({formatDist(airport.distKm)})</span>
                  </label>
                );
              })
            )}
          </div>
          {checkedCodes.length > 0 && (
            <button className="atp-confirm-btn" onClick={handleConfirm}>
              Add {checkedCodes.length === 1 ? checkedCodes[0] : `${checkedCodes.length} airports`} to search
            </button>
          )}
        </>
      ) : (
        <div className="atp-display" onClick={handleOpen} title="Click to add airports to search">
          <span className="atp-icon">✈️</span>
          <span className="atp-name">{displayName}</span>
          <span className="atp-hint">🔍</span>
        </div>
      )}
    </div>
  );
};

export default AirportTransferPicker;
