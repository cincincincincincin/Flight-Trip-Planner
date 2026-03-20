import React, { useEffect, useRef, useCallback, useState } from 'react';
import ReactDOM from 'react-dom';
import { useColorStore, type ColorKey, type SizeKey } from '../stores/colorStore';
import { useMapStore } from '../stores/mapStore';
import './ColorSettings.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
function interpolateZoomValue(minVal: number, maxVal: number, z: number, zMin: number, zMax: number): number {
  const minZoom = Math.max(MIN_ZOOM, Math.min(zMin, zMax));
  const maxZoom = Math.min(MAX_ZOOM, Math.max(zMin, zMax));
  if (minZoom === maxZoom) return maxVal;
  const clamped = Math.max(minZoom, Math.min(z, maxZoom));
  const t = (clamped - minZoom) / (maxZoom - minZoom);
  return minVal + (maxVal - minVal) * t;
}

const START_POINT_LABELS = [
  'Point 1', 'Point 2', 'Point 3',
  'Point 4', 'Point 5', 'Point 6',
];

const MAP_AIRPORT_ROWS: { key: ColorKey; label: string; hoverKey: ColorKey; labelKey: ColorKey; labelHoverKey: ColorKey }[] = [
  { key: 'generalAirport',     label: 'General airports',     hoverKey: 'generalAirportHover',     labelKey: 'generalLabelColor',      labelHoverKey: 'generalLabelHoverColor' },
  { key: 'destinationAirport', label: 'Destination airports', hoverKey: 'destinationAirportHover', labelKey: 'destinationLabelColor',  labelHoverKey: 'destinationLabelHoverColor' },
  { key: 'tripAirport',        label: 'Trip airports',        hoverKey: 'tripAirportHover',        labelKey: 'tripLabelColor',         labelHoverKey: 'tripLabelHoverColor' },
];

const MAP_ROUTE_ROWS: { key: ColorKey; label: string; hoverKey?: ColorKey; hint?: string }[] = [
  { key: 'tripRoute',      label: 'Trip route',      hoverKey: 'tripRouteHover' },
  { key: 'transferRoute',  label: 'Transfer route',  hoverKey: 'transferRouteHover' },
  { key: 'transferRoute',  label: 'Transfer preview' },
];

const SIZE_ROWS: { minKey: SizeKey; maxKey: SizeKey; label: string; min: number; max: number; step: number }[] = [
  { minKey: 'generalAirportRadiusMin',        maxKey: 'generalAirportRadiusMax',        label: 'General dot size',              min: 0.5, max: 30, step: 0.5 },
  { minKey: 'generalAirportHoverRadiusMin',   maxKey: 'generalAirportHoverRadiusMax',   label: 'General dot hover size',        min: 0.5, max: 40, step: 0.5 },
  { minKey: 'generalAirportLabelSizeMin',     maxKey: 'generalAirportLabelSizeMax',     label: 'General label size',            min: 6,   max: 40, step: 1 },
  { minKey: 'generalLabelHoverSizeMin',       maxKey: 'generalLabelHoverSizeMax',       label: 'General label hover size',      min: 6,   max: 48, step: 1 },
  { minKey: 'highlightedAirportRadiusMin',    maxKey: 'highlightedAirportRadiusMax',    label: 'Highlighted dot size',          min: 0.5, max: 30, step: 0.5 },
  { minKey: 'highlightedAirportHoverRadiusMin', maxKey: 'highlightedAirportHoverRadiusMax', label: 'Highlighted dot hover size', min: 0.5, max: 40, step: 0.5 },
  { minKey: 'highlightedLabelSizeMin',        maxKey: 'highlightedLabelSizeMax',        label: 'Highlighted label size',        min: 6,   max: 40, step: 1 },
  { minKey: 'highlightedLabelHoverSizeMin',   maxKey: 'highlightedLabelHoverSizeMax',   label: 'Highlighted label hover size',  min: 6,   max: 48, step: 1 },
  { minKey: 'routeLineWidthMin',              maxKey: 'routeLineWidthMax',              label: 'Route line width',              min: 0.2, max: 16, step: 0.2 },
  { minKey: 'routeLineHoverWidthMin',         maxKey: 'routeLineHoverWidthMax',         label: 'Route line hover width',        min: 0.2, max: 20, step: 0.2 },
  { minKey: 'tripRouteWidthMin',              maxKey: 'tripRouteWidthMax',              label: 'Trip route line width',         min: 0.2, max: 18, step: 0.2 },
  { minKey: 'tripRouteHoverWidthMin',         maxKey: 'tripRouteHoverWidthMax',         label: 'Trip route line hover width',   min: 0.2, max: 22, step: 0.2 },
];

