// Browsers stop requestAnimationFrame in hidden or covered tabs, and throttle main-thread
// timers there. Dedicated-worker timers keep running, so they drive the loop while hidden.
const TICKER_SOURCE = 'let t; onmessage = ({ data }) => { clearInterval(t); if (data > 0) t = setInterval(() => postMessage(0), data); };';

/**
 * Calls `step(now)` every animation frame while the page is visible. While it is hidden,
 * calls it at `hiddenHz` instead, but only when `keepAlive()` is true.
 * Returns a function that stops the loop.
 */
export function startFrameLoop(step, { hiddenHz = 15, keepAlive = () => true } = {}) {
  let stopped = false, frame = 0, ticker = null;
  const onFrame = (now) => {
    if (stopped) return;
    frame = requestAnimationFrame(onFrame);
    step(now);
  };
  const stopTicker = () => { ticker?.terminate(); ticker = null; };
  const onVisibility = () => {
    if (stopped) return;
    if (!document.hidden) {
      stopTicker();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(onFrame);
      return;
    }
    if (ticker || typeof Worker === 'undefined') return;
    const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }));
    try { ticker = new Worker(url); } catch { ticker = null; return; } finally { URL.revokeObjectURL(url); }
    ticker.onmessage = () => { if (!stopped && document.hidden && keepAlive()) step(performance.now()); };
    ticker.postMessage(1000 / hiddenHz);
  };
  document.addEventListener('visibilitychange', onVisibility);
  frame = requestAnimationFrame(onFrame);
  if (document.hidden) onVisibility();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stopTicker();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
