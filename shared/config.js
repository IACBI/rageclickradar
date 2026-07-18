// RageClickRadar — single source of truth for every tunable threshold.
// All values are plain numbers/objects so both the browser tracker and the
// Node server can import this module without any runtime dependencies.

export const CONFIG = Object.freeze({
  // Rage clicks
  RAGE_MIN_CLICKS: 3, // clicks needed to qualify as a rage burst
  RAGE_MAX_GAP_MS: 500, // max ms between consecutive clicks in a burst
  RAGE_RADIUS_PX: 30, // max px distance from the first click of the burst
  RAGE_SETTLE_MS: 700, // ms of silence that closes a burst (single emit)

  // Dead clicks
  DEAD_WAIT_MS: 600, // reaction window after click before declaring it dead
  DEAD_MAX_ANCESTORS: 10, // ancestor levels walked when checking interactivity
  DEAD_SCROLL_PX: 5, // scroll movement (px) that counts as a page reaction
  DEAD_DRAG_PX: 5, // pointer travel between down/up that means text-selection drag

  // Form abandonment
  FORM_MIN_INPUTS: 3, // input events on a field before the form counts as engaged
  FORM_BLUR_ABANDON_MS: 30000, // ms of focus outside an engaged form before mid-session abandon

  // Correction behavior
  CORRECTION_MIN_DELETES: 8, // min deletions in one field engagement to consider a signal
  CORRECTION_RATIO: 0.5, // deletions must be >= ratio * insertions to fire

  // Tracker limits
  MAX_EVENTS_PER_PAGEVIEW: 200, // hard cap per page view; tracker goes silent after
  BATCH_MAX_EVENTS: 50, // flush batch when this many events are buffered
  BATCH_INTERVAL_MS: 5000, // periodic flush interval
  SELECTOR_MAX_LEN: 120, // hard cap on emitted CSS selector length

  // Server
  DEFAULT_PORT: 8639, // collector/dashboard HTTP port
  MAX_BODY_BYTES: 65536, // request body cap for /api/collect
  RATE_LIMIT_PER_MIN: 60, // per-IP request budget (in-memory only; IPs never stored)

  // Scoring (confusion score weights per signal type)
  SCORE_WEIGHTS: { rage: 3, formaband: 3, correction: 2, dead: 1 }, // confusion score weights per signal type
});

export default CONFIG;
