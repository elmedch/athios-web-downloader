'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let wgetProcess = null;
let manualStop = false;   // set true when the user presses Stop
let finished = false;     // guard so we only report completion once

/**
 * Resolve the path to the bundled wget.exe.
 * - In development it sits next to this file.
 * - In a packaged build it is copied into the app's resources folder
 *   (see "extraResources" in package.json).
 */
function getWgetPath() {
  const devPath = path.join(__dirname, 'wget.exe');
  const packagedPath = path.join(process.resourcesPath || '', 'wget.exe');

  if (app.isPackaged) {
    if (fs.existsSync(packagedPath)) return packagedPath;
    return devPath; // fallback, just in case
  }
  return devPath;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 560,
    minHeight: 420,
    title: 'ATHIOS WD',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Remove the default application menu for a plain utility look.
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile('index.html');

  // Open any external links (e.g. the Ko-fi button) in the system browser
  // instead of a blank Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Make sure no orphaned wget process survives the window closing.
  killWget();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killWget();
});

/**
 * Kill the running wget process (and any children) reliably on Windows.
 */
function killWget() {
  if (!wgetProcess) return;
  const pid = wgetProcess.pid;
  manualStop = true;

  if (process.platform === 'win32' && pid) {
    // taskkill terminates the whole process tree, which is the most
    // reliable way to stop a native child process on Windows.
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } catch (e) {
      /* ignore */
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

// Folder picker dialog.
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose save folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Start a download.
ipcMain.handle('start-download', async (event, payload) => {
  const url = (payload && payload.url ? String(payload.url) : '').trim();
  const folder = (payload && payload.folder ? String(payload.folder) : '').trim();

  if (wgetProcess) {
    return { ok: false, message: 'A download is already running.' };
  }

  // --- Basic validation -------------------------------------------------
  if (!url) {
    return { ok: false, message: 'Please enter a URL.' };
  }
  if (!/^https?:\/\/.+/i.test(url)) {
    return { ok: false, message: 'Invalid URL. It must start with http:// or https://' };
  }
  if (!folder) {
    return { ok: false, message: 'Please choose a save folder.' };
  }
  if (!fs.existsSync(folder)) {
    return { ok: false, message: 'The chosen save folder does not exist.' };
  }
  // Write-permission check.
  try {
    fs.accessSync(folder, fs.constants.W_OK);
  } catch (e) {
    return { ok: false, message: 'No write permission for the chosen folder.' };
  }

  const wgetPath = getWgetPath();
  if (!fs.existsSync(wgetPath)) {
    return {
      ok: false,
      message: 'wget.exe was not found. Please make sure it is bundled with the app.'
    };
  }

  const args = [
    '--mirror',
    '--convert-links',
    '--adjust-extension',
    '--page-requisites',
    '--no-parent',
    url
  ];

  const sendLog = (text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wget-output', text);
    }
  };

  manualStop = false;
  finished = false;

  sendLog('> "' + wgetPath + '" ' + args.join(' ') + '\r\n');
  sendLog('> Working directory: ' + folder + '\r\n\r\n');

  try {
    wgetProcess = spawn(wgetPath, args, {
      cwd: folder,
      windowsHide: true
    });
  } catch (e) {
    wgetProcess = null;
    return { ok: false, message: 'Failed to launch wget.exe: ' + e.message };
  }

  const reportDone = (payload) => {
    if (finished) return;
    finished = true;
    wgetProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wget-done', payload);
    }
  };

  wgetProcess.stdout.on('data', (data) => sendLog(data.toString()));
  wgetProcess.stderr.on('data', (data) => sendLog(data.toString())); // wget logs progress to stderr

  wgetProcess.on('error', (err) => {
    sendLog('\r\n[ERROR] ' + err.message + '\r\n');
    reportDone({ code: -1, error: err.message, stopped: false });
  });

  wgetProcess.on('close', (code, signal) => {
    reportDone({ code, signal, stopped: manualStop });
  });

  return { ok: true };
});

// Stop the running download.
ipcMain.handle('stop-download', async () => {
  if (!wgetProcess) return { ok: false, message: 'No download is running.' };
  killWget();
  return { ok: true };
});
