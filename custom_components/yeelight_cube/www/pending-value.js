/**
 * A value a card shows before the lamp confirms it (a picked mode, a switch,
 * a dragged slider): without it the card shows the lamp's last state until
 * the echo arrives, and the control jumps back.
 *
 *   const pending = createPendingValue({ onExpire: () => render() });
 *   pending.set(value);            // shown now; dropped after timeoutMs
 *   pending.value ?? lampValue     // what the control shows
 *   pending.settle(lampValue);     // each lamp update: dropped once it matches
 *
 * - set(value): the value just sent; expires after `timeoutMs` (onExpire)
 *   if the lamp never confirms it
 * - hold(value): shown without expiring yet (a drag in progress, a command
 *   not sent yet); a later set() starts the timeout
 * - settle(actual): drops the value once `matches(actual, value)` or once it
 *   is overdue; never while `isHeld()`. With `yieldToLamp`, also once the
 *   lamp reports a new value after it was sent (another dashboard, a
 *   rotation step): an unchanged, older value never takes it back. Returns
 *   whether it was dropped.
 * - clear(): drops it at once (a failed command, the card disconnected)
 *
 * The slider draft (slider-control-utils.js createSliderDraft) is one, with a
 * tolerance and held while dragging.
 */
export function createPendingValue({
  matches = Object.is,
  timeoutMs = 5000,
  onExpire,
  isHeld = () => false,
  yieldToLamp = false,
} = {}) {
  let value = null;
  let at = 0;
  let timer = null;
  let sent = false;
  // The lamp's value at the last settle (undefined: none seen yet).
  let lamp;
  const clear = () => {
    value = null;
    sent = false;
    clearTimeout(timer);
    timer = null;
  };
  const expire = () => {
    timer = null;
    if (isHeld()) {
      timer = setTimeout(expire, timeoutMs);
      return;
    }
    if (value == null) return;
    value = null;
    onExpire?.();
  };
  return {
    /** The value shown, or null when none waits. */
    get value() {
      return value;
    },
    hold(next) {
      value = next;
      at = Date.now();
      sent = false;
    },
    set(next) {
      value = next;
      at = Date.now();
      sent = true;
      clearTimeout(timer);
      timer = setTimeout(expire, timeoutMs);
    },
    settle(actual) {
      const moved = lamp !== undefined && !Object.is(actual, lamp);
      lamp = actual;
      if (value == null || isHeld()) return false;
      if (
        matches(actual, value) ||
        Date.now() - at > timeoutMs ||
        (yieldToLamp && sent && moved)
      ) {
        clear();
        return true;
      }
      return false;
    },
    clear,
  };
}

/**
 * One pending value per key (each a createPendingValue with `options`): a
 * card's several controls of one lamp command, e.g. the Lamp Preview's
 * adjustments. `onExpire(key)` when one expires.
 */
export function createPendingMap({ onExpire, ...options } = {}) {
  const values = new Map();
  const entry = (key) => {
    let pending = values.get(key);
    if (!pending) {
      pending = createPendingValue({ ...options, onExpire: () => onExpire?.(key) });
      values.set(key, pending);
    }
    return pending;
  };
  return {
    /** The key's value shown, or null when none waits. */
    value: (key) => values.get(key)?.value ?? null,
    /** The keys with a value waiting. */
    keys: () => [...values.keys()].filter((key) => values.get(key).value != null),
    get size() {
      return [...values.values()].filter((pending) => pending.value != null).length;
    },
    hold: (key, next) => entry(key).hold(next),
    set: (key, next) => entry(key).set(next),
    settle: (key, actual) => values.get(key)?.settle(actual) ?? false,
    /** Drop the key's value, or every value (no key). */
    clear(key) {
      if (key !== undefined) return values.get(key)?.clear();
      for (const pending of values.values()) pending.clear();
      values.clear();
    },
  };
}
