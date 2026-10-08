/**
 * How documentation captures are compared (tests/card-docs.cjs).
 *
 * Two captures "match" when they have the same size, no pixel differs by
 * more than CHANNEL_TOLERANCE in any channel, and at most NOISE_FRACTION of
 * the pixels differ at all. Do NOT go back to an exact byte comparison:
 * Chromium's software rasterizer is not bit-exact between processes for
 * anti-aliased edges at fractional sizes (cqw previews, rounded borders,
 * scaled glyphs). That noise moved a few edge pixels by 1-8 levels and failed
 * CI on a different random image almost every run (e.g.
 * lamp-preview-editor-preview_appearance: 25 of 150k pixels, max delta 8).
 *
 * Real non-determinism -- an animation caught at another phase, a missing
 * icon, an unloaded font, a layout shift -- changes pixels by far more than
 * the tolerance, or a subtle change (a colour tweak, a fade) touches far more
 * pixels than edge noise, so it still fails. If a capture fails with only
 * small deltas, do not raise the limits blindly: look at the diagnostics diff
 * first.
 */
const CHANNEL_TOLERANCE = 24;
const NOISE_FRACTION = 0.005;

/** Pixels of two same-size images whose RGBA channels differ by more than
 * `tolerance`: their count, the largest channel delta and their bounding box. */
function differences(a, b, tolerance = CHANNEL_TOLERANCE) {
  let count = 0;
  let maxDelta = 0;
  let [left, top, right, bottom] = [a.width, a.height, -1, -1];
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const offset = (y * a.width + x) * 4;
      let delta = 0;
      for (let c = 0; c < 4; c++)
        delta = Math.max(
          delta,
          Math.abs(a.data[offset + c] - b.data[offset + c]),
        );
      maxDelta = Math.max(maxDelta, delta);
      if (delta <= tolerance) continue;
      count++;
      [left, top] = [Math.min(left, x), Math.min(top, y)];
      [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
    }
  return {
    count,
    maxDelta,
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

const sameSize = (a, b) => a.width === b.width && a.height === b.height;

/** Whether two decoded PNGs show the same thing (rendering noise aside). */
function imagesMatch(a, b) {
  return (
    sameSize(a, b) &&
    differences(a, b).count === 0 &&
    differences(a, b, 0).count <= a.width * a.height * NOISE_FRACTION
  );
}

/** The first capture matching another one, or null. */
function matchingCapture(captures) {
  for (let i = 0; i < captures.length; i++)
    for (let j = i + 1; j < captures.length; j++)
      if (imagesMatch(captures[i].png, captures[j].png)) return captures[i];
  return null;
}

/** How two captures differ, for the log. */
function describeDifference(a, b) {
  if (!sameSize(a, b))
    return `size ${a.width}x${a.height} vs ${b.width}x${b.height}`;
  const any = differences(a, b, 0);
  const real = differences(a, b);
  const where = (d) => `${d.width}x${d.height} at ${d.left},${d.top}`;
  return (
    `${real.count} pixels differ by more than ${CHANNEL_TOLERANCE}` +
    (real.count ? ` (in ${where(real)})` : "") +
    `; ${any.count} differ at all, max channel delta ${any.maxDelta}` +
    (any.count ? ` (in ${where(any)})` : "")
  );
}

module.exports = {
  CHANNEL_TOLERANCE,
  NOISE_FRACTION,
  differences,
  imagesMatch,
  matchingCapture,
  describeDifference,
};
