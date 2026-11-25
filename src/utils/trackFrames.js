// A hidden tab stops presenting new frames to <video>, so analysis reads the camera track
// directly where the browser supports it (Chromium's MediaStreamTrackProcessor).
export function readTrackFrames(stream) {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof MediaStreamTrackProcessor === 'undefined') return null;
  let clone, reader;
  try {
    clone = track.clone();
    reader = new MediaStreamTrackProcessor({ track: clone }).readable.getReader();
  } catch { clone?.stop(); return null; }
  let stopped = false;
  const state = {
    stream, frame: null, count: 0,
    stop() {
      stopped = true;
      reader.cancel().catch(() => {});
      clone.stop();
      state.frame?.close();
      state.frame = null;
    },
  };
  (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (stopped) { value.close(); break; }
        state.frame?.close();
        state.frame = value; // only the newest frame is kept; older ones are released at once
        state.count += 1;
      }
    } catch { /* the track ended or the reader was cancelled */ }
  })();
  return state;
}
