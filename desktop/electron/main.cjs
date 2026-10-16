'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { getDevice } = require('./device.cjs');

// Only one Raider Assist instance can own the tray icon.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  let window = null;
  let tray = null;
  let trayMenu = null;
  let quitting = false;
  // Public API endpoint only. NEVER store BEID, Web Services Key, or test token here.
  function backendUrl() {
    if (process.env.RAIDER_API_URL) { const u = new URL(process.env.RAIDER_API_URL); if (app.isPackaged && u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error('Packaged backend requires HTTPS'); return u.toString(); }
    if (app.isPackaged) {
      try {
        const settings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'raider-config.json'), 'utf8'));
        const url = new URL(settings.apiBaseUrl);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
          throw new Error('Packaged API URL must use HTTPS (except loopback testing)');
        }
        return url.toString();
      } catch (error) {
        console.warn('Raider Assist backend configuration unavailable:', error.message);
      }
    }
    return 'http://127.0.0.1:8789'; // Development-only/local packaged smoke test.
  }
  const apiBase = backendUrl();
  const assetPath = (filename) => path.join(__dirname, 'assets', filename);
  const hiddenStartup = process.argv.includes('--hidden') || process.env.RAIDER_START_HIDDEN === '1' || (app.isPackaged && process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);

  function sandboxTestHeaders() {
    // Restricted to development; never ship Sandbox write secrets in a packaged app.
    if (app.isPackaged) return {};
    try {
      const env = parseEnv(fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8'));
      if (env.RAIDER_MODE === 'sandbox-test' && env.RAIDER_SANDBOX_WRITE_ENABLED === 'YES') {
        return {
          'x-raider-sandbox-test-token': env.RAIDER_SANDBOX_TEST_TOKEN || '',
          'x-raider-confirm-sandbox-write': 'create-test-ticket'
        };
      }
    } catch { /* No local test configuration. */ }
    return {};
  }

  function trayImage() {
    if (process.platform === 'darwin') {
      // Full-color GRCC mascot: do NOT mark as a macOS template image.
      // Supply 1x and 2x frames so it stays sharp on Retina displays.
      const image = nativeImage.createFromPath(assetPath('raider-menubar-22.png'));
      image.addRepresentation({ scaleFactor: 2, filename: assetPath('raider-menubar-44.png') });
      image.setTemplateImage(false);
      return image;
    }
    return nativeImage.createFromPath(assetPath('raider-tray-win.png')).resize({ width: 20, height: 20 });
  }

  function loginEnabled() {
    if (!app.isPackaged) return false;
    return app.getLoginItemSettings().openAtLogin;
  }

  function setLoginEnabled(enabled) {
    if (!app.isPackaged) return;
    // --hidden applies to launches initiated by Windows login items.
    const options = { openAtLogin: enabled };
    if (process.platform === 'win32') options.args = ['--hidden'];
    // macOS detects login launch with wasOpenedAtLogin; --hidden is not required.
    app.setLoginItemSettings(options);
  }

  function showWindow() {
    if (!window || window.isDestroyed()) createWindow();
    if (window.isMinimized()) window.restore();
    if (process.platform === 'win32') window.setSkipTaskbar(false);
    window.show();
    window.focus();
    updateTrayMenu();
  }

  function hideWindow() {
    if (!window || window.isDestroyed()) return;
    window.hide();
    if (process.platform === 'win32') window.setSkipTaskbar(true);
    updateTrayMenu();
  }

  function toggleWindow() {
    if (window && !window.isDestroyed() && window.isVisible() && window.isFocused()) {
      hideWindow();
    } else {
      showWindow();
    }
  }

  function quitApplication() {
    quitting = true;
    app.quit();
  }

  function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) return;
    const visible = Boolean(window && !window.isDestroyed() && window.isVisible());
    const items = [
      { label: 'Request IT assistance', click: showWindow },
      { label: visible ? 'Hide Raider Assist' : 'Show Raider Assist', click: visible ? hideWindow : showWindow },
      { type: 'separator' }
    ];
    if (app.isPackaged) {
      items.push({ label: 'Launch at login', type: 'checkbox', checked: loginEnabled(), click: (item) => {
        setLoginEnabled(item.checked);
        updateTrayMenu();
      } });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Quit Raider Assist', click: quitApplication });
    const contextMenu = Menu.buildFromTemplate(items);
    // On macOS attaching a menu can replace the normal primary-click handler.
    // Keep primary click as toggle; show the context menu explicitly on right click.
    if (process.platform === 'win32') tray.setContextMenu(contextMenu);
    else trayMenu = contextMenu;
  }

  function createWindow() {
    window = new BrowserWindow({
      width: 610,
      height: 845,
      minWidth: 470,
      minHeight: 650,
      show: false,
      autoHideMenuBar: true,
      title: 'GRCC Raider Assist',
      icon: assetPath(process.platform === 'win32' ? 'raider.ico' : 'raider-app.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    if (!app.isPackaged) {
      void window.loadURL('http://127.0.0.1:4200');
    } else {
      void window.loadFile(path.join(__dirname, '../dist/browser/index.html'));
    }

    window.once('ready-to-show', () => {
      if (!hiddenStartup) showWindow();
    });
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        hideWindow();
      }
    });
    window.on('show', updateTrayMenu);
    window.on('hide', updateTrayMenu);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
  }

  async function send(pathname, init = {}) {
    const response = await fetch(new URL(pathname, apiBase), {
      ...init,
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server responded ${response.status}`);
    return data;
  }

  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      // A menu-bar utility: keep the native Dock hidden even when its window opens.
      app.setActivationPolicy('accessory');
      app.dock?.hide();
    }

    // Never register the npm/Electron development executable at login.
    // Configure an installed build once, then preserve the user's tray-menu preference.
    if (app.isPackaged && process.env.RAIDER_DISABLE_AUTO_START !== '1') {
      const marker = path.join(app.getPath('userData'), 'login-preference-initialized');
      if (!fs.existsSync(marker)) {
        setLoginEnabled(true);
        try { fs.writeFileSync(marker, '1', { flag: 'wx' }); } catch (error) {
          console.warn('Could not persist login preference marker:', error.message);
        }
      }
    }

    tray = new Tray(trayImage());
    tray.setToolTip('GRCC Raider Assist');
    // Left-click opens/closes the form; right-click shows controls.
    tray.on('click', toggleWindow);
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu || undefined));

    createWindow();
    updateTrayMenu();

    ipcMain.handle('device:get', () => getDevice());
    ipcMain.handle('locations:list', () => send('/api/locations'));
    ipcMain.handle('locations:rooms', (_event, locationId) => {
      if (!Number.isSafeInteger(locationId) || locationId <= 0) throw new Error('Invalid building');
      return send(`/api/locations/${locationId}/rooms`);
    });
    ipcMain.handle('backend:status', () => send('/health'));
    ipcMain.handle('ticket:submit', async (_event, payload) => {
      const device = await getDevice();
      return send('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...sandboxTestHeaders() },
        body: JSON.stringify({ ...payload, device })
      });
    });
    ipcMain.handle('url:open', async (_event, url) => {
      const allowed = 'https://supportdesk.grcc.edu/';
      if (typeof url !== 'string' || !url.startsWith(allowed)) throw new Error('Untrusted URL');
      await shell.openExternal(url);
    });
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* Keep tray application running. */ });
  app.on('activate', showWindow);
}