// ─── Color helpers ─────────────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

function parseColorString(c: string): [number, number, number, number] {
  if (c.startsWith('rgba(')) {
    const m = c.match(/[\d.]+/g) || [];
    return [+(m[0] ?? '0') || 0, +(m[1] ?? '0') || 0, +(m[2] ?? '0') || 0, Math.round(+(m[3] ?? '1') * 255)];
  }
  const h = c.replace('#', '');
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [r, g, b, a];
  }
  return [0, 0, 0, 255];
}

function colorToString(r: number, g: number, b: number, a: number): string {
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  if (a >= 255) return `#${hex(r)}${hex(g)}${hex(b)}`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

// ─── Screen-capture eyedropper overlay (Firefox / no EyeDropper API) ──────────

interface ScreenPickerProps {
  onPick: (hex: string) => void;
  onCancel: () => void;
}

const ScreenPickerOverlay: React.FC<ScreenPickerProps> = ({ onPick, onCancel }) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const pixelRef = useRef<{ data: Uint8ClampedArray; w: number; h: number; sx: number; sy: number } | null>(null);
  const [hoverColor, setHoverColor] = useState('#000000');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const zoomRef = useRef<HTMLCanvasElement>(null);
  const CELL = 8, CELLS = 11, ZOOM = CELL * CELLS;

  useEffect(() => {
    (async () => {
      try {
        const stream = await (navigator.mediaDevices as MediaDevices & {
          getDisplayMedia: (c: object) => Promise<MediaStream>
        }).getDisplayMedia({ video: true });
        const video = document.createElement('video');
        video.srcObject = stream;
        await new Promise<void>(r => { video.onloadedmetadata = () => r(); });
        await video.play();
        // Wait two frames so the captured frame shows actual content
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const w = video.videoWidth, h = video.videoHeight;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(video, 0, 0);
        stream.getTracks().forEach(t => t.stop());
        const { data } = ctx.getImageData(0, 0, w, h);
        pixelRef.current = { data, w, h, sx: w / window.innerWidth, sy: h / window.innerHeight };
        setImgSrc(c.toDataURL('image/jpeg', 0.9));
      } catch { onCancel(); }
    })();
  }, [onCancel]);

  const getHex = (cx: number, cy: number) => {
    const p = pixelRef.current;
    if (!p) return '#000000';
    const px = Math.min(Math.round(cx * p.sx), p.w - 1);
    const py = Math.min(Math.round(cy * p.sy), p.h - 1);
    const i = (py * p.w + px) * 4;
    return `#${p.data[i].toString(16).padStart(2,'0')}${p.data[i+1].toString(16).padStart(2,'0')}${p.data[i+2].toString(16).padStart(2,'0')}`;
  };

  const drawZoom = (cx: number, cy: number) => {
    const zc = zoomRef.current; const p = pixelRef.current;
    if (!zc || !p) return;
    const ctx = zc.getContext('2d')!;
    ctx.clearRect(0, 0, ZOOM, ZOOM);
    const half = Math.floor(CELLS / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const px = Math.round(cx * p.sx) + dx, py = Math.round(cy * p.sy) + dy;
        if (px < 0 || py < 0 || px >= p.w || py >= p.h) continue;
        const i = (py * p.w + px) * 4;
        ctx.fillStyle = `rgb(${p.data[i]},${p.data[i+1]},${p.data[i+2]})`;
        ctx.fillRect((dx + half) * CELL, (dy + half) * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(half * CELL, half * CELL, CELL, CELL);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    setHoverColor(getHex(e.clientX, e.clientY));
    drawZoom(e.clientX, e.clientY);
  };

  const previewLeft = Math.min(pos.x + 20, window.innerWidth - ZOOM - 20);
  const previewTop = Math.min(Math.max(pos.y - ZOOM / 2, 8), window.innerHeight - ZOOM - 30);

  return ReactDOM.createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99998, cursor: 'crosshair', userSelect: 'none' }}
      onMouseMove={handleMouseMove}
      onClick={e => onPick(getHex(e.clientX, e.clientY))}
      onKeyDown={e => e.key === 'Escape' && onCancel()}
      tabIndex={0}
      ref={el => el?.focus()}
    >
      {imgSrc
        ? <img src={imgSrc} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} draggable={false} />
        : <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1e1e2e', color: 'white', padding: '12px 20px', borderRadius: 8, fontSize: 13 }}>
              Select window in browser dialog…
            </div>
          </div>
      }
      {imgSrc && (
        <>
          <div style={{
            position: 'fixed', left: previewLeft, top: previewTop,
            pointerEvents: 'none', border: '2px solid rgba(255,255,255,0.85)',
            borderRadius: 5, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.7)',
          }}>
            <canvas ref={zoomRef} width={ZOOM} height={ZOOM} />
            <div style={{ background: hoverColor, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontFamily: 'monospace', color: 'white', textShadow: '0 0 3px #000' }}>
              {hoverColor}
            </div>
          </div>
          <div style={{
            position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: 12,
            padding: '4px 12px', borderRadius: 4, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            Click to pick · Esc to cancel
          </div>
        </>
      )}
    </div>,
    document.body
  );
};

