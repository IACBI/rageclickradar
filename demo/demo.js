/* CloudNimbus demo site behavior for RageClickRadar.
   Implements the intentional frustration traps. Plain ES, no modules.
   Nothing here depends on /radar.js — it is loaded independently. */

(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  /* ---------- index.html ---------- */

  // TRAP 2: primary CTA that waits 2000ms with NO feedback, then navigates.
  // Extra clicks during the wait must not queue extra navigations.
  var getStarted = byId("get-started");
  if (getStarted) {
    var navPending = false;
    getStarted.addEventListener("click", function () {
      if (navPending) {
        return; // swallow rage clicks; do not queue another navigation
      }
      navPending = true;
      window.setTimeout(function () {
        window.location.href = "/demo/signup.html";
      }, 2000);
    });
  }

  // TRAP 1 (#hero-banner) and TRAP 3 (#learn-more-text) are intentionally
  // inert: no listeners at all, so clicks register as dead clicks.

  /* ---------- pricing.html ---------- */

  // TRAP 5: button that looks disabled but toggles the comparison table.
  var comparePlans = byId("compare-plans");
  var comparisonTable = byId("comparison-table");
  if (comparePlans && comparisonTable) {
    comparePlans.addEventListener("click", function () {
      var isHidden = comparisonTable.hasAttribute("hidden");
      if (isHidden) {
        comparisonTable.removeAttribute("hidden");
        comparePlans.setAttribute("aria-expanded", "true");
      } else {
        comparisonTable.setAttribute("hidden", "");
        comparePlans.setAttribute("aria-expanded", "false");
      }
    });
  }

  // TRAP 4: .plan-card elements look selectable but do nothing on click.
  // Only #choose-pro (a real anchor) works — no JS needed for it.

  /* ---------- signup.html ---------- */

  // TRAP 6: hostile username field silently strips vowels as you type.
  var username = byId("username");
  if (username) {
    username.addEventListener("input", function () {
      var stripped = username.value.replace(/[aeiouAEIOU]/g, "");
      if (stripped !== username.value) {
        // Preserve caret roughly by clamping to new length.
        var pos = username.selectionStart;
        username.value = stripped;
        var clamped = Math.min(pos, stripped.length);
        try {
          username.setSelectionRange(clamped, clamped);
        } catch (e) {
          /* some browsers disallow on certain input types; ignore */
        }
      }
    });
  }

  // TRAP 7: submit "validates" the username against a secret rule
  // ("must contain at least 2 vowels") which can never pass because vowels
  // were stripped. On failure: no message, just a subtle 150ms opacity blink.
  var form = byId("signup-form");
  var submitBtn = byId("signup-submit");
  if (form && submitBtn) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var value = username ? username.value : "";
      var vowelCount = (value.match(/[aeiouAEIOU]/g) || []).length;
      var passes = vowelCount >= 2;

      if (!passes) {
        // Subtle blink only — no error text anywhere.
        submitBtn.style.opacity = "0.55";
        window.setTimeout(function () {
          submitBtn.style.opacity = "";
        }, 150);
        return;
      }

      // Never reached in practice, but keep the happy path coherent.
      window.location.href = "/demo/signup.html?welcome=1";
    });
  }
})();
