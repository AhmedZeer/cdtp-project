import { useEffect, useState } from 'react';

/** Image pixels per on-screen pixel of the camera view, so overlay text keeps a fixed on-screen size. */
export function useImagePixelsPerScreenPixel(ref, width) {
  const [unit, setUnit] = useState(2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => { if (el.clientWidth > 0) setUnit(width / el.clientWidth); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, width]);
  return unit;
}
