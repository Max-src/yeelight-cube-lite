const activePickers = new WeakMap();
const pickerTriggers = new WeakMap();

export const colorPickerStyleChoices = [
  { value: "swatch", label: "Swatch" },
  { value: "chip", label: "Hex chip" },
  { value: "row", label: "Colour row" },
];

export function resolveColorPickerStyle(style) {
  return colorPickerStyleChoices.some((choice) => choice.value === style)
    ? style
    : "swatch";
}

export function renderColorPicker(value, style = "swatch") {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const ink =
    (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#111" : "#fff";
  return `<label class="shared-color-picker picker-style-${resolveColorPickerStyle(style)}" style="--picker-color:${hex};--picker-ink:${ink};" title="Choose colour">
    <input type="color" class="color-picker" value="${hex}" aria-label="Choose colour" />
    <span class="picker-swatch" aria-hidden="true"></span>
    <span class="picker-value" aria-hidden="true">${hex.toUpperCase()}</span>
  </label>`;
}

export const colorPickerStyles = `
  .shared-color-picker {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    box-sizing: border-box;
    height: 38px;
    flex: 0 0 auto;
    cursor: pointer;
    border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #222);
    overflow: hidden;
  }
  .shared-color-picker:focus-within {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  .shared-color-picker .color-picker {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }
  .picker-swatch {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    border-radius: 4px;
    background: var(--picker-color);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15);
  }
  .picker-value { font: 600 13px monospace; letter-spacing: 0; }
  .picker-style-swatch {
    width: 38px;
    border-radius: 50%;
    background: var(--picker-color);
  }
  .picker-style-swatch .picker-swatch,
  .picker-style-swatch .picker-value { display: none; }
  .picker-style-chip { padding: 0 12px; border-radius: 6px; }
  .picker-style-row {
    width: 100%;
    justify-content: space-between;
    padding: 0 12px;
    border-radius: 6px;
    background: var(--picker-color);
    color: var(--picker-ink);
  }
  .picker-style-row .picker-swatch {
    border-radius: 50%;
    border: 2px solid currentColor;
    box-sizing: border-box;
    box-shadow: none;
  }
`;

export function bindColorPickerTrigger(target, handler) {
  // Cards can rebind handlers without replacing their DOM.
  pickerTriggers.get(target)?.();
  let start = null;
  let dragged = false;
  const listeners = {
    pointerdown: (event) => {
      start = { x: event.clientX, y: event.clientY };
      dragged = false;
    },
    pointermove: (event) => {
      if (
        start &&
        (Math.abs(event.clientX - start.x) > 5 ||
          Math.abs(event.clientY - start.y) > 5)
      ) {
        dragged = true;
      }
    },
    dragstart: () => {
      dragged = true;
    },
    click: (event) => {
      if (dragged && event.detail) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        handler(event);
      }
      start = null;
      dragged = false;
    },
  };
  for (const [type, listener] of Object.entries(listeners)) {
    target.addEventListener(type, listener);
  }
  pickerTriggers.set(target, () => {
    for (const [type, listener] of Object.entries(listeners)) {
      target.removeEventListener(type, listener);
    }
  });
}

export function closeColorPicker(owner) {
  activePickers.get(owner)?.();
}

export function openColorPicker(
  owner,
  { value = "#ffffff", pageX = 0, pageY = 0, onInput, onChange, onClose } = {},
) {
  closeColorPicker(owner);
  if (!owner.isConnected) return;

  const doc = owner.ownerDocument;
  const view = doc.defaultView;
  const input = doc.createElement("input");
  input.type = "color";
  input.value = value;
  input.tabIndex = -1;
  input.setAttribute("aria-label", "Choose colour");
  input.style.cssText = `position:fixed;inset:auto;left:${pageX - view.scrollX}px;top:${pageY - view.scrollY}px;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0;pointer-events:none;`;

  let notified = false;
  const notifyClose = () => {
    if (notified) return;
    notified = true;
    onClose?.();
  };
  const dispose = () => {
    observer.disconnect();
    doc.removeEventListener("pointerdown", dismiss, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    view.removeEventListener("focus", notifyClose);
    input.remove();
    activePickers.delete(owner);
    notifyClose();
  };
  const dismiss = (event) => {
    if (!event.composedPath().includes(input)) dispose();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") dispose();
  };
  const observer = new view.MutationObserver(() => {
    if (!owner.isConnected) dispose();
  });
  let root = owner.getRootNode();
  while (root) {
    observer.observe(root, { childList: true, subtree: true });
    root = root.host?.getRootNode();
  }

  input.addEventListener("input", () => onInput?.(input.value));
  input.addEventListener("change", () => {
    try {
      onChange?.(input.value);
    } finally {
      // Native change/blur events do not reliably mean the picker has closed.
      notifyClose();
    }
  });
  input.addEventListener("cancel", dispose);
  doc.addEventListener("pointerdown", dismiss, true);
  doc.addEventListener("keydown", onKeyDown, true);
  view.addEventListener("focus", notifyClose);
  activePickers.set(owner, dispose);

  // Unslotted siblings have no layout box, so mount directly in the rendered root.
  const pickerRoot = owner.getRootNode();
  const mount = pickerRoot.host ? pickerRoot : doc.body;
  mount.appendChild(input);
  try {
    // The top layer keeps viewport coordinates independent of dialog transforms.
    if (typeof input.showPopover === "function") {
      input.popover = "manual";
      input.showPopover();
    }
    input.getBoundingClientRect();
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
  } catch (error) {
    dispose();
    throw error;
  }
}

export function bindColorPicker(input, owner, callbacks = {}) {
  bindColorPickerTrigger(input, (event) =>
    handleColorPickerClick(event, owner, callbacks),
  );
}

export function handleColorPickerClick(event, owner, callbacks = {}) {
  event.preventDefault();
  event.stopPropagation();
  const input = event.currentTarget;
  owner ??= input.getRootNode().host;
  const bounds = input.getBoundingClientRect();
  const view = owner.ownerDocument.defaultView;
  const update = (type, value, callback) => {
    input.value = value;
    if (callback) callback(value);
    else
      input.dispatchEvent(
        new view.Event(type, { bubbles: true, composed: true }),
      );
  };
  openColorPicker(owner, {
    ...callbacks,
    value: input.value,
    pageX: event.detail ? event.pageX : bounds.left + view.scrollX,
    pageY: event.detail ? event.pageY : bounds.bottom + view.scrollY,
    onInput: (value) => update("input", value, callbacks.onInput),
    onChange: (value) => update("change", value, callbacks.onChange),
  });
}
