import dayjs from '../../lib/dayjs';
import type { Flight } from '../../types';
import { formatTime, popupFormatDuration, getUTCOffH, formatTzLabel, popupHaversineKm, getOffsetForTz } from './popupHelpers';
import { THEME_COLORS } from '../../constants/theme';
import { UI_SYMBOLS } from '../../constants/ui';

export interface BuildFlightRowOpts {
  airportCoordsMap: Record<string, [number, number]>;
  destUTCOffset: number | null;
  srcUTCOffset: number | null;
  destTimezone?: string;
  srcTimezone?: string;
}

export function buildFlightRow(f: Flight, opts: BuildFlightRowOpts): string {
  const { airportCoordsMap, destUTCOffset, srcUTCOffset, destTimezone, srcTimezone } = opts;
  const GOLD = THEME_COLORS.goldBg;
  const GOLD_BORDER = THEME_COLORS.goldBorder;
  const GOLD_TEXT = THEME_COLORS.goldText;

  const airlineCode = f.airline_code || '';
  const rawFlightNum = f.flight_number || '';
  const cleanFlightCode =
    airlineCode && !rawFlightNum.toUpperCase().startsWith(airlineCode.toUpperCase())
      ? `${airlineCode}${rawFlightNum}`
      : rawFlightNum;
  const airlineName = f.airline_name || airlineCode;
  const centerLabel = [airlineName, cleanFlightCode].filter(Boolean).join('  ');

  let arrHtml = '';
  const hasArrival = !!(f.scheduled_arrival_local || f.scheduled_arrival_utc);
  if (hasArrival) {
    const arrStr = formatTime(f.scheduled_arrival_local || f.scheduled_arrival_utc, destTimezone);
    const depOff = getUTCOffH(f.scheduled_departure_local, f.scheduled_departure_utc);
    const arrOff = getUTCOffH(f.scheduled_arrival_local, f.scheduled_arrival_utc);
    const tzDiff = depOff !== null && arrOff !== null ? arrOff - depOff : null;
    const tzLabel = tzDiff !== null ? formatTzLabel(tzDiff) : null;
    const tzHtml = tzLabel
      ? `<span style="font-size:10px;color:${tzDiff! > 0 ? '#10b981' : '#ef4444'};margin-right:3px;">${tzLabel}</span>`
      : '';
    arrHtml = `${tzHtml}<span class="mc-popup-time">${arrStr}</span>`;
  } else if (f.scheduled_departure_utc) {
    const srcC = airportCoordsMap[f.origin_airport_code || ''];
    const dstC = airportCoordsMap[f.destination_airport_code || ''];
    if (srcC && dstC) {
      const distKm = popupHaversineKm(srcC[0], srcC[1], dstC[0], dstC[1]);
      const blockMs = (distKm / 850 + 0.5) * 3600000;
      const estArrUtc = dayjs(f.scheduled_departure_utc).add(blockMs, 'ms');
      
      const dOff = destUTCOffset ?? (destTimezone ? getOffsetForTz(destTimezone, estArrUtc) : null);
      const sOff = srcUTCOffset ?? (srcTimezone ? getOffsetForTz(srcTimezone, dayjs(f.scheduled_departure_utc)) : (f.scheduled_departure_local ? getUTCOffH(f.scheduled_departure_local, f.scheduled_departure_utc) : null));

      let estStr: string;
      if (dOff !== null) {
        estStr = estArrUtc.utc().add(dOff, 'hour').format('HH:mm');
      } else {
        estStr = formatTime(estArrUtc.toISOString(), destTimezone);
      }
      const estTzDiff = (sOff !== null && dOff !== null) ? dOff - sOff : null;
      const estTzLabel = estTzDiff !== null ? formatTzLabel(estTzDiff) : null;
      const estTzHtml = estTzLabel
        ? `<span style="font-size:10px;color:${estTzDiff! > 0 ? '#10b981' : '#ef4444'};margin-right:3px;">${estTzLabel}</span>`
        : '';
      arrHtml = `${estTzHtml}<span class="mc-popup-est-arr" style="background:${GOLD};color:${GOLD_TEXT};border-color:${GOLD_BORDER}">${UI_SYMBOLS.ESTIMATED}${estStr}</span>`;
    }
  }

  return `
    <div class="mc-popup-row">
      <div class="mc-popup-time">${formatTime(f.scheduled_departure_local || f.scheduled_departure_utc, srcTimezone)}</div>
      <div class="mc-popup-airline">${centerLabel}</div>
      <div class="mc-popup-arr">${arrHtml}</div>
    </div>`;
}

export function formatGroupDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  const d = dayjs(dateStr);
  return d.isValid() ? d.format('D MMMM') : dateStr;
}

export interface BuildPopupHtmlOpts {
  srcCityName: string;
  destCityName: string;
  srcAirportName: string;
  destAirportName: string;
  headerDurationHtml: string;
  flightRows: string;
  hasFlights: boolean;
  extraCount: number;
  noFlightsText: string;
  clickFilterText: string;
}

export function buildPopupHtml(opts: BuildPopupHtmlOpts): string {
  const {
    srcCityName, destCityName, srcAirportName, destAirportName,
    headerDurationHtml, flightRows, hasFlights, extraCount,
    noFlightsText, clickFilterText,
  } = opts;
  return `
    <div class="mc-popup-container">
      <div class="mc-popup-header">
        <div class="mc-popup-header-city">${srcCityName}</div>
        ${headerDurationHtml}
        <div class="mc-popup-header-city right">${destCityName}</div>
      </div>
      <div class="mc-popup-airports">
        <div class="mc-popup-header-city">${srcAirportName}</div>
        <div></div>
        <div class="mc-popup-header-city right">${destAirportName}</div>
      </div>
      <div>
        ${hasFlights ? flightRows : `<div class="mc-popup-no-flights">${noFlightsText}</div>`}
      </div>
      ${extraCount > 0
        ? `<div class="mc-popup-dots">...</div><div class="mc-popup-extra">${clickFilterText}</div>`
        : ''}
    </div>
  `;
}

export function buildHeaderDuration(
  displayFlights: Flight[],
  srcCode: string,
  destCode: string,
  airportCoordsMap: Record<string, [number, number]>,
): { durationStr: string; estimated: boolean } {
  const firstWithTimes = displayFlights.find(
    f => f.scheduled_departure_utc && f.scheduled_arrival_utc,
  );
  if (firstWithTimes) {
    const min = dayjs(firstWithTimes.scheduled_arrival_utc).diff(dayjs(firstWithTimes.scheduled_departure_utc), 'minute');
    if (min > 0) return { durationStr: popupFormatDuration(min, false), estimated: false };
  }
  const srcC = airportCoordsMap[srcCode];
  const dstC = airportCoordsMap[destCode];
  if (srcC && dstC) {
    const distKm = popupHaversineKm(srcC[0], srcC[1], dstC[0], dstC[1]);
    const min = Math.round((distKm / 850 + 0.5) * 60);
    return { durationStr: popupFormatDuration(min, true), estimated: true };
  }
  return { durationStr: '', estimated: false };
}
