// RageClickRadar — signal batching + delivery.
// buildEnvelope is a pure function exported separately so Node unit tests can
// cover it without a browser. Delivery prefers navigator.sendBeacon (string
// body => text/plain) and falls back to a keepalive fetch.

// buildEnvelope(meta, events) -> wire envelope object.
// meta = { sid, page, vw, vh, getDocSize } where getDocSize() returns
// { dw, dh } measured at flush time (the document can grow after load).
// Built by spreading meta: the leftover getDocSize function property is
// dropped by JSON.stringify, so the serialized wire form is exactly
// { v, sid, page, vw, vh, dw, dh, events }.
export function buildEnvelope(meta, events) {
  return { v: 1, ...meta, ...meta.getDocSize(), events };
}

// createTransport(cfg, endpoint, meta) -> { enqueue, flush }
export function createTransport(cfg, endpoint, meta) {
  const MAX = cfg.BATCH_MAX_EVENTS;
  let buf = [];

  // Drain the buffer, splitting into envelopes of at most BATCH_MAX_EVENTS.
  // A no-op when the buffer is empty, so the interval can call it directly.
  const flush = () => {
    while (buf.length) {
      const body = JSON.stringify(buildEnvelope(meta, buf.splice(0, MAX)));
      try {
        // A string body goes out as text/plain (CORS-simple, beacon-friendly).
        // A missing sendBeacon throws and drops us into the fetch fallback.
        if (navigator.sendBeacon(endpoint, body)) continue;
      } catch (e) {}
      try {
        fetch(endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'content-type': 'text/plain' },
        }).catch(() => {});
      } catch (e) {}
    }
  };

  setInterval(flush, cfg.BATCH_INTERVAL_MS);

  return {
    enqueue(sig) {
      buf.push(sig);
      if (buf.length >= MAX) flush();
    },
    flush,
  };
}

export default createTransport;
