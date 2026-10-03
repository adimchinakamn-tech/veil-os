#!/usr/bin/env node
/**
 * freetube-service — runtime.js
 *
 * Runs the REAL FreeTube main process (app/dist/main.js) under plain Node by
 * stubbing the `electron` module. Everything the program does on its own —
 * its nedb databases (settings/history/subscriptions), PO-token botGuard,
 * IPC handler logic — runs unmodified. We only fake the GUI/Chromium shell.
 *
 * argv[2] (required, set by index.ts): the viewer's PRIVATE data directory
 * (data/viewers/<viewer-key>). One process per viewer — searches, watch
 * history, playlists, profiles and settings are never shared between
 * visitors. A boot without argv is a stale-closure respawn (bun --hot leak)
 * — park briefly and exit instead of touching the legacy shared dir.
 *
 * Orphan guards (a dead wrapper must never keep writing a viewer's data):
 *   - stdin closes  -> exit immediately
 *   - no stdin line for 3 min AND no argv -> exit (nobody is driving us)
 *   - no argv at all -> exit after 5 min of idling (leaked-closure respawns)
 *
 * IPC contract with the bun wrapper (index.ts), over stdin/stdout JSON lines:
 *   in : {type:'invoke', id, channel, args:[...]}   -> ipcMain.handle channels
 *   in : {type:'send',   id, channel, args:[...]}   -> ipcMain.on channels
 *   out: {type:'invoke-result', id, ok, value?, error?}
 *   out: {type:'event', channel, args}              -> webContents.send broadcasts
 *   out: {type:'boot'}                              -> app ready, handlers registered
 */
"use strict";

const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const EventEmitter = require("node:events");

const APP_DIR = path.join(__dirname, "app");
const HAS_ARGV = !!process.argv[2];
const DATA_DIR = HAS_ARGV ? path.resolve(String(process.argv[2])) : path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
let lastInputAt = Date.now();

const OUT = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (...a) => process.stderr.write("[freetube-runtime] " + a.map(x =>
  typeof x === "string" ? x : util_inspect(x)).join(" ") + "\n");
function util_inspect(o) { try { return JSON.stringify(o); } catch { return String(o); } }

/* ------------------------------------------------------------------ */
/* fake webContents / window plumbing                                  */
/* ------------------------------------------------------------------ */

const winSend = (channel, ...args) => OUT({ type: "event", channel, args });

function makeWebContents(id) {
  const wc = new EventEmitter();
  wc.id = id;
  wc.send = winSend;
  wc.executeJavaScript = async () => undefined;
  wc.setWindowOpenHandler = () => {};
  wc.ipc = { on: () => {}, off: () => {} };
  wc.session = makeSession();
  wc.getURL = () => "app://bundle/index.html";
  wc.setUserAgent = () => {};
  wc.on = wc.on.bind(wc);
  return wc;
}

function makeSession() {
  const handlers = {};
  const s = new EventEmitter();
  s.cookies = {
    get: async () => [],
    set: async () => {},
    remove: async () => {},
  };
  s.webRequest = {
    onBeforeRequest: (fn) => { handlers.onBeforeRequest = fn; },
    onHeadersReceived: (fn) => { handlers.onHeadersReceived = fn; },
    onCompleted: () => {}, onBeforeSendHeaders: () => {}, onSendHeaders: () => {}, onResponseStarted: () => {}, onBeforeRedirect: () => {},
    onErrorOccurred: () => {},
  };
  s.setPermissionRequestHandler = () => {};
  s.setPermissionCheckHandler = () => {};
  s.setUserAgent = () => {};
  s.getUserAgent = () => "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  s.clearCache = async () => {};
  s.clearStorageData = async () => {};
  s.protocol = { handle: () => {}, registerSchemesAsPrivileged: () => {} };
  return s;
}

