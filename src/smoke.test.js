// Loads the built main.js against stand-ins for Obsidian and Electron, to catch
// load-time and wiring mistakes. It proves nothing about real Obsidian behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

test('main.js loads, registers the hotkey after layout, and unregisters on unload', async () => {
  const calls = [];
  const shortcuts = {
    held: new Map(),
    isRegistered: (a) => shortcuts.held.has(a),
    register: (a, fn) => { calls.push(['register', a]); shortcuts.held.set(a, fn); return true; },
    unregister: (a) => { calls.push(['unregister', a]); shortcuts.held.delete(a); },
  };
  class Plugin {
    constructor(app) { this.app = app; }
    loadData() { return Promise.resolve(null); }
    saveData() { return Promise.resolve(); }
    addSettingTab() {} addCommand(c) { this.command = c; } registerEvent() {} registerDomEvent() {}
  }
  const obsidian = { Plugin, PluginSettingTab: class {}, Setting: class {}, Notice: class {},
    MarkdownView: class {}, WorkspaceWindow: class {}, TFile: class {} };
  const realLoad = Module._load;
  Module._load = (request, ...rest) => (request === 'obsidian' ? obsidian : realLoad(request, ...rest));
  globalThis.window = { electron: { remote: { globalShortcut: shortcuts } }, setTimeout, clearTimeout };
  let ready;
  const app = { workspace: { on: () => ({}), onLayoutReady: (fn) => { ready = fn; }, iterateAllLeaves: () => {},
    getLeavesOfType: () => [] }, vault: { getAbstractFileByPath: () => null } };
  try {
    const PluginClass = require(path.join(__dirname, '..', 'main.js'));
    const plugin = new PluginClass(app);
    await plugin.onload();
    assert.deepEqual(calls, [], 'no hotkey before the layout is ready');
    ready();
    assert.deepEqual(calls, [['register', 'Command+Shift+2']]);
    assert.equal(await plugin.changeHotkey('Shift+2'), false);
    assert.ok(shortcuts.held.has('Command+Shift+2'), 'a rejected chord keeps the old one');
    assert.equal(await plugin.changeHotkey('cmd+shift+3'), true);
    assert.deepEqual([...shortcuts.held.keys()], ['Command+Shift+3']);
    await plugin.toggle(); // no note in the stub vault: must not throw
    plugin.onunload();
    assert.equal(shortcuts.held.size, 0);
  } finally {
    Module._load = realLoad;
    delete globalThis.window;
  }
});
