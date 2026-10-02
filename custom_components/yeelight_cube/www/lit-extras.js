// templateToString(): serialises a Lit template to an escaped HTML string, for
// the gradient card's string-returning compatibility API. It reads Lit's
// template-result fields (_$litType$, _$litDirective$) to do so.
import { nothing } from "./lib/lit-all.js";

export const _escapeMarkup = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Serialise a Lit template (as produced by this card: text/attribute
 * bindings, boolean `?attr` bindings, nested templates/arrays and
 * unsafeHTML/unsafeSVG directives) to an escaped HTML string.  Only used by
 * the string-returning `_renderAngleRotary()` compatibility API — the card
 * itself renders the templates through Lit.
 */
export function templateToString(value) {
  if (value == null || value === false || value === nothing) return "";
  if (Array.isArray(value)) return value.map(templateToString).join("");
  if (typeof value === "object" && value._$litDirective$) {
    const raw = value.values?.[0];
    return raw == null || raw === nothing ? "" : String(raw);
  }
  if (typeof value === "object" && value._$litType$ !== undefined) {
    const { strings, values } = value;
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
      let next = strings[i + 1];
      const bound = /\s([?@.])([\w:-]+)=(["']?)$/.exec(out);
      const attr = /\s[\w:-]+=(["']?)[^"'<>]*$/.test(out) && !/>[^<]*$/.test(out);
      if (bound) {
        out = out.slice(0, bound.index);
        if (bound[3] && next.startsWith(bound[3])) next = next.slice(1);
        if (bound[1] === "?" && values[i] && values[i] !== nothing)
          out += ` ${bound[2]}`;
      } else if (attr) {
        const v = values[i];
        if (v === nothing) {
          // Attribute removed: drop `name=` (and a surrounding quote pair).
          const m = /\s([\w:-]+)=(["']?)$/.exec(out);
          if (m) {
            out = out.slice(0, m.index);
            if (m[2] && next.startsWith(m[2])) next = next.slice(1);
          }
        } else if (/\s[\w:-]+=$/.test(out)) {
          // Unquoted binding (`attr=${v}`): quote the serialised value.
          out += `"${_escapeMarkup(v ?? "")}"`;
        } else {
          out += _escapeMarkup(v ?? "");
        }
      } else {
        const v = values[i];
        out +=
          typeof v === "object" && v !== null
            ? templateToString(v)
            : v == null || v === nothing
              ? ""
              : _escapeMarkup(v);
      }
      out += next;
    }
    return out;
  }
  return _escapeMarkup(value);
}
