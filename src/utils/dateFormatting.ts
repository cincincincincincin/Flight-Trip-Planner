import { FORMAT_LOCALES, FORMAT_OPTIONS } from '../constants/format';
import { UI_SYMBOLS } from '../constants/ui';
import { CONFIG } from '../constants/config';

export const formatTime = (str: string | null | undefined, tz?: string): string => {
  if (!str) return UI_SYMBOLS.DASH;
  const d = new Date(str);
  if (isNaN(d.getTime())) return UI_SYMBOLS.DASH;
  return d.toLocaleTimeString(FORMAT_LOCALES.GB, { ...FORMAT_OPTIONS.TIME_24H, ...(tz ? { timeZone: tz } : {}) });
};

export const formatDate = (str: string | null | undefined, tz?: string): string => {
  if (!str) return UI_SYMBOLS.DASH;
  const d = new Date(str);
  if (isNaN(d.getTime())) return UI_SYMBOLS.DASH;
  return d.toLocaleDateString(FORMAT_LOCALES.GB, { ...FORMAT_OPTIONS.DATE_SHORT, ...(tz ? { timeZone: tz } : {}) });
};

export const formatDurationMs = (ms: number): string => {
  const totalMinutes = Math.floor(ms / 60000);
  const d = Math.floor(totalMinutes / CONFIG.MINUTES_PER_DAY);
  const h = Math.floor((totalMinutes % CONFIG.MINUTES_PER_DAY) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
};

export const getDuration = (dep: string | undefined, arr: string | undefined): string | null => {
  if (!dep || !arr) return null;
  const diff = new Date(arr).getTime() - new Date(dep).getTime();
  if (diff <= 0) return null;
  return formatDurationMs(diff);
};

export const getDurationMs = (from: string | undefined, to: string | undefined): number | null => {
  if (!from || !to) return null;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  return diff > 0 ? diff : null;
};

export const computeTzDiff = (depUtc: string, depTz: string, destTz: string): number | null => {
  if (depTz === destTz) return null;
  const d = new Date(depUtc);
  if (isNaN(d.getTime())) return null;
  const getOff = (tz: string) => {
    const s = d.toLocaleString(FORMAT_LOCALES.SE, { timeZone: tz });
    const u = d.toLocaleString(FORMAT_LOCALES.SE, { timeZone: 'UTC' });
    return (new Date(s).getTime() - new Date(u).getTime()) / 3600000;
  };
  const diff = getOff(destTz) - getOff(depTz);
  return diff === 0 ? null : diff;
};

export const formatTzDiff = (diff: number): string => {
  const sign = diff > 0 ? '+' : '';
  if (Number.isInteger(diff)) return `${sign}${diff}h`;
  const h = Math.trunc(diff);
  const m = Math.round(Math.abs(diff - h) * 60);
  return `${sign}${h}h${m > 0 ? `${m}m` : ''}`;
};
