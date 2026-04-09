import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../constants/config';

export function useMobileSheet(selectedItem: any) {
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const mobileSheetRef = useRef<HTMLDivElement>(null);
  const sheetExpandedRef = useRef(false);

  useEffect(() => {
    sheetExpandedRef.current = mobileSheetExpanded;
  }, [mobileSheetExpanded]);

  useEffect(() => {
    setMobileSheetExpanded(false);
  }, [selectedItem]);

  useEffect(() => {
    const sheet = mobileSheetRef.current;
    if (!sheet) return;

    let dragging = false;
    let startY = 0;
    let startTranslate = 0;
    let currentTranslate = 0;

    const onStart = (e: TouchEvent) => {
      const rect = sheet.getBoundingClientRect();
      const fromTop = e.touches[0].clientY - rect.top;
      if (fromTop > CONFIG.PEEK_H + CONFIG.DRAG_HEADER_EXTRA) return;
      dragging = true;
      startY = e.touches[0].clientY;
      startTranslate = sheetExpandedRef.current ? 0 : window.innerHeight - CONFIG.PEEK_H;
      currentTranslate = startTranslate;
      sheet.style.transition = 'none';
    };

    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - startY;
      const maxT = window.innerHeight - CONFIG.PEEK_H;
      currentTranslate = Math.max(0, Math.min(maxT, startTranslate + dy));
      sheet.style.transform = `translateY(${currentTranslate}px)`;
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const totalDrag = currentTranslate - startTranslate;
      const wasExpanded = sheetExpandedRef.current;
      const nextExpanded = wasExpanded ? totalDrag < CONFIG.DRAG_THRESHOLD : totalDrag < -CONFIG.DRAG_THRESHOLD;
      sheet.style.transition = '';
      sheet.style.transform = '';
      setMobileSheetExpanded(nextExpanded);
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);

    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
    };
  }, [!!selectedItem]);

  return {
    mobileSheetExpanded,
    setMobileSheetExpanded,
    mobileSheetRef,
  };
}
