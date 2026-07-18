// RageClickRadar — CSS selector builder.
//
// Pure function: turns a plain element descriptor (produced by the DOM runtime,
// never a live node) into a short, stable CSS selector. It never emits any
// attribute value other than id/class, so no user text can leak through a
// selector string.

// A token is "CSS-safe" when it is a plain identifier we can drop into a
// selector without escaping. Anything else (leading digit, spaces, colons,
// bracket notation, emoji, ...) is treated as unusable and skipped.
const SAFE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// Build the selector segment for a single element descriptor.
// Priority: #id -> tag.class1.class2 -> tag:nth-of-type(n).
// Returns { s, kind } where kind is one of 'id' | 'class' | 'nth'.
function segmentFor(desc) {
  if (desc.id && SAFE.test(desc.id)) {
    return { s: `#${desc.id}`, kind: 'id' };
  }
  const classes = Array.isArray(desc.classes) ? desc.classes : [];
  const safeClasses = classes.filter((c) => SAFE.test(c)).slice(0, 2);
  if (safeClasses.length > 0) {
    return { s: `${desc.tag}.${safeClasses.join('.')}`, kind: 'class' };
  }
  return { s: `${desc.tag}:nth-of-type(${desc.nthOfType})`, kind: 'nth' };
}

// Enforce the hard character cap. Truncation drops characters from the LEFT so
// the most specific (right-most) part of the selector survives; a leading "…"
// marks that truncation happened. The returned string is never longer than
// maxLen (the ellipsis counts toward the budget).
function capLength(selector, maxLen) {
  if (selector.length <= maxLen) return selector;
  const tail = selector.slice(selector.length - (maxLen - 1));
  return `…${tail}`;
}

// buildSelector(desc, maxLen=120) -> string
// `desc` = { tag, id, classes, nthOfType, parent } where `parent` is another
// desc or null. An #id or a class match on the target is specific enough on its
// own; only the nth-of-type fallback climbs ancestors (up to 4 levels total,
// joined with '>'), stopping early at the first ancestor that resolves to an id.
export function buildSelector(desc, maxLen = 120) {
  const target = segmentFor(desc);

  let out;
  if (target.kind === 'id' || target.kind === 'class') {
    out = target.s;
  } else {
    const segments = [target.s];
    let current = desc.parent;
    let levels = 1; // the target already counts as one level
    while (current && levels < 4) {
      const ancestor = segmentFor(current);
      segments.unshift(ancestor.s);
      levels++;
      if (ancestor.kind === 'id') break; // an id uniquely anchors the path
      current = current.parent;
    }
    out = segments.join('>');
  }

  return capLength(out, maxLen);
}

export default buildSelector;
