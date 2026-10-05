// Logic with no Obsidian or Electron dependency, so it can run under `node --test`.

const MODIFIERS = {
  cmd: 'Command', command: 'Command', meta: 'Command',
  ctrl: 'Control', control: 'Control',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift',
};
const MODIFIER_ORDER = ['Command', 'Control', 'Alt', 'Shift'];
const NAMED_KEYS = {
  space: 'Space', tab: 'Tab', enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape',
  backspace: 'Backspace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

// Returns an Electron accelerator such as "Command+Shift+2", or null if the
// input is not one key plus at least Command or Control.
function normalizeAccelerator(input) {
  if (typeof input !== 'string') return null;
  const parts = input.split('+').map((p) => p.trim());
  if (parts.some((p) => p === '')) return null;
  const mods = new Set();
  let key = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS[lower]) {
      if (mods.has(MODIFIERS[lower])) return null;
      mods.add(MODIFIERS[lower]);
      continue;
    }
    if (key !== null) return null;
    if (/^[a-z0-9]$/.test(lower)) key = lower.toUpperCase();
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) key = lower.toUpperCase();
    else if (NAMED_KEYS[lower]) key = NAMED_KEYS[lower];
    else return null;
  }
  if (key === null) return null;
  if (!mods.has('Command') && !mods.has('Control')) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+');
}

// What a hotkey press does, given what was found. See SCOPE.md "Overlay state".
function nextAction(state) {
  if (!state.found) return 'create';
  if (!state.visible) return 'show';
  if (!state.focused) return 'focus';
  return 'hide';
}

const MARGIN = 24;

// Bounds to give the window: the saved ones if they still land on a display,
// shrunk to fit it; otherwise the default size at the top right of the first display.
function fitBounds(saved, areas, size) {
  if (!areas || areas.length === 0) return { x: 0, y: 0, width: size.width, height: size.height };
  const ok = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k]));
  const area = ok && areas.find((a) =>
    saved.x < a.x + a.width && saved.x + saved.width > a.x &&
    saved.y < a.y + a.height && saved.y + saved.height > a.y);
  if (!area) {
    const first = areas[0];
    return {
      x: first.x + first.width - size.width - MARGIN,
      y: first.y + MARGIN,
      width: size.width,
      height: size.height,
    };
  }
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  return {
    x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

// The same window carried from one display's work area to another, keeping its
// offset from the top-left corner where it fits.
function moveToArea(bounds, from, to) {
  const width = Math.min(bounds.width, to.width);
  const height = Math.min(bounds.height, to.height);
  return {
    x: to.x + Math.min(Math.max(bounds.x - from.x, 0), to.width - width),
    y: to.y + Math.min(Math.max(bounds.y - from.y, 0), to.height - height),
    width,
    height,
  };
}

module.exports = { normalizeAccelerator, nextAction, fitBounds, moveToArea };