let winSeq = 1;
function scheduleWindowLifecycle(win) {
  // Emit the load/show lifecycle events a real Chromium window would fire,
  // so async flows waiting on them resolve.
  setImmediate(() => { try { win.webContents.emit("did-finish-load"); } catch {} });
  setTimeout(() => { try { win.emit("ready-to-show"); } catch {} }, 60);
  setTimeout(() => { try { win.emit("show"); } catch {} }, 80);
  setTimeout(() => { try { win.webContents.emit("dom-ready"); } catch {} }, 120);
}
class FakeBrowserWindow {
  constructor(_opts) {
    this.id = winSeq++;
    this.webContents = makeWebContents(this.id);
    this._destroyed = false;
  }
  loadURL() { scheduleWindowLifecycle(this); return Promise.resolve(); }
  loadFile() { scheduleWindowLifecycle(this); return Promise.resolve(); }
  on() { return this; }
  once() { return this; }
  off() { return this; }
  show() {}
  hide() {}
  focus() {}
  close() { this._destroyed = true; }
  destroy() { this._destroyed = true; }
  isDestroyed() { return this._destroyed; }
  minimize() {}
  maximize() {}
  unmaximize() {}
  isMaximized() { return false; }
  setFullScreen() {}
  isFullScreen() { return false; }
  setMenuBarVisibility() {}
  getTitle() { return "FreeTube"; }
  setTitle() {}
  getBounds() { return { x: 0, y: 0, width: 1280, height: 800 }; }
  setBounds() {}
  setParentWindow() {}
  setVisibleOnAllWorkspaces() {}
  setAlwaysOnTop() {}
  isFocused() { return false; }
  static getAllWindows() { return windows; }
  static fromId(id) { return windows.find((w) => w.id === id) || null; }
  static fromWebContents(wc) { return windows.find((w) => w.webContents === wc) || null; }
  static getFocusedWindow() { return windows[0] || null; }
  static getAllWindowsSync() { return windows; }
}
const windows = [];

/* ------------------------------------------------------------------ */
/* ipcMain registries                                                  */
/* ------------------------------------------------------------------ */

const handleRegistry = new Map(); // channel -> (event, ...args) => value
const onRegistry = new Map();     // channel -> Set<fn>

const ipcMain = {
  handle(channel, fn) { handleRegistry.set(channel, fn); },
  handleOnce(channel, fn) { handleRegistry.set(channel, fn); },
  removeHandler(channel) { handleRegistry.delete(channel); },
  on(channel, fn) {
    if (!onRegistry.has(channel)) onRegistry.set(channel, new Set());
    onRegistry.get(channel).add(fn);
  },
  once(channel, fn) { ipcMain.on(channel, fn); },
  off(channel, fn) { const s = onRegistry.get(channel); if (s) s.delete(fn); },
  removeListener(channel, fn) { ipcMain.off(channel, fn); },
  removeAllListeners(channel) { onRegistry.delete(channel); },
  listenerCount(channel) { return onRegistry.get(channel)?.size || 0; },
};

/* ------------------------------------------------------------------ */
/* app stub                                                            */
/* ------------------------------------------------------------------ */

let app = new EventEmitter();
app.getName = () => "freetube";
app.getVersion = () => "0.25.3";
app.isPackaged = true;
app.getLocale = () => "en-US";
app.getSystemLocale = () => "en-US";
app.getPreferredSystemLanguages = () => ["en-US", "en"];
app.getAppMetrics = () => [];
app.getPath = (name) => {
  switch (name) {
    case "userData": return DATA_DIR;
    case "downloads": return path.join(DATA_DIR, "downloads");
    case "pictures": return path.join(DATA_DIR, "pictures");
    case "temp": case "cache": case "userCache": return path.join(DATA_DIR, "cache");
    case "home": return DATA_DIR;
    case "appData": return DATA_DIR;
    default: return DATA_DIR;
  }
};
app.setPath = () => {};
app.setAppUserModelId = () => {};
app.setAboutPanelOptions = () => {};
app.whenReady = () => Promise.resolve();
app.isReady = () => true;
app.requestSingleInstanceLock = () => true;
app.releaseSingleInstanceLock = () => {};
app.relaunch = () => log("relaunch requested (no-op)");
app.exit = () => {};
app.quit = () => log("quit requested (no-op)");
app.commandLine = { appendSwitch: () => {}, appendArgument: () => {}, hasSwitch: () => false, getSwitchValue: () => "" };
app.userAgentFallback = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
app.applicationMenu = null;
app.name = "freetube";
app.setAsDefaultProtocolClient = () => {};
app.removeAsDefaultProtocolClient = () => {};
app.isDefaultProtocolClient = () => false;
app.getJumpListSettings = async () => ({ removedItems: [] });
app.setJumpList = () => false;
app.importCertificate = async () => ({});

/* Safety net: any app.* member the program uses that we didn't define
   becomes a logged no-op function instead of a crash. */
app = new Proxy(app, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    log("app proxy no-op:", String(prop));
    const fn = () => {};
    Object.defineProperty(target, prop, { value: fn, configurable: true, writable: true });
    return fn;
  },
});

/* ------------------------------------------------------------------ */
/* other electron exports                                              */
/* ------------------------------------------------------------------ */

const shell = {
  openExternal: async (url) => log("openExternal:", String(url).slice(0, 200)),
  openPath: async () => "",
  showItemInFolder: () => {},
  beep: () => {},
};
const dialog = {
  showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
  showMessageBoxSync: () => 0,
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showOpenDialogSync: () => [],
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showErrorBox: () => {},
};
const Menu = {
  buildFromTemplate: () => ({ popup: () => {}, closePopup: () => {} }),
  setApplicationMenu: () => {},
  getApplicationMenu: () => null,
  sendActionToFirstResponder: () => {},
  setApplicationMenuJson: () => {},
};
const nativeTheme = new EventEmitter();
nativeTheme.shouldUseDarkColors = true;
nativeTheme.themeSource = "dark";
const screen = {
  getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 0, width: 1280, height: 800 }, workAreaSize: { width: 1280, height: 800 }, scaleFactor: 1, rotation: 0, touchSupport: "unknown" }),
  getAllDisplays: () => [screen.getPrimaryDisplay()],
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  on: () => {},
};
const powerSaveBlocker = { start: () => 1, stop: () => {}, isStarted: () => false };
const clipboard = { writeText: () => {}, readText: () => "", write: () => {}, read: () => "", readImage: () => ({ toDataURL: () => "" }), availableFormats: () => [] };
const net = { fetch: (...a) => globalThis.fetch(...a), isOnline: () => true, ClientRequest: class { on() {} end() {} }, request: () => ({ on: () => {}, end: () => {} }) };
const Tray = class { constructor() { this._n = 1; } setImage() {} setToolTip() {} setContextMenu() {} on() {} destroy() {} closeContextMenu() {} setPressedImage() {} focus() {} popUpContextMenu() {} displayBalloon() {} };
const globalShortcut = { register: () => {}, unregister: () => {}, unregisterAll: () => {}, isRegistered: () => false };
const systemPreferences = { getColor: () => "#000", shouldUseDarkColors: true, getUserDefault: () => "", subscribeNotification: () => {} };
const protocol = {
  handle: (scheme, fn) => { log("protocol.handle:", scheme); protocolHandlers[scheme] = fn; },
  unhandle: () => {},
  registerSchemesAsPrivileged: () => {},
  registerFileProtocol: () => {},
  registerStreamProtocol: () => {},
  isProtocolRegistered: () => true,
};
const protocolHandlers = {};
const session = { defaultSession: makeSession(), fromPartition: () => makeSession() };
const utilityProcess = {
  fork: () => ({ on: () => {}, kill: () => {}, postMessage: () => {}, send: () => {} }),
};
const features = {};
const crashReporter = { start: () => {}, getCrashesDirectory: () => DATA_DIR };
const desktopCapturer = { getSources: async () => [] };
const inAppPurchase = {};
const nativeImage = { createEmpty: () => ({ toDataURL: () => "" }), createFromPath: () => ({ toDataURL: () => "" }) };

const electronStub = {
  app, BrowserWindow: FakeBrowserWindow, ipcMain, session, protocol,
  shell, dialog, Menu, nativeTheme, screen, powerSaveBlocker, clipboard,
  net, Tray, globalShortcut, systemPreferences, utilityProcess, features,
  crashReporter, desktopCapturer, nativeImage, inAppPurchase,
  // constants some code may reference
  MenuBuildFromTemplate: Menu.buildFromTemplate,
  // helper for tests
  __internals: { handleRegistry, onRegistry, windows, winSend, makeSession },
};

/* Patch Module._load BEFORE the main bundle is required. */
const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron" || request === "electron/main" || request === "electron/common") {
    return electronStub;
  }
  return origLoad.call(this, request, parent, isMain);
};

/* ------------------------------------------------------------------ */
/* fake IPC event for dispatching renderer calls into the real handlers */
/* ------------------------------------------------------------------ */

const APP_URL = "app://bundle/index.html";
function makeFakeEvent() {
  const primary = windows[0];
  const wc = primary ? primary.webContents : makeWebContents(999);
  return {
    sender: wc,
    senderFrame: { url: APP_URL, urlHref: () => APP_URL },
    reply: (channel, ...args) => winSend(channel, ...args),
    preventDefault: () => {},
    returnValue: undefined,
    defaultPrevented: false,
  };
}

/* ------------------------------------------------------------------ */
/* dispatch loop                                                       */
/* ------------------------------------------------------------------ */

let booted = false;

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "invoke" || msg.type === "send") {
    const { id, channel, args = [] } = msg;
    try {
      if (msg.type === "invoke") {
        const fn = handleRegistry.get(channel);
        if (!fn) {
          OUT({ type: "invoke-result", id, ok: false, error: { message: `no handler: ${channel}` } });
          return;
        }
        log("invoke:", channel, JSON.stringify(args).slice(0, 200));
        Promise.resolve(fn(makeFakeEvent(), ...args))
          .then((value) => { log("invoke ok:", channel, "->", JSON.stringify(value)?.slice(0, 300)); OUT({ type: "invoke-result", id, ok: true, value }); })
          .catch((err) => OUT({
            type: "invoke-result", id, ok: false,
            error: { message: String(err?.message || err), stack: String(err?.stack || "").slice(0, 2000) },
          }));
      } else {
        const set = onRegistry.get(channel);
        if (set) for (const fn of set) {
          try { fn(makeFakeEvent(), ...args); } catch (err) { log("on-handler error", channel, String(err)); }
        }
        OUT({ type: "invoke-result", id, ok: true, value: null });
      }
    } catch (err) {
      OUT({ type: "invoke-result", id, ok: false, error: { message: String(err?.message || err) } });
    }
  } else if (msg.type === "list-handlers") {
    OUT({ type: "invoke-result", id: msg.id || 0, ok: true, value: { handlers: [...handleRegistry.keys()], on: [...onRegistry.keys()] } });
  }
}

/* Orphan guards — see header. A live wrapper pings every 30s, so a silent
 * stdin means the wrapper module instance is gone (crash / hot reload /
 * cull): exit instead of lingering on a viewer's data dir. */
process.stdin.on("close", () => process.exit(0));
setInterval(() => {
  if (Date.now() - lastInputAt > 180_000) process.exit(0);
  if (!HAS_ARGV && Date.now() - lastInputAt > 300_000) process.exit(0);
}, 60_000).unref?.();

let stdinBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  lastInputAt = Date.now();
  stdinBuf += chunk;
  let nl;
  while ((nl = stdinBuf.indexOf("\n")) >= 0) {
    const line = stdinBuf.slice(0, nl).trim();
    stdinBuf = stdinBuf.slice(nl + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on("end", () => process.exit(0));
process.on("uncaughtException", (err) => { log("UNCAUGHT", String(err?.stack || err)); });
process.on("unhandledRejection", (err) => { log("UNHANDLED", String(err)); });

/* ------------------------------------------------------------------ */
/* boot the real program                                               */
/* ------------------------------------------------------------------ */

(async () => {
  try {
    require(path.join(APP_DIR, "dist", "main.js"));
    // Give the bundle a tick to register its app.on('ready') handlers,
    // then fire ready exactly like Electron would.
    await new Promise((r) => setImmediate(r));
    app.emit("ready", {});
    // The db IPC handlers register at module top-level; the ready callback
    // may keep running in the background — don't block boot on it.
    await new Promise((r) => setTimeout(r, 800));
    booted = true;
    OUT({ type: "boot", handlers: [...handleRegistry.keys()], on: [...onRegistry.keys()] });
    log("booted ok — handlers:", handleRegistry.size, "on-channels:", onRegistry.size);
  } catch (err) {
    log("FATAL boot", String(err?.stack || err));
    OUT({ type: "boot-error", error: String(err?.stack || err).slice(0, 4000) });
    process.exit(1);
  }
})();
