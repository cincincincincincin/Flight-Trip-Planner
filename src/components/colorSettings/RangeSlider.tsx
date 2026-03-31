import React, { useEffect, useState } from 'react';

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

export default RangeSlider;
