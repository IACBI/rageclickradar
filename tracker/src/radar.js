// RageClickRadar — browser tracker entry (bundled to an IIFE by esbuild).
// Pure DOM wiring: observes events, builds sanitized descriptors, and drives
// the pure detectors. Privacy: no input values, no key identities, and no text
// content ever leave the page — only id/class/tag-based selectors and
// location.pathname. Written for minified size (hard budget in build.js):
// truthy values stand in for booleans (the detectors coerce), and handler
// errors are swallowed by the shared listener wrapper.

import { CONFIG } from '../../shared/config.js';
import { createDetectors } from './detectors.js';
import { buildSelector } from './selector.js';
import { createTransport } from './transport.js';

// Top-level try/catch (esbuild's IIFE wrapper provides the scope): if any part
// of init fails, the tracker silently disables itself.
try {
  {
    // Config is read once at load time. In the bundle, config property names
    // are build-time-renamed to their word initials (RAGE_MIN_CLICKS -> RMC,
    // see build.js mangleCache); window.RadarConfig overrides use the public
    // long names, so translate them with the same initials rule while merging.
    // (cfg.X property accesses below are renamed consistently by the build.)
    const cfg = { ...CONFIG };
    const over = window.RadarConfig || {};
    // Initials rule: keep each _-separated word's first character.
    for (const k in over) cfg[k.replace(/(.)[^_]*_?/g, '$1')] = over[k];
    const doc = document;
    const de = doc.documentElement;
    const now = () => Math.round(performance.now());
    const IGNORE = '[data-radar-ignore]';
    const DRAG_SQ = cfg.DEAD_DRAG_PX ** 2;

    // --- Session id: sessionStorage, cookie-free; in-memory fallback -------
    let sid;
    try {
      sid = sessionStorage.getItem('rcr_sid');
    } catch (e) {}
    if (!sid) {
      sid = 's_';
      crypto.getRandomValues(new Uint8Array(12)).forEach((b) => (sid += (b % 36).toString(36)));
      try {
        sessionStorage.setItem('rcr_sid', sid);
      } catch (e) {}
    }

    // --- Transport (endpoint comes from this script's own tag) --------------
    const tp = createTransport(cfg, doc.currentScript?.getAttribute('data-endpoint') || '/api/collect', {
      sid,
      page: location.pathname,
      vw: innerWidth,
      vh: innerHeight,
      getDocSize: () => ({ dw: de.scrollWidth, dh: de.scrollHeight }),
    });

    // --- Emission cap: after MAX_EVENTS_PER_PAGEVIEW signals, go silent ----
    let emitted = 0;
    let off;
    const det = createDetectors(cfg, (sig) => {
      tp.enqueue(sig);
      if (++emitted >= cfg.MAX_EVENTS_PER_PAGEVIEW) off = 1;
    });

    // --- Selector building (element -> plain descriptor -> selector) -------
    // Only ever called with elements (handlers guard via matches()), so a
    // null check alone terminates the parent recursion.
    const desc = (el, depth) => {
      if (!el) return null;
      const tag = el.tagName;
      let nth = 1;
      for (let s = el; (s = s.previousElementSibling); ) if (s.tagName == tag) nth++;
      return {
        tag: tag.toLowerCase(),
        id: el.id,
        classes: [...el.classList],
        nthOfType: nth,
        parent: depth < 4 ? desc(el.parentElement, depth + 1) : null,
      };
    };
    const selOf = (el) => buildSelector(desc(el, 0), cfg.SELECTOR_MAX_LEN);

    // --- Listener helper: capture + passive, cap-guarded, never throws -----
    // Registered on window: the capture phase starts at window, so even
    // non-bubbling document-targeted events (selectionchange) are seen, and
    // window-target events (popstate, hashchange) need no special casing.
    const on = (type, fn) =>
      addEventListener(
        type,
        (e) => {
          if (!off)
            try {
              fn(e, e.target);
            } catch (err) {}
        },
        { capture: true, passive: true },
      );

    const react = () => det.onReaction(now());

    // --- Clicks -------------------------------------------------------------
    // Interactivity / rapid-click allowance as pure CSS selectors, so one
    // matches() call per ancestor covers tags, roles, and class markers.
    const INTERACTIVE =
      'a[href],button,input,select,textarea,label,summary,[onclick],' +
      '[role=link],[role=button],[role=checkbox],[role=tab],[role=menuitem],[role=switch],[role=option]';
    const RAPID =
      'input[type=number],[data-radar-allow-rapid],[role=spinbutton],[role=slider],' +
      '[class*=stepper],[class*=carousel],[class*=qty]';
    // Undefined until the first pointerdown: a click with no prior pointer
    // (keyboard activation) then yields NaN distance => not a drag.
    let downX;
    let downY;
    on('pointerdown', (e) => {
      downX = e.pageX;
      downY = e.pageY;
    });

    // A non-element click target makes matches() throw; the wrapper drops it.
    on('click', (e, el) => {
      let interactive;
      let allowRapid;
      const x = e.pageX;
      const y = e.pageY;
      for (let n = el, i = 0; n && i <= cfg.DEAD_MAX_ANCESTORS; i++, n = n.parentElement) {
        interactive = interactive || n.matches(INTERACTIVE) || n.tabIndex >= 0;
        allowRapid = allowRapid || n.matches(RAPID);
      }
      det.onClick({
        ts: now(),
        x,
        y,
        target: {
          sel: selOf(el),
          interactive: interactive || getComputedStyle(el).cursor == 'pointer',
          allowRapid,
          isBodyOrHtml: el == doc.body || el == de,
          isCanvas: el.tagName == 'CANVAS',
          ignored: el.closest(IGNORE),
          dragged: (x - downX) ** 2 + (y - downY) ** 2 > DRAG_SQ,
        },
      });
    });

    // --- Reactions (cancel pending dead-click candidates) -------------------
    // Tracked forms (formSel -> element) for removal detection.
    const trackedForms = new Map();

    // One persistent observer doubles as DOM-reaction source and form-removal
    // watcher (detectors ignore reactions with no pending candidates).
    new MutationObserver(() => {
      if (!off)
        try {
          react();
          for (const [key, form] of trackedForms)
            if (!form.isConnected) {
              trackedForms.delete(key);
              det.onFormRemoved({ ts: now(), formSel: key });
            }
        } catch (err) {}
    }).observe(de, { childList: true, attributes: true, characterData: true, subtree: true });

    // Scroll: report once cumulative window travel exceeds the threshold,
    // then reset. A scroll event that moved no window pixels came from an
    // inner scroller — that movement itself clears the threshold (|| 6).
    let sx = scrollX;
    let sy = scrollY;
    let scrollAcc = 0;
    on('scroll', () => {
      scrollAcc += Math.abs(scrollX - sx) + Math.abs(scrollY - sy) || 6;
      sx = scrollX;
      sy = scrollY;
      if (scrollAcc > cfg.DEAD_SCROLL_PX) {
        scrollAcc = 0;
        react();
      }
    });

    // Selection: non-empty selections only; the selected text is never read.
    on('selectionchange', () => {
      if (!getSelection().isCollapsed) react();
    });

    // URL changes.
    on('popstate', react);
    on('hashchange', react);

    // --- Forms --------------------------------------------------------------
    const FIELD = 'input:not([type=hidden]),textarea,select';

    // focusin / focusout / input share one handler split on e.type.
    // A null formSel groups under '(no form)' inside the detectors. Only
    // e.inputType is classified; e.data and el.value are never touched. The
    // detectors ignore the kind on focus/blur, so it is passed uniformly.
    const fieldEvent = (e, el) => {
      if (!el.matches(FIELD)) return;
      const form = el.form;
      const field = {
        sel: selOf(el),
        formSel: form && selOf(form),
        isSearch: el.type == 'search' || form?.matches('[role=search]'),
        formFieldCount: form ? [...form.elements].filter((f) => f.matches(FIELD)).length : 1,
        ignored: el.closest(IGNORE),
      };
      const y = e.type;
      const kind = (e.inputType || '').slice(0, 6);
      (y == 'input'
        ? det.onFieldInput
        : y == 'focusin'
          ? (form && trackedForms.set(field.formSel, form), det.onFieldFocus)
          : det.onFieldBlur)({
        ts: now(),
        field,
        kind: kind == 'insert' || kind == 'delete' ? kind : 'other',
      });
    };
    on('focusin', fieldEvent);
    on('focusout', fieldEvent);
    on('input', fieldEvent);

    // Capture phase so preventDefault'd submits still count as cleared.
    on('submit', (e, form) => {
      const formSel = selOf(form);
      trackedForms.delete(formSel);
      det.onSubmit({ ts: now(), formSel });
    });

    // --- Page hide: finalize detectors and force-flush the transport --------
    // Registered directly (not via `on`): the final flush must still run after
    // the emission cap disables the regular handlers.
    // visibilitychange bubbles from document to window, so both hooks can
    // share one window-level registration loop.
    const hide = (e) => {
      if (e.type == 'pagehide' || doc.visibilityState == 'hidden') {
        try {
          if (!off) det.onHide(now());
        } catch (err) {}
        tp.flush();
      }
    };
    for (const y of ['pagehide', 'visibilitychange']) addEventListener(y, hide);

    // --- Time driver (transport runs its own flush interval) ----------------
    setInterval(() => {
      if (!off) det.tick(now());
    }, 1000);
  }
} catch (err) {
  // Tracker must never surface errors to the host page: silently disable.
}
