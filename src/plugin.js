// Capture Overlay: one note, one global hotkey, one always-on-top panel.
// `pure` is supplied by tools/build.mjs, which joins src/pure.js and this file into main.js.

const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, WorkspaceWindow, TFile } = require('obsidian');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = { notePath: 'Capture.md', hotkey: 'Command+Shift+2', bounds: null };
const DEFAULT_SIZE = { width: 420, height: 520 };
const BODY_CLASS = 'capture-overlay';
const SAVE_DELAY_MS = 500;

// ---- undocumented: Electron's remote module, attached by Obsidian to every window ----

function electronRemote() {
  const electron = window.electron || require('electron');
  return (electron && electron.remote) || require('@electron/remote');
}

// ---- measurement: off unless debug.json sits beside main.js (see tools/latency.mjs) ----

// True if `promise` settles within a second.
function settles(promise) {
  return Promise.race([promise.then(() => true), new Promise((resolve) => window.setTimeout(resolve, 1000, false))]);
}

// Resolves when the window next draws a frame, or after 100 ms without one.
function nextFrame(win) {
  return new Promise((resolve) => {
    win.requestAnimationFrame(resolve);
    win.setTimeout(resolve, 100);
  });
}

function whenFocused(win) {
  return new Promise((resolve) => {
    if (win.document.hasFocus()) resolve();
    else win.addEventListener('focus', resolve, { once: true });
  });
}

class CaptureOverlayPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.queue = Promise.resolve(); // presses run one after another, none dropped
    this.painted = Promise.resolve(); // the first frame after the latest show
    this.saveTimer = 0;
    this.registeredHotkey = null;
    this.hotkeyStatus = 'Not registered yet.';

    this.addSettingTab(new CaptureOverlaySettingTab(this.app, this));
    this.addCommand({ id: 'toggle', name: 'Toggle capture overlay', callback: () => this.toggle() });

    this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
      if (!info || !info.file || info.file.path !== this.settings.notePath) return;
      if (this.saveTimer) return; // not reset by further typing, so typing saves twice a second
      this.saveTimer = window.setTimeout(() => { this.saveTimer = 0; this.flush(); }, SAVE_DELAY_MS);
    }));
    this.registerEvent(this.app.workspace.on('quit', (tasks) => tasks.add(() => this.flush())));
    // Cmd-R reloads the page without calling onunload.
    this.registerDomEvent(window, 'beforeunload', () => this.unregisterHotkey());

    this.filterMenuUpdates();
    this.app.workspace.onLayoutReady(() => {
      this.replaceRestored();
      this.registerHotkey(this.settings.hotkey);
    });
  }

  onunload() {
    if (this.restoreSend) this.restoreSend();
    this.unregisterHotkey();
    window.clearTimeout(this.saveTimer);
    for (const leaf of this.findLeaves()) leaf.detach(); // Obsidian saves on leaf close
  }

  // undocumented: on every change of active note Obsidian sends the main process
  // a new file for the macOS Share menu, and building that menu blocks the main
  // process for as long as Spotlight takes to answer (2 s when measured, with
  // Spotlight broken on this Mac). This drops that update, so the Share menu
  // in this vault's windows keeps whatever file it last had.
  filterMenuUpdates() {
    const ipcRenderer = (window.electron || require('electron')).ipcRenderer;
    if (!ipcRenderer) return;
    const send = ipcRenderer.send;
    ipcRenderer.send = (channel, items, ...rest) => {
      if (channel === 'update-menu-items' && Array.isArray(items)) {
        items = items.filter((item) => item.itemId !== 'share-menu');
        if (items.length === 0) return;
      }
      send.call(ipcRenderer, channel, items, ...rest);
    };
    this.restoreSend = () => { ipcRenderer.send = send; };
  }

  // ---- hotkey ----

  registerHotkey(accelerator) {
    try {
      const shortcuts = electronRemote().globalShortcut;
      // Anything already holding it is this plugin's dead renderer or another vault window.
      if (shortcuts.isRegistered(accelerator)) shortcuts.unregister(accelerator);
      if (!shortcuts.register(accelerator, () => this.toggle())) {
        this.hotkeyStatus = `Could not register ${accelerator}; another app may hold it.`;
        new Notice(`Capture Overlay: ${this.hotkeyStatus}`);
        return false;
      }
      this.registeredHotkey = accelerator;
      this.hotkeyStatus = `Registered ${accelerator}; press it to confirm.`;
      return true;
    } catch (error) {
      this.hotkeyStatus = `Global hotkeys are unavailable: ${error.message}`;
      new Notice(`Capture Overlay: ${this.hotkeyStatus}`);
      return false;
    }
  }

  unregisterHotkey() {
    if (!this.registeredHotkey) return;
    try { electronRemote().globalShortcut.unregister(this.registeredHotkey); } catch (error) { /* bridge gone */ }
    this.registeredHotkey = null;
  }

  async changeHotkey(input) {
    const accelerator = pure.normalizeAccelerator(input);
    if (!accelerator) {
      this.hotkeyStatus = `"${input}" is not a usable hotkey. Use one key with Command or Control, for example Command+Shift+2.`;
      return false;
    }
    const previous = this.registeredHotkey;
    this.unregisterHotkey();
    if (!this.registerHotkey(accelerator)) {
      const failure = this.hotkeyStatus;
      if (previous) this.registerHotkey(previous);
      this.hotkeyStatus = `${failure} Kept ${previous || 'no hotkey'}.`;
      return false;
    }
    this.settings.hotkey = accelerator;
    await this.saveData(this.settings);
    return true;
  }

  // ---- overlay window ----

  findLeaves() {
    const leaves = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const state = leaf.getViewState();
      const file = state && state.state && state.state.file;
      if (file === this.settings.notePath && leaf.getContainer() instanceof WorkspaceWindow) leaves.push(leaf);
    });
    return leaves;
  }

  // undocumented: the BrowserWindow behind a popout
  electronWindowOf(leaf) {
    const container = leaf.getContainer();
    return (container && container.win && container.win.electronWindow) || null;
  }

  async waitForElectronWindow(leaf) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const electronWindow = this.electronWindowOf(leaf);
      if (electronWindow) return electronWindow;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return null;
  }

  prepare(leaf, electronWindow) {
    const doc = leaf.getContainer().doc;
    const areas = electronRemote().screen.getAllDisplays().map((display) => display.workArea);
    electronWindow.setBounds(pure.fitBounds(this.settings.bounds, areas, DEFAULT_SIZE));
    this.pinAboveEverything(electronWindow);
    if (doc.body.classList.contains(BODY_CLASS)) return;
    doc.body.classList.add(BODY_CLASS);
    this.registerDomEvent(doc, 'keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (doc.querySelector('.suggestion-container, .menu, .modal-container')) return;
      event.preventDefault();
      this.toggle();
    });
  }

  // Re-applied on every show: not yet checked whether a hidden window keeps these.
  pinAboveEverything(electronWindow) {
    electronWindow.setAlwaysOnTop(true, 'floating');
    electronWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }

  // Bring the window to the display the pointer is on.
  moveToActiveDisplay(electronWindow) {
    const screen = electronRemote().screen;
    const bounds = electronWindow.getBounds();
    const from = screen.getDisplayMatching(bounds).workArea;
    const to = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    if (from.x === to.x && from.y === to.y) return;
    electronWindow.setBounds(pure.moveToArea(bounds, from, to));
  }

  // An overlay restored with the workspace is an ordinary window, not a panel,
  // so it is closed and a hidden panel is made ready for the first press.
  replaceRestored() {
    this.queue = this.queue.then(async () => {
      for (const leaf of this.findLeaves()) leaf.detach();
      await this.create(false);
    }).catch((error) => this.report(error));
  }

  async create(show) {
    const file = this.app.vault.getAbstractFileByPath(this.settings.notePath);
    if (!(file instanceof TFile)) {
      new Notice(`Capture Overlay: no note at "${this.settings.notePath}". Create it or change the path in settings.`);
      return;
    }
    const leaf = this.openPanel();
    const electronWindow = await this.waitForElectronWindow(leaf);
    if (!electronWindow) {
      new Notice('Capture Overlay: could not reach the popout window.');
      return;
    }
    electronWindow.setOpacity(0);
    await leaf.openFile(file, { active: show, state: { mode: 'source', source: false } }); // Live Preview
    this.prepare(leaf, electronWindow);
    leaf.setPinned(true);
    if (!show) electronWindow.hide();
    electronWindow.setOpacity(1);
    if (!show) return;
    electronWindow.show();
    this.focusEditor(leaf);
  }

  // undocumented: Obsidian opens a popout with window.open, and Electron turns
  // the features it does not know into window options. `type=panel` makes the
  // popout a macOS panel: it takes the keyboard without activating Obsidian, so
  // the app in front stays in front, and it can sit over another app's full
  // screen. The type cannot be changed after the window exists.
  openPanel() {
    const open = window.open;
    window.open = (url, target, features) => open.call(window, url, target, `${features},type=panel`);
    try {
      return this.app.workspace.openPopoutLeaf();
    } finally {
      window.open = open;
    }
  }

  focusEditor(leaf) {
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!(leaf.view instanceof MarkdownView)) return;
    const editor = leaf.view.editor;
    const last = editor.lastLine();
    editor.setCursor(last, editor.getLine(last).length);
    editor.focus();
  }

  async flush() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file && view.file.path === this.settings.notePath) await view.save();
    }
  }

  report(error) {
    console.error('Capture Overlay', error);
    new Notice(`Capture Overlay: ${error.message}`);
  }

  toggle() {
    const pressed = performance.now();
    this.queue = this.queue.then(() => this.toggleOnce(pressed));
    return this.queue;
  }

  async toggleOnce(pressed) {
    const debug = this.readDebug();
    const start = performance.now();
    const line = { at: new Date().toISOString(), action: 'error', queued: Math.round((start - pressed) * 10) / 10 };
    const mark = (name) => { line[name] = Math.round((performance.now() - start) * 10) / 10; };
    const late = []; // measurements that finish after the toggle does
    try {
      const leaf = this.findLeaves()[0];
      const electronWindow = leaf ? this.electronWindowOf(leaf) : null;
      const action = line.action = pure.nextAction({
        found: Boolean(electronWindow),
        visible: electronWindow ? electronWindow.isVisible() : false,
        focused: electronWindow ? electronWindow.isFocused() : false,
      });
      mark('state');
      if (action === 'create') {
        await this.create(true);
        return;
      }
      if (action === 'hide') {
        // Hiding a window that has not yet drawn its first frame was measured to
        // block for half a second, so a hide straight after a show waits for it.
        await this.painted;
        mark('painted');
        // The app in front was never displaced, so there is no focus to hand back.
        electronWindow.hide();
        mark('hidden');
        this.flush().catch((error) => this.report(error));
        this.rememberBounds(electronWindow).catch((error) => this.report(error));
        return;
      }
      this.moveToActiveDisplay(electronWindow);
      mark('moved');
      this.pinAboveEverything(electronWindow);
      mark('pinned');
      electronWindow.show();
      mark('shown');
      const win = leaf.getContainer().win;
      this.painted = nextFrame(win);
      if (debug) {
        late.push(this.painted.then(() => mark('frame')));
        late.push(settles(whenFocused(win)).then((ok) => {
          if (ok) mark('keyFocus');
          const active = win.document.activeElement;
          line.typing = Boolean(ok && active && active.closest('.cm-content'));
        }));
        late.push(this.probeStalls(win, electronWindow, line));
      }
      if (leaf.isDeferred) await leaf.loadIfDeferred();
      this.focusEditor(leaf);
      mark('editor');
    } catch (error) {
      this.report(error);
    } finally {
      mark('done');
      if (debug) this.writeLog(debug, line, late);
    }
  }

  // ---- measurement ----

  pluginDir() {
    return path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir);
  }

  readDebug() {
    try { return JSON.parse(fs.readFileSync(path.join(this.pluginDir(), 'debug.json'), 'utf8')); } catch (error) { return null; }
  }

  // For 2.5 s after a show, or until the window is hidden: the longest gap
  // between timer ticks in the overlay window (the renderer stalled) and the
  // slowest call into Electron's main process (the main process stalled).
  async probeStalls(win, electronWindow, line) {
    const round = (ms) => Math.round(ms * 10) / 10;
    let last = performance.now();
    const end = last + 2500;
    line.rendererStall = 0;
    line.mainStall = 0;
    while (last < end) {
      await new Promise((resolve) => win.setTimeout(resolve, 20));
      const woke = performance.now();
      if (!electronWindow.isVisible()) return;
      const now = performance.now();
      line.rendererStall = Math.max(line.rendererStall, round(woke - last - 20));
      line.mainStall = Math.max(line.mainStall, round(now - woke));
      last = now;
    }
  }

  async writeLog(debug, line, late) {
    await Promise.all(late);
    const record = Object.assign({ build: BUILD, variant: debug.variant || 'baseline', arrangement: debug.arrangement || '' }, line);
    fs.appendFile(path.join(this.pluginDir(), 'latency.jsonl'), `${JSON.stringify(record)}\n`, () => {});
  }

  async rememberBounds(electronWindow) {
    const bounds = electronWindow.getBounds();
    const saved = this.settings.bounds;
    if (saved && ['x', 'y', 'width', 'height'].every((key) => saved[key] === bounds[key])) return;
    this.settings.bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    await this.saveData(this.settings);
  }

  async changeNotePath(path) {
    for (const leaf of this.findLeaves()) leaf.detach();
    this.settings.notePath = path.trim();
    await this.saveData(this.settings);
  }
}

class CaptureOverlaySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl, plugin } = this;
    containerEl.empty();

    const noteStatus = () => (plugin.app.vault.getAbstractFileByPath(plugin.settings.notePath) instanceof TFile
      ? 'Found.' : 'Not found. The plugin never creates this file.');
    const note = new Setting(containerEl)
      .setName('Capture note')
      .setDesc(`Path inside this vault. ${noteStatus()}`)
      .addText((text) => {
        text.setValue(plugin.settings.notePath);
        text.inputEl.addEventListener('change', async () => {
          await plugin.changeNotePath(text.getValue());
          note.setDesc(`Path inside this vault. ${noteStatus()}`);
        });
      });

    const hotkey = new Setting(containerEl)
      .setName('Global hotkey')
      .setDesc(plugin.hotkeyStatus)
      .addText((text) => {
        text.setValue(plugin.settings.hotkey);
        text.inputEl.addEventListener('change', async () => {
          await plugin.changeHotkey(text.getValue());
          text.setValue(plugin.settings.hotkey);
          hotkey.setDesc(plugin.hotkeyStatus);
        });
      });
  }
}

module.exports = CaptureOverlayPlugin;
