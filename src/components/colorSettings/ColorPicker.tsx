import React, { useEffect, useRef, useCallback, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTexts } from '../../hooks/useTexts';
import { CONFIG } from '../../constants/config';
import { hsvToRgb, rgbToHsv, parseColorString, colorToString } from '../../utils/colorUtils';
import ScreenPickerOverlay from './ScreenPickerOverlay';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  title?: string;
}

const SV_W = CONFIG.COLOR_PICKER_SV_WIDTH, SV_H = CONFIG.COLOR_PICKER_SV_HEIGHT, STRIP_W = CONFIG.COLOR_PICKER_STRIP_WIDTH, STRIP_H = CONFIG.COLOR_PICKER_STRIP_HEIGHT;

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, title }) => {
  const t = useTexts();
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

  useEffect(() => {
    const [r, g, b, a] = parseColorString(color);
    const [h, s, v] = rgbToHsv(r, g, b);
    setHue(h); setSat(s); setVal(v); setAlpha(a);
  }, [color]);

  const [r, g, b] = hsvToRgb(hue, sat, val);

  // Rysowanie nasycenia (SV)
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
    const cx = (sat / 100) * W, cy = (1 - val / 100) * H;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  }, [open, hue, sat, val]);

  // Rysowanie paska odcienia (Hue)
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
    const cy = (hue / 360) * H;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, cy - 2, W, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, cy - 2, W, 4);
  }, [open, hue]);

  // Pozycjonowanie popovera
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

  // Zamykanie przy kliknięciu poza
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapperRef.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Przeciąganie myszą
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

  // Obsługa wejścia RGBA
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

  // Kroplomierz (Eyedropper)
  const applyPickedColor = (hex: string) => {
    const [rr, gg, bb, aa] = parseColorString(hex);
    const [nh, ns, nv] = rgbToHsv(rr, gg, bb);
    setHue(nh); setSat(ns); setVal(nv); setAlpha(aa);
    onChange(colorToString(rr, gg, bb, aa));
  };

  const handleEyedropper = async () => {
    if ('EyeDropper' in window) {
      try {
        const dropper = new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper();
        const result = await dropper.open();
        applyPickedColor(result.sRGBHex);
      } catch { /* cancelled */ }
    } else {
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
        title={'EyeDropper' in window ? t.controls.pickColor : t.controls.notSupportedBrowser}
        disabled={!('EyeDropper' in window)}
      >{t.controls.eyedropper}</button>
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

export default ColorPicker;
