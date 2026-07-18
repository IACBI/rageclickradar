// RageClickRadar — CSS selector builder.
//
// Pure function: turns a plain element descriptor (produced by the DOM runtime,
// never a live node) into a short, stable CSS selector. It never emits any
// attribute value other than id/class, so no user text can leak through a
// selector string. Written compactly: this file ships inside the size-budgeted
// browser bundle; the public API is pinned by test/unit/selector.test.js.

// A token is "CSS-safe" when it is a plain identifier we can drop into a
// selector without escaping. Anything else (leading digit, spaces, colons,
// bracket notation, emoji, ...) is treated as unusable and skipped.
const SAFE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// Build the selector segment for a single element descriptor.
// Priority: #id -> tag.class1.class2 -> tag:nth-of-type(n).
// Returns [segment, kind] with kind: 2 = id, 1 = class, 0 = nth fallback.
const seg = (d) => {
  if (d.id && SAFE.test(d.id)) return ['#' + d.id, 2];
  const c = (d.classes || []).filter((x) => SAFE.test(x)).slice(0, 2);
  return c.length
    ? [d.tag + '.' + c.join('.'), 1]
    : [d.tag + ':nth-of-type(' + d.nthOfType + ')', 0];
};

// buildSelector(desc, maxLen=120) -> string
// `desc` = { tag, id, classes, nthOfType, parent } where `parent` is another
// desc or null. An #id or a class match on the target is specific enough on
// its own; only the nth-of-type fallback climbs ancestors (up to 4 levels
// total, joined with '>'), stopping early at the first ancestor id. The hard
// length cap truncates from the LEFT (a leading "…" marks it) so the most
// specific right-most part survives; the ellipsis counts toward the budget.
export function buildSelector(desc, maxLen = 120) {
  const t = seg(desc);
  let out = t[0];
  if (!t[1]) {
    let cur = desc.parent;
    for (let lv = 1; cur && lv < 4; lv++, cur = cur.parent) {
      const a = seg(cur);
      out = a[0] + '>' + out;
      if (a[1] > 1) break; // an id uniquely anchors the path
    }
  }
  return out.length <= maxLen ? out : '…' + out.slice(out.length - maxLen + 1);
}

export default buildSelector;
