import { useEffect, useRef } from 'react';
import type { SelectedItem } from '../types';
import type { ExplorationItem } from '../stores/selectionStore';
import { FORMAT_LOCALES } from '../constants/format';

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

  // ── Main travelDate effect ─────────────────────────────────────────────────
  // When the user manually overrides the timezone, preserve the current travelDate.
  // Only reset when selectedItem or arrival time changes.
  useEffect(() => {
    if (!timezone) return;
    if (selectedTimezoneOverride) return;

    const overrideDatetime = selectedItem?.type === 'airport' ? selectedItem.overrideFromDatetime : undefined;
    const key = selectedItem
      ? `${selectedItem.type}:${(selectedItem.data as { code?: string })?.code ?? ''}:${overrideDatetime ?? ''}`
      : null;
    if (key !== prevSelectedItemKeyRef.current) {
      prevSelectedItemKeyRef.current = key;
      if (effectiveArrivalTimeUTC) {
        updateSettings({ travelDate: new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }) });
      } else {
        updateSettings({ travelDate: new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }) });
      }
      prevTimezoneRef.current = timezone;
      prevExplorationItemsCountRef.current = explorationItems.length;
      return;
    }

    const itemsWereRemoved = explorationItems.length < prevExplorationItemsCountRef.current;
    const timezoneChanged = timezone !== prevTimezoneRef.current;

    if (itemsWereRemoved && timezoneChanged && prevTimezoneRef.current) {
      const oldTzToday = new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: prevTimezoneRef.current });
      if (travelDate === oldTzToday) {
        console.log(`[RACE-DEBUG] {useTravelDate} -> Items removed & TZ changed | Syncing date to ${timezone}`);
        const dateArg = effectiveArrivalTimeUTC || new Date();
        updateSettings({ travelDate: new Date(dateArg).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }) });
      }
    } else if (!itemsWereRemoved && timezoneChanged) {
      console.log(`[RACE-DEBUG] {useTravelDate} -> TZ changed | Syncing date to ${timezone}`);
      if (effectiveArrivalTimeUTC) {
        updateSettings({ travelDate: new Date(effectiveArrivalTimeUTC).toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }) });
      } else {
        updateSettings({ travelDate: new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: timezone }) });
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
    const todayInPrevTZ = prevTZ ? new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: prevTZ }) : null;
    if (!todayInPrevTZ || travelDateForTZRef.current === todayInPrevTZ) {
      updateSettings({ travelDate: new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: resolvedTimezone }) });
    }
  }, [resolvedTimezone, selectedTimezoneOverride, selectedItem?.type, updateSettings]);

  // ── Set travelDate when country display TZ changes ─────────────────────────
  useEffect(() => {
    if (selectedItem?.type !== 'country') return;
    if (countryDisplayTZ === prevCountryDisplayTZRef.current) return;
    prevCountryDisplayTZRef.current = countryDisplayTZ;
    if (countryDisplayTZ) {
      updateSettings({ travelDate: new Date().toLocaleDateString(FORMAT_LOCALES.CA, { timeZone: countryDisplayTZ }) });
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