// ─── ColorPicker component ─────────────────────────────────────────────────────

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  title?: string;
}

const SV_W = 148, SV_H = 120, STRIP_W = 14, STRIP_H = 120;

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, title }) => {
  const [open, setOpen] = useState(false);
  const [screenPicking, setScreenPicking] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'sv' | 'hue' | 'alpha' | null>(null);

  const parsedRef = useRef(parseColorString(color));
  const [r0, g0, b0, a0] = parsedRef.current;
  const [h0, s0, v0] = rgbToHsv(r0, g0, b0);

  const [hue, setHue] = useState(h0);
  const [sat, setSat] = useState(s0);
  const [val, setVal] = useState(v0);
  const [alpha, setAlpha] = useState(a0);

  // sync when color prop changes from outside
  useEffect(() => {
    const [r, g, b, a] = parseColorString(color);
    const [h, s, v] = rgbToHsv(r, g, b);
    setHue(h); setSat(s); setVal(v); setAlpha(a);
  }, [color]);

  const [r, g, b] = hsvToRgb(hue, sat, val);

  // ── Draw SV canvas ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const canvas = svRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const [hr, hg, hb] = hsvToRgb(hue, 100, 100);
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`;
    ctx.fillRect(0, 0, W, H);
    const wg = ctx.createLinearGradient(0, 0, W, 0);
    wg.addColorStop(0, 'rgba(255,255,255,1)');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // cursor
    const cx = (sat / 100) * W, cy = (1 - val / 100) * H;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  }, [open, hue, sat, val]);

  // ── Draw hue strip ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const canvas = hueRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    [0, 60, 120, 180, 240, 300, 360].forEach((deg, i, arr) =>
      grad.addColorStop(i / (arr.length - 1), `hsl(${deg},100%,50%)`)
    );
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // cursor line
    const cy = (hue / 360) * H;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, cy - 2, W, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, cy - 2, W, 4);
  }, [open, hue]);

  // ── Position popover — calculated on click to avoid visible jump ───────────
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({ position: 'fixed', left: 0, top: 0 });

  const calcPopoverPos = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const popW = 210, popH = 230;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.left + rect.width / 2 - popW / 2;
    let top = rect.top - popH - 6;
    if (left < 8) left = 8;
    if (left + popW > vw - 8) left = vw - popW - 8;
    if (top < 8) top = Math.min(rect.bottom + 6, vh - popH - 8);
    setPopoverStyle({ position: 'fixed', left, top, transform: 'none', bottom: 'auto' });
  };

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapperRef.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Global mouse move / up for drag ────────────────────────────────────────
  const commitSv = useCallback((s: number, v: number, h: number, a: number) => {
    const [rr, gg, bb] = hsvToRgb(h, s, v);
    onChange(colorToString(rr, gg, bb, a));
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current === 'sv') {
        const canvas = svRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX));
        const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY));
        const s = Math.round((x / canvas.width) * 100);
        const v = Math.round((1 - y / canvas.height) * 100);
        setSat(s); setVal(v);
        commitSv(s, v, hue, alpha);
      } else if (dragging.current === 'hue') {
        const canvas = hueRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scaleY = canvas.height / rect.height;
        const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY));
        const h = Math.round((y / canvas.height) * 360);
        setHue(h);
        commitSv(sat, val, h, alpha);
      } else if (dragging.current === 'alpha') {
        const el = alphaRef.current!;
        const rect = el.getBoundingClientRect();
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const a = Math.round((1 - y / rect.height) * 255);
        setAlpha(a);
        const [rr, gg, bb] = hsvToRgb(hue, sat, val);
        onChange(colorToString(rr, gg, bb, a));
      }
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [hue, sat, val, alpha, commitSv, onChange]);

  // ── RGBA input handlers ────────────────────────────────────────────────────
  const handleRgbaInput = (channel: 'r'|'g'|'b'|'a', raw: string) => {
    const n = Math.max(0, Math.min(255, parseInt(raw) || 0));
    const nr = channel === 'r' ? n : r;
    const ng = channel === 'g' ? n : g;
    const nb = channel === 'b' ? n : b;
    const na = channel === 'a' ? n : alpha;
    if (channel !== 'a') {
      const [nh, ns, nv] = rgbToHsv(nr, ng, nb);
      setHue(nh); setSat(ns); setVal(nv);
    } else {
      setAlpha(na);
    }
    onChange(colorToString(nr, ng, nb, na));
  };

  // ── Eyedropper ─────────────────────────────────────────────────────────────
  const applyPickedColor = (hex: string) => {
    const [rr, gg, bb, aa] = parseColorString(hex);
    const [nh, ns, nv] = rgbToHsv(rr, gg, bb);
    setHue(nh); setSat(ns); setVal(nv); setAlpha(aa);
    onChange(colorToString(rr, gg, bb, aa));
  };

  const handleEyedropper = async () => {
    if ('EyeDropper' in window) {
      // Native eyedropper (Chrome / Edge)
      try {
        const dropper = new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper();
        const result = await dropper.open();
        applyPickedColor(result.sRGBHex);
      } catch { /* cancelled */ }
    } else {
      // Screen-capture fallback (Firefox)
      setOpen(false);
      setScreenPicking(true);
    }
  };

  const alphaGrad = `linear-gradient(to bottom, ${colorToString(r, g, b, 255)} 0%, rgba(${r},${g},${b},0) 100%)`;
  const checkerBg = 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'8\'><rect width=\'4\' height=\'4\' fill=\'%23ccc\'/><rect x=\'4\' y=\'4\' width=\'4\' height=\'4\' fill=\'%23ccc\'/></svg>")';

  const popoverContent = (
    <div className="color-picker-popover" ref={popoverRef} style={popoverStyle}>
      <button
        className="cp-eyedropper"
        onClick={handleEyedropper}
        title={'EyeDropper' in window ? 'Pick color from screen' : 'Not supported in this browser'}
        disabled={!('EyeDropper' in window)}
      >
        Eyedropper
      </button>
      <div className="cp-canvases">
        <canvas
          ref={svRef}
          className="cp-sv-canvas"
          width={SV_W} height={SV_H}
          onMouseDown={e => {
            dragging.current = 'sv';
            const canvas = svRef.current!;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX));
            const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY));
            const s = Math.round((x / canvas.width) * 100);
            const v = Math.round((1 - y / canvas.height) * 100);
            setSat(s); setVal(v);
            commitSv(s, v, hue, alpha);
          }}
        />
        <canvas
          ref={hueRef}
          className="cp-strip"
          width={STRIP_W} height={STRIP_H}
          onMouseDown={e => {
            dragging.current = 'hue';
            const canvas = hueRef.current!;
            const rect = canvas.getBoundingClientRect();
            const scaleY = canvas.height / rect.height;
            const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY));
            const h = Math.round((y / canvas.height) * 360);
            setHue(h);
            commitSv(sat, val, h, alpha);
          }}
        />
        <div
          ref={alphaRef}
          className="cp-strip cp-alpha-strip"
          style={{ background: `${alphaGrad}, ${checkerBg}` }}
          onMouseDown={e => {
            dragging.current = 'alpha';
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
            const a = Math.round((1 - y / rect.height) * 255);
            setAlpha(a);
            onChange(colorToString(r, g, b, a));
          }}
        >
          <div className="cp-alpha-cursor" style={{ top: `${(1 - alpha / 255) * 100}%` }} />
        </div>
      </div>
      <div className="cp-rgba-row">
        <div className="cp-color-preview" style={{ backgroundColor: colorToString(r, g, b, alpha) }} />
        {(['r','g','b','a'] as const).map(ch => (
          <div key={ch} className="cp-channel">
            <span className="cp-channel-label">{ch.toUpperCase()}</span>
            <input
              className="cp-channel-input"
              type="number"
              min={0} max={255}
              value={ch === 'r' ? r : ch === 'g' ? g : ch === 'b' ? b : alpha}
              onChange={e => handleRgbaInput(ch, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="color-picker-wrapper" ref={wrapperRef}>
      <button
        className="color-swatch-btn"
        style={{ backgroundColor: color }}
        title={title}
        onClick={() => { if (!open) calcPopoverPos(); setOpen(v => !v); }}
      />
      {open && ReactDOM.createPortal(popoverContent, document.body)}
      {screenPicking && (
        <ScreenPickerOverlay
          onPick={hex => { applyPickedColor(hex); setScreenPicking(false); setOpen(true); }}
          onCancel={() => { setScreenPicking(false); setOpen(true); }}
        />
      )}
    </div>
  );
};

// ─── ColorSettings ─────────────────────────────────────────────────────────────

type RangeSliderProps = {
  min: number;
  max: number;
  step: number;
  minVal: number;
  maxVal: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
};

const RangeSlider: React.FC<RangeSliderProps> = ({ min, max, step, minVal, maxVal, onMinChange, onMaxChange }) => {
  const lowVal = Math.min(minVal, maxVal);
  const highVal = Math.max(minVal, maxVal);
  const minPercent = ((lowVal - min) / (max - min)) * 100;
  const maxPercent = ((highVal - min) / (max - min)) * 100;
  const [activeThumb, setActiveThumb] = useState<'min' | 'max' | null>(null);
  const minZ = activeThumb === 'min' ? 4 : activeThumb === null ? 2 : 1;
  const maxZ = activeThumb === 'max' ? 4 : activeThumb === null ? 3 : 1;

  useEffect(() => {
    const clear = () => setActiveThumb(null);
    window.addEventListener('mouseup', clear);
    window.addEventListener('touchend', clear);
    return () => {
      window.removeEventListener('mouseup', clear);
      window.removeEventListener('touchend', clear);
    };
  }, []);
  return (
    <div className="range-slider">
      <div
        className="range-slider__track"
        style={{
          background: `linear-gradient(to right, rgba(255,255,255,0.12) ${minPercent}%, rgba(255,255,255,0.7) ${minPercent}%, rgba(255,255,255,0.7) ${maxPercent}%, rgba(255,255,255,0.12) ${maxPercent}%)`
        }}
      />
      <input
        type="range"
        min={min} max={max} step={step}
        value={minVal}
        onChange={e => onMinChange(parseFloat(e.target.value))}
        onMouseDown={() => setActiveThumb('min')}
        onTouchStart={() => setActiveThumb('min')}
        style={{ zIndex: minZ }}
        className="range-slider__input range-slider__input--min"
      />
      <input
        type="range"
        min={min} max={max} step={step}
        value={maxVal}
        onChange={e => onMaxChange(parseFloat(e.target.value))}
        onMouseDown={() => setActiveThumb('max')}
        onTouchStart={() => setActiveThumb('max')}
        style={{ zIndex: maxZ }}
        className="range-slider__input range-slider__input--max"
      />
    </div>
  );
};

// Reference zoom = 6 (quick jump point)
const REFERENCE_ZOOM = 6;

interface ColorSettingsProps {
  showOnlySizes?: boolean;
  showSizes?: boolean; // controls visibility of sizes section (default true)
}

const ColorSettings: React.FC<ColorSettingsProps> = ({
  showOnlySizes = false,
  showSizes = true
}) => {
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
  const sizes = colors as unknown as Record<string, number>;
  const colorValues = colors as unknown as Record<string, string>;
  const { viewport, setFlyToZoom } = useMapStore();
  const zoom = viewport.zoom;
  const zoomRangeMin = useColorStore(s => s.zoomRangeMin);
  const zoomRangeMax = useColorStore(s => s.zoomRangeMax);

  return (
    <div className="color-settings">
      {!showOnlySizes && (
        <>
          <div className="color-settings-header">
            <span className="color-settings-title">Colors</span>
            <button className="color-settings-reset" onClick={resetColors}>Reset all</button>
          </div>

          {/* ── Starting points ── */}
          <div className="color-section-label">Starting points</div>
          <div className="color-settings-col-headers color-settings-col-headers--sp7">
            <span className="color-col-label" style={{textAlign:'left'}}></span>
            {helpBtn("Airport dot")}
            {helpBtn("Airport dot hover")}
            {helpBtn("Route line")}
            {helpBtn("Route line hover")}
            {helpBtn("Label color")}
            {helpBtn("Label hover color")}
          </div>
          {startPoints.map((sp, i) => (
            <div key={i} className="color-row color-row--sp7">
              <span className="color-row-label">{START_POINT_LABELS[i]}</span>
              <ColorPicker color={sp.airport}          onChange={c => setStartPointColor(i, 'airport', c)}          title={`${START_POINT_LABELS[i]} - dot`} />
              <ColorPicker color={sp.airportHover}     onChange={c => setStartPointColor(i, 'airportHover', c)}     title={`${START_POINT_LABELS[i]} - dot hover`} />
              <ColorPicker color={sp.route}            onChange={c => setStartPointColor(i, 'route', c)}            title={`${START_POINT_LABELS[i]} - line`} />
              <ColorPicker color={sp.routeHover}       onChange={c => setStartPointColor(i, 'routeHover', c)}       title={`${START_POINT_LABELS[i]} - line hover`} />
              <ColorPicker color={sp.label}            onChange={c => setStartPointColor(i, 'label', c)}            title={`${START_POINT_LABELS[i]} - label`} />
              <ColorPicker color={sp.labelHover}       onChange={c => setStartPointColor(i, 'labelHover', c)}       title={`${START_POINT_LABELS[i]} - label hover`} />
            </div>
          ))}

          <hr className="color-divider" />

          {/* ── Map elements ── */}
          <div className="color-section-label">Map elements</div>
          <div className="color-subsection-label">Airports</div>
          <div className="color-settings-col-headers color-settings-col-headers--elem4">
            <span className="color-col-label" style={{textAlign:'left'}}></span>
            {helpBtn("Dot color")}
            {helpBtn("Dot hover color")}
            {helpBtn("Label color")}
            {helpBtn("Label hover color")}
          </div>
          {MAP_AIRPORT_ROWS.map(({ key, label, hoverKey, labelKey, labelHoverKey }) => (
            <div key={key} className="color-row color-row--elem4">
              <span className="color-row-label">{label}</span>
              <ColorPicker color={colorValues[key]} onChange={c => setColor(key, c)} title={`${label} dot`} />
              <ColorPicker color={colorValues[hoverKey]} onChange={c => setColor(hoverKey, c)} title={`${label} dot hover`} />
              <ColorPicker color={colorValues[labelKey]} onChange={c => setColor(labelKey, c)} title={`${label} label`} />
              <ColorPicker color={colorValues[labelHoverKey]} onChange={c => setColor(labelHoverKey, c)} title={`${label} label hover`} />
            </div>
          ))}

          <div className="color-subsection-label">Routes</div>
          <div className="color-settings-col-headers color-settings-col-headers--elem2">
            <span className="color-col-label" style={{textAlign:'left'}}></span>
            {helpBtn("Color")}
            {helpBtn("Hover color")}
          </div>
      {MAP_ROUTE_ROWS.map(({ key, label, hoverKey, hint }) => (
        <div key={`${label}-${key}`} className="color-row color-row--elem2">
          <span className="color-row-label">
            {label}
            {hint && <span className="color-row-hint"> - {hint}</span>}
          </span>
          <ColorPicker color={colorValues[key]} onChange={c => setColor(key, c)} title={label} />
          {hoverKey ? (
            <ColorPicker color={colorValues[hoverKey]} onChange={c => setColor(hoverKey, c)} title={`${label} hover`} />
          ) : (
            <div /> // puste miejsce – zachowuje układ trzech kolumn
          )}
        </div>
      ))}

          <hr className="color-divider" />
        </>
      )}

      {/* ── Sizes ── (tylko jeśli showSizes = true) */}
      {showSizes && (
        <>
          <div className="color-section-label">Sizes</div>

          {/* Zoom display + reset to default sizes */}
          <div className="size-row">
            <div className="size-row-header">
              <span className="color-row-label">Zoom range</span>
              <span className="size-value">{zoomRangeMin.toFixed(1)}–{zoomRangeMax.toFixed(1)}</span>
            </div>
            <RangeSlider
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.1}
              minVal={zoomRangeMin}
              maxVal={zoomRangeMax}
              onMinChange={(v) => {
                const low = Math.min(v, zoomRangeMax);
                const high = Math.max(v, zoomRangeMax);
                setZoomRange(low, high);
              }}
              onMaxChange={(v) => {
                const low = Math.min(zoomRangeMin, v);
                const high = Math.max(zoomRangeMin, v);
                setZoomRange(low, high);
              }}
            />
          </div>
          <div className="zoom-info-row">
            <span className="zoom-label">Zoom:</span>
            <span className="zoom-value">{zoom.toFixed(2)}</span>
            <button className="zoom-copy-btn" onClick={resetSizes} title="Reset all size sliders to defaults">
              ↺ Reset sizes
            </button>
          </div>

          {SIZE_ROWS.map(({ minKey, maxKey, label, min, max, step }) => {
            const minVal = sizes[minKey] as number;
            const maxVal = sizes[maxKey] as number;
            const current = interpolateZoomValue(minVal, maxVal, zoom, zoomRangeMin, zoomRangeMax);
            const precision = step < 1 ? 1 : 0;
            return (
              <div key={`${minKey}-${maxKey}`} className="size-row">
                <div className="size-row-header">
                  <span className="color-row-label">{label}</span>
                  <span className="size-value">
                    {minVal.toFixed(precision)}–{maxVal.toFixed(precision)}
                    <span className="size-at-zoom"> @{zoom.toFixed(1)} → {current.toFixed(precision)}</span>
                  </span>
                </div>
                <RangeSlider
                  min={min}
                  max={max}
                  step={step}
                  minVal={minVal}
                  maxVal={maxVal}
                  onMinChange={(v) => {
                    const low = Math.min(v, maxVal);
                    const high = Math.max(v, maxVal);
                    setSize(minKey, low);
                    if (high !== maxVal) setSize(maxKey, high);
                  }}
                  onMaxChange={(v) => {
                    const low = Math.min(minVal, v);
                    const high = Math.max(minVal, v);
                    setSize(minKey, low);
                    if (high !== maxVal) setSize(maxKey, high);
                  }}
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