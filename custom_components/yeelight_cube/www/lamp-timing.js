// The lamp's render clock, for the previews' timing: a module of its own (no
// imports) so a card that only times its previews does not load the
// renderers (lamp-core.js re-exports it).

// The lamp renders every 40 ms (25 renders a second).
export const RENDER_SECONDS = 0.04;
export const RENDER_MS = 40;
