// RageClickRadar — pure frustration detectors.
//
// These are pure state machines. They touch NO DOM, start NO timers, and never
// read the wall clock: all time enters through explicit `ts` (ms since page
// load) arguments. The DOM runtime computes the necessary facts (selectors,
// interactivity, drag distance, ...) and drives these APIs; emission happens
// synchronously inside the API calls, including `tick`.
//
// Signals are objects { t, ts, x, y, sel, n, m }; x/y/m are included only for
// the signal types that carry them.
//
// Implementation note: written compactly (short internal state names, truthy
// flags instead of booleans) because this file ships inside the size-budgeted
// browser bundle. The public API and emitted signals are unchanged and pinned
// by test/unit/detectors.test.js.

// createDetectors(config, emit) -> handle
// `config` is the shared CONFIG object (or an override-merged copy). `emit` is
// called synchronously with each signal.
export function createDetectors(config, emit) {
  // Rage: the currently open click cluster. x/y/sel belong to the FIRST click
  // (radius is measured from it, and that's what we report). `lt` = last click
  // ts, `q` = qualified (reached RAGE_MIN_CLICKS).
  let burst;
  // Dead clicks: candidates awaiting confirmation that nothing reacted.
  // `gone` = cancelled by a reaction; `b` = back-reference to the click's
  // burst so a qualifying rage burst suppresses the dead click (precedence).
  let dead = [];
  // Forms, keyed by form selector ('(no form)' groups orphan fields). Each:
  // counts (per-field input counts; its key set = the fields touched), t0
  // (first input ts), lastSel (last focused field selector), out (focus-left
  // ts or null), engaged / emitted / isSearch / formFieldCount.
  const forms = new Map();
  let curForm; // form selector currently holding focus
  // Correction: one field engagement (focus -> blur), del/ins counters.
  let ff;

  // Read each threshold once (keeps every long config key name to a single
  // occurrence in the minified bundle).
  const {
    RAGE_MIN_CLICKS: MINC,
    RAGE_MAX_GAP_MS: GAP,
    RAGE_SETTLE_MS: SETTLE,
    DEAD_WAIT_MS: WAIT,
    FORM_MIN_INPUTS: MININ,
    FORM_BLUR_ABANDON_MS: BLUR,
    CORRECTION_MIN_DELETES: MIND,
    CORRECTION_RATIO: RATIO,
    RAGE_RADIUS_PX: RAD,
  } = config;
  const RSQ = RAD * RAD;
  const key = (s) => (s == null ? '(no form)' : s);

  // Emit (if qualified) and discard the open burst.
  const closeBurst = (ts) => {
    if (burst && burst.n >= MINC)
      emit({ t: 'rage', ts, x: burst.x, y: burst.y, sel: burst.sel, n: burst.n });
    burst = null;
  };

  // Abandon a form unless already emitted, unengaged, or a lone search box.
  const abandon = (k, f, ts) => {
    if (f.engaged && !f.emitted && !(f.isSearch && f.formFieldCount <= 1)) {
      f.emitted = 1;
      emit({ t: 'formaband', ts, sel: k, n: f.counts.size, m: { last: f.lastSel, dwell: ts - f.t0 } });
    }
  };

  // Correction check for a finished field engagement (blur or hide).
  const evalCorr = (f, ts) => {
    if (f && !f.ignored && f.del >= MIND && f.del >= RATIO * f.ins)
      emit({ t: 'correction', ts, sel: f.sel, n: f.del, m: { i: f.ins } });
  };

  // Time advance — runs at the start of every event and from `tick`:
  // settle rage, resolve matured dead candidates, check blur abandonment.
  const advance = (ts) => {
    if (burst && ts - burst.lt >= SETTLE) closeBurst(ts);
    dead = dead.filter((c) => {
      if (ts - c.ts < WAIT) return 1;
      // Window elapsed: confirm unless something reacted or the click was
      // absorbed into a qualifying rage burst.
      if (!c.gone && !(c.b && c.b.q))
        emit({ t: 'dead', ts: c.ts + WAIT, x: c.x, y: c.y, sel: c.sel, n: 1 });
    });
    for (const [k, f] of forms) if (f.out != null && ts - f.out > BLUR) abandon(k, f, ts);
  };

  // Move focus between forms, stamping each affected form's "focus left" ts.
  const setFocus = (k, ts) => {
    if (k != curForm) {
      const a = forms.get(curForm);
      if (a) a.out = ts;
      const b = forms.get(k);
      if (b) b.out = null;
      curForm = k;
    }
  };

  // Shared body for onSubmit / onFormRemoved: drop the form's state.
  const clear = ({ ts, formSel }) => {
    advance(ts);
    forms.delete(key(formSel));
  };

  return {
    onClick({ ts, x, y, target: g }) {
      advance(ts);
      let b = null;
      if (!(g.allowRapid || g.isCanvas || g.ignored)) {
        if (burst && ts - burst.lt <= GAP && (x - burst.x) ** 2 + (y - burst.y) ** 2 <= RSQ) {
          burst.n++;
          burst.lt = ts;
        } else {
          closeBurst(ts); // emit the previous burst if it qualified
          burst = { x, y, sel: g.sel, n: 1, lt: ts };
        }
        if (burst.n >= MINC) burst.q = 1;
        b = burst;
      }
      if (!(g.interactive || g.isBodyOrHtml || g.ignored || g.dragged))
        dead.push({ ts, x, y, sel: g.sel, b });
    },

    onReaction(ts) {
      // Cancel candidates whose wait window covers this reaction BEFORE
      // resolving matured ones (a boundary reaction wins).
      for (const c of dead) if (ts >= c.ts && ts <= c.ts + WAIT) c.gone = 1;
      advance(ts);
    },

    onFieldFocus({ ts, field }) {
      advance(ts);
      const k = key(field.formSel);
      setFocus(k, ts);
      const f = forms.get(k);
      if (f) f.lastSel = field.sel;
      // Fresh correction engagement for this field.
      ff = { sel: field.sel, del: 0, ins: 0, ignored: field.ignored };
    },

    onFieldBlur({ ts, field }) {
      advance(ts);
      // Correction evaluates on blur of the engaged field.
      if (ff && ff.sel == field.sel) {
        evalCorr(ff, ts);
        ff = null;
      }
      setFocus(null, ts);
    },

    onFieldInput({ ts, field, kind }) {
      advance(ts);
      if (field.ignored) return; // ignored fields drive nothing
      const k = key(field.formSel);
      const inside = curForm === k; // focus already inside => not "outside"
      let f = forms.get(k);
      if (!f)
        forms.set(
          k,
          (f = {
            counts: new Map(),
            t0: ts,
            lastSel: inside && ff ? ff.sel : null,
            out: inside ? null : ts,
          }),
        );
      f.isSearch = field.isSearch;
      f.formFieldCount = field.formFieldCount;
      if (f.lastSel == null) f.lastSel = field.sel;
      const c = (f.counts.get(field.sel) || 0) + 1;
      f.counts.set(field.sel, c);
      if (c >= MININ) f.engaged = 1;
      if (ff && ff.sel == field.sel) {
        if (kind == 'delete') ff.del++;
        else if (kind == 'insert') ff.ins++;
      }
    },

    // Submit (cleared, no abandonment) and removal (neutral discard) both
    // just drop the form's state.
    onSubmit: clear,
    onFormRemoved: clear,

    tick: advance,

    onHide(ts) {
      advance(ts);
      // Flush a still-open rage burst regardless of the settle window.
      closeBurst(ts);
      // Unexpired dead candidates can't be confirmed here; discard the rest
      // (advance already emitted the matured ones).
      dead = [];
      // Correction for the still-focused field.
      evalCorr(ff, ts);
      ff = null;
      // Abandon every engaged, uncleared, non-exempt form.
      for (const [k, f] of forms) abandon(k, f, ts);
    },
  };
}

export default createDetectors;
