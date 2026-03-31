import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTexts } from '../../hooks/useTexts';
import { THEME_COLORS } from '../../constants/theme';

interface ScreenPickerProps {
  onPick: (hex: string) => void;
  onCancel: () => void;
}

const ScreenPickerOverlay: React.FC<ScreenPickerProps> = ({ onPick, onCancel }) => {
  const t = useTexts();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const pixelRef = useRef<{ data: Uint8ClampedArray; w: number; h: number; sx: number; sy: number } | null>(null);
  const [hoverColor, setHoverColor] = useState(THEME_COLORS.textBlack);
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
    if (!p) return THEME_COLORS.textBlack;
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
              {t.colorSettings.picker.selectWindow}
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
            {t.colorSettings.picker.clickToPick}
          </div>
        </>
      )}
    </div>,
    document.body
  );
};

export default ScreenPickerOverlay;
