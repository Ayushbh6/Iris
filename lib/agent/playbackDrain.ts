// Give queued goodbye audio time to finish, but never strand the UI if an
// AudioContext is suspended (for example when a phone goes into the background).
export function drainPlayback(pending: () => boolean, finish: () => void) {
  const deadline = Date.now() + 15_000;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const check = () => {
    if (cancelled) return;
    if (!pending() || Date.now() >= deadline) {
      cancelled = true;
      finish();
      return;
    }
    timer = setTimeout(check, 250);
  };
  timer = setTimeout(check, 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
