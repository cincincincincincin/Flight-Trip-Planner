import { useEffect, useRef } from 'react';
import type { SelectedItem } from '../types';
import type { ExplorationItem } from '../stores/selectionStore';
import { getIsoDate, getTodayInTz } from '../utils/dateFormatting';

interface UseTravelDateParams {
  selectedItem: SelectedItem | null;
  timezone: string | null;
  explorationItems: ExplorationItem[];
  effectiveArrivalTimeUTC: string | null;
  selectedTimezoneOverride: string | null;
  resolvedTimezone: string | null | undefined;
  countryDisplayTZ: string | null;
  travelDate: string;
  updateSettings: (v: Partial<{ travelDate: string; timezone: string | null }>) => void;
}

/**
 * Manages all travelDate synchronisation side-effects.
 * Keeps the per-effect refs (`prevSelectedItemKeyRef`, `prevTimezoneRef`, etc.)
 * internal so they don't clutter the parent component.
 */
export function useTravelDate({
  selectedItem,
  timezone,
  explorationItems,
  effectiveArrivalTimeUTC,
  selectedTimezoneOverride,
  resolvedTimezone,
  countryDisplayTZ,
  travelDate,
  updateSettings,
}: UseTravelDateParams): { effectiveTravelDate: string } {
  const prevSelectedItemKeyRef = useRef<string | null>(null);
  const prevTimezoneRef = useRef<string | null>(null);
  const prevExplorationItemsCountRef = useRef<number>(0);
  const prevResolvedTZRef = useRef<string | null | undefined>(undefined);
  const travelDateForTZRef = useRef(travelDate);
  const prevCountryDisplayTZRef = useRef<string | null | undefined>(undefined);

  // Keep travelDateForTZRef in sync (used in closure of the resolvedTimezone effect)
  useEffect(() => { travelDateForTZRef.current = travelDate; }, [travelDate]);

  // ── Main travelDate effect ─────────────────────────────────────────────────────────
  // Gdy użytkownik ręcznie nadpisuje strefę, zachowujemy aktualną datę.
  // Reset tylko gdy selectedItem lub czas przylotu się zmienia (nowy kontekst eksploracji).
  useEffect(() => {
    if (!timezone) return;
    if (selectedTimezoneOverride) return;

    const overrideDatetime = selectedItem?.type === 'airport' ? selectedItem.overrideFromDatetime : undefined;
    const key = selectedItem
      ? `${selectedItem.type}:${(selectedItem.data as { code?: string })?.code ?? ''}:${overrideDatetime ?? ''}`
      : null;
    if (key !== prevSelectedItemKeyRef.current) {
      prevSelectedItemKeyRef.current = key;

      // [KLUCZOWY FIX]: Jeśli explorationItems rosło (użytkownik dodał lotnisko do eksploracji),
      // nie resetujemy travelDate — kontekst jest ten sam, zmieniamy tylko wybrany airport.
      // Reset robimy tylko gdy kontekst się zmienia (np. inne miasto/kraj).
      // [v24.95-FIX]: Check previous state BEFORE updating refs
      const isStartingFresh = prevExplorationItemsCountRef.current === 0;
      const isAddingToExploration = explorationItems.length > prevExplorationItemsCountRef.current;
      
      // Update ref AFTER capturing the above statuses
      prevExplorationItemsCountRef.current = explorationItems.length;

      // Reset date only if we are starting fresh (panel was closed)
      // OR if we are switching between top-level items (not growing the current exploration).
      if (isStartingFresh || !isAddingToExploration) {
        if (effectiveArrivalTimeUTC) {
          updateSettings({ travelDate: getIsoDate(new Date(effectiveArrivalTimeUTC), timezone) });
        } else {
          updateSettings({ travelDate: getTodayInTz(timezone) });
        }
      }

      prevTimezoneRef.current = timezone;
      return;
    }

    const itemsWereRemoved = explorationItems.length < prevExplorationItemsCountRef.current;
    const timezoneChanged = timezone !== prevTimezoneRef.current;

    // [LEGACY LOGIC]: Jeśli usuwamy elementy I strefa się zmienia, i byliśmy na "dziś" w starej strefie
    // → przeskocz na "dziś" w nowej strefie.
    if (itemsWereRemoved && timezoneChanged && prevTimezoneRef.current) {
      const oldTzToday = getTodayInTz(prevTimezoneRef.current);
      if (travelDate === oldTzToday) {
        updateSettings({ travelDate: getTodayInTz(timezone) });
      }
    } else if (!itemsWereRemoved && timezoneChanged) {
      // [LEGACY LOGIC]: Zmiana strefy przy dodaniu lotniska → synchronizuj datę.
      if (effectiveArrivalTimeUTC) {
        updateSettings({ travelDate: getIsoDate(new Date(effectiveArrivalTimeUTC), timezone) });
      } else {
        updateSettings({ travelDate: getTodayInTz(timezone) });
      }
    }

    prevTimezoneRef.current = timezone;
    prevExplorationItemsCountRef.current = explorationItems.length;
  }, [selectedItem, timezone, explorationItems.length, updateSettings, effectiveArrivalTimeUTC, selectedTimezoneOverride, travelDate]);

  // ── Sync travelDate when resolvedTimezone auto-switches (e.g. Melbourne added) ──
  useEffect(() => {
    if (selectedItem?.type === 'country') return;
    if (selectedTimezoneOverride) return;
    const prevTZ = prevResolvedTZRef.current;
    prevResolvedTZRef.current = resolvedTimezone;
    if (prevTZ === undefined || resolvedTimezone === prevTZ || !resolvedTimezone) return;
    const todayInPrevTZ = prevTZ ? getTodayInTz(prevTZ) : null;
    if (!todayInPrevTZ || travelDateForTZRef.current === todayInPrevTZ) {
      updateSettings({ travelDate: getTodayInTz(resolvedTimezone) });
    }
  }, [resolvedTimezone, selectedTimezoneOverride, selectedItem?.type, updateSettings]);

  // ── Set travelDate when country display TZ changes ─────────────────────────
  useEffect(() => {
    if (selectedItem?.type !== 'country') return;
    if (countryDisplayTZ === prevCountryDisplayTZRef.current) return;
    prevCountryDisplayTZRef.current = countryDisplayTZ;
    if (countryDisplayTZ) {
      updateSettings({ travelDate: getTodayInTz(countryDisplayTZ) });
    }
  }, [selectedItem?.type, countryDisplayTZ, updateSettings]);

  // Reset the country-display-TZ ref when the selected country changes
  useEffect(() => {
    if (selectedItem?.type !== 'country') prevCountryDisplayTZRef.current = undefined;
  }, [selectedItem]);

  // Reset prevResolvedTZRef when selectedItem changes so the next auto-TZ
  // change (e.g. first airport added after switching destinations) is treated as initial
  useEffect(() => {
    prevResolvedTZRef.current = undefined;
  }, [selectedItem]);

  const effectiveTravelDate = travelDate;

  return { effectiveTravelDate };
}
