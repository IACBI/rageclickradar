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

// createDetectors(config, emit) -> handle
// `config` is the shared CONFIG object (or an override-merged copy). `emit` is
// called synchronously with each signal.
export function createDetectors(config, emit) {
  // ---- Rage state -------------------------------------------------------
  // A burst is the currently open cluster of clicks. `x`/`y`/`sel` belong to
  // the FIRST click (radius is measured from it, and that's what we report).
  let burst = null; // { x, y, sel, n, lastTs, qualified }

  // ---- Dead-click state -------------------------------------------------
  // Candidates awaiting confirmation that nothing reacted. Each keeps a `burst`
  // back-reference so a click that turns into a qualifying rage burst can be
  // suppressed (rage precedence) instead of double-counted as a dead click.
  let deadCandidates = []; // { ts, x, y, sel, cancelled, burst }

  // ---- Form state -------------------------------------------------------
  // Keyed by form selector; orphan fields (formSel === null) group under
  // "(no form)".
  const forms = new Map();
  // The selector of the form that currently holds focus (or null when focus is
  // outside every form / on nothing).
  let currentFormSel = null;

  // ---- Correction state -------------------------------------------------
  // A single field engagement (focus -> blur). Deletes/inserts are counted per
  // engagement; refocusing starts a fresh one.
  let focusedField = null; // { sel, deletes, inserts, ignored }

  const RADIUS_SQ = config.RAGE_RADIUS_PX * config.RAGE_RADIUS_PX;

  // ----------------------------------------------------------------------
  // Rage helpers
  // ----------------------------------------------------------------------
  function closeBurst(ts) {
    if (!burst) return;
    if (burst.n >= config.RAGE_MIN_CLICKS) {
      emit({ t: 'rage', ts, x: burst.x, y: burst.y, sel: burst.sel, n: burst.n });
    }
    burst = null;
  }

  function settleRage(ts) {
    // Close the burst once it has been silent for the settle window.
    if (burst && ts - burst.lastTs >= config.RAGE_SETTLE_MS) {
      closeBurst(ts);
    }
  }

  // ----------------------------------------------------------------------
  // Dead-click helpers
  // ----------------------------------------------------------------------
  function resolveDead(ts) {
    if (deadCandidates.length === 0) return;
    const remaining = [];
    for (const c of deadCandidates) {
      if (ts - c.ts >= config.DEAD_WAIT_MS) {
        // Window elapsed: confirm unless something reacted or the click was
        // absorbed into a qualifying rage burst.
        const suppressed = c.cancelled || (c.burst && c.burst.qualified);
        if (!suppressed) {
          emit({
            t: 'dead',
            ts: c.ts + config.DEAD_WAIT_MS,
            x: c.x,
            y: c.y,
            sel: c.sel,
            n: 1,
          });
        }
      } else {
        remaining.push(c);
      }
    }
    deadCandidates = remaining;
  }

  // ----------------------------------------------------------------------
  // Form helpers
  // ----------------------------------------------------------------------
  function formKey(formSel) {
    return formSel == null ? '(no form)' : formSel;
  }

  // Move focus between forms, updating each affected form's "focus left at"
  // timestamp so mid-session blur abandonment can be measured.
  function setFocusForm(newFormSel, ts) {
    if (newFormSel === currentFormSel) return;
    const old = currentFormSel;
    if (old != null && forms.has(old)) forms.get(old).focusOutsideSince = ts;
    if (newFormSel != null && forms.has(newFormSel)) {
      forms.get(newFormSel).focusOutsideSince = null;
    }
    currentFormSel = newFormSel;
  }

  function abandonForm(key, f, ts) {
    if (f.emitted || !f.engaged) return;
    // Exemption: a lone search box isn't a form worth abandoning.
    if (f.isSearch && f.formFieldCount <= 1) return;
    f.emitted = true;
    emit({
      t: 'formaband',
      ts,
      sel: key,
      n: f.fieldsTouched.size,
      m: { last: f.lastFocusedSel, dwell: ts - f.firstInputTs },
    });
  }

  function checkFormBlurAbandon(ts) {
    for (const [key, f] of forms) {
      if (
        f.engaged &&
        !f.emitted &&
        f.focusOutsideSince != null &&
        ts - f.focusOutsideSince > config.FORM_BLUR_ABANDON_MS
      ) {
        abandonForm(key, f, ts);
      }
    }
  }

  // ----------------------------------------------------------------------
  // Correction helpers
  // ----------------------------------------------------------------------
  function evaluateCorrection(ff, ts) {
    if (!ff || ff.ignored) return;
    const d = ff.deletes;
    const i = ff.inserts;
    if (d >= config.CORRECTION_MIN_DELETES && d >= config.CORRECTION_RATIO * i) {
      emit({ t: 'correction', ts, sel: ff.sel, n: d, m: { i } });
    }
  }

  // ----------------------------------------------------------------------
  // Time advance — run at the start of every event and by `tick`.
  // ----------------------------------------------------------------------
  function advance(ts) {
    settleRage(ts);
    resolveDead(ts);
    checkFormBlurAbandon(ts);
  }

  // ----------------------------------------------------------------------
  // Public handle
  // ----------------------------------------------------------------------
  return {
    onClick({ ts, x, y, target }) {
      advance(ts);

      // --- Rage ---
      let burstForThisClick = null;
      const rageEligible = !(target.allowRapid || target.isCanvas || target.ignored);
      if (rageEligible) {
        if (burst) {
          const gap = ts - burst.lastTs;
          const dx = x - burst.x;
          const dy = y - burst.y;
          const withinBurst =
            gap <= config.RAGE_MAX_GAP_MS && dx * dx + dy * dy <= RADIUS_SQ;
          if (withinBurst) {
            burst.n++;
            burst.lastTs = ts;
          } else {
            closeBurst(ts); // emit the previous burst if it qualified
            burst = { x, y, sel: target.sel, n: 1, lastTs: ts, qualified: false };
          }
        } else {
          burst = { x, y, sel: target.sel, n: 1, lastTs: ts, qualified: false };
        }
        if (burst.n >= config.RAGE_MIN_CLICKS) burst.qualified = true;
        burstForThisClick = burst;
      }

      // --- Dead ---
      const deadEligible =
        !target.interactive &&
        !target.isBodyOrHtml &&
        !target.ignored &&
        !target.dragged;
      if (deadEligible) {
        deadCandidates.push({
          ts,
          x,
          y,
          sel: target.sel,
          cancelled: false,
          burst: burstForThisClick,
        });
      }
    },

    onReaction(ts) {
      // Cancel any dead candidate whose wait window covers this reaction,
      // BEFORE resolving matured candidates (a boundary reaction wins).
      for (const c of deadCandidates) {
        if (ts >= c.ts && ts <= c.ts + config.DEAD_WAIT_MS) c.cancelled = true;
      }
      advance(ts);
    },

    onFieldFocus({ ts, field }) {
      advance(ts);
      setFocusForm(formKey(field.formSel), ts);
      const f = forms.get(formKey(field.formSel));
      if (f) f.lastFocusedSel = field.sel;
      // Start a fresh correction engagement for this field.
      focusedField = { sel: field.sel, deletes: 0, inserts: 0, ignored: !!field.ignored };
    },

    onFieldBlur({ ts, field }) {
      advance(ts);
      // Correction evaluates on blur of the engaged field.
      if (focusedField && focusedField.sel === field.sel) {
        evaluateCorrection(focusedField, ts);
        focusedField = null;
      }
      setFocusForm(null, ts);
    },

    onFieldInput({ ts, field, kind }) {
      advance(ts);
      if (field.ignored) return; // ignored fields drive nothing

      // Form engagement bookkeeping.
      const key = formKey(field.formSel);
      let f = forms.get(key);
      if (!f) {
        f = {
          engaged: false,
          fieldsTouched: new Set(),
          fieldInputCounts: new Map(),
          firstInputTs: null,
          lastFocusedSel: currentFormSel === key && focusedField ? focusedField.sel : null,
          emitted: false,
          isSearch: !!field.isSearch,
          formFieldCount: field.formFieldCount,
          // If focus is already inside this form, it isn't "outside".
          focusOutsideSince: currentFormSel === key ? null : ts,
        };
        forms.set(key, f);
      }
      f.isSearch = !!field.isSearch;
      f.formFieldCount = field.formFieldCount;
      f.fieldsTouched.add(field.sel);
      if (f.lastFocusedSel == null) f.lastFocusedSel = field.sel;
      const count = (f.fieldInputCounts.get(field.sel) || 0) + 1;
      f.fieldInputCounts.set(field.sel, count);
      if (f.firstInputTs == null) f.firstInputTs = ts;
      if (count >= config.FORM_MIN_INPUTS) f.engaged = true;

      // Correction bookkeeping for the focused field.
      if (focusedField && focusedField.sel === field.sel) {
        if (kind === 'delete') focusedField.deletes++;
        else if (kind === 'insert') focusedField.inserts++;
      }
    },

    onSubmit({ ts, formSel }) {
      advance(ts);
      forms.delete(formKey(formSel)); // cleared: no abandonment for this form
    },

    onFormRemoved({ ts, formSel }) {
      advance(ts);
      forms.delete(formKey(formSel)); // neutral: discard, no signal
    },

    tick(ts) {
      advance(ts);
    },

    onHide(ts) {
      advance(ts);
      // Flush a still-open rage burst regardless of the settle window.
      closeBurst(ts);
      // Dead candidates whose window hasn't elapsed can't be confirmed here
      // (advance already emitted the matured ones); discard the rest.
      deadCandidates = [];
      // Correction for the still-focused field.
      evaluateCorrection(focusedField, ts);
      focusedField = null;
      // Abandon every engaged, uncleared, non-exempt form.
      for (const [key, f] of forms) abandonForm(key, f, ts);
    },
  };
}

export default createDetectors;
