'use strict';

const urlInput = document.getElementById('url');
const folderInput = document.getElementById('folder');
const browseBtn = document.getElementById('browse');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const logBox = document.getElementById('log');
const statusLabel = document.getElementById('status');

function setStatus(text) {
  statusLabel.textContent = text;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  browseBtn.disabled = running;
  urlInput.disabled = running;
}

function appendLog(text) {
  logBox.value += text;
  // Auto-scroll to the bottom.
  logBox.scrollTop = logBox.scrollHeight;
}

// --- Browse ---------------------------------------------------------------
browseBtn.addEventListener('click', async () => {
  const folder = await window.athios.chooseFolder();
  if (folder) folderInput.value = folder;
});

// --- Start ----------------------------------------------------------------
startBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const folder = folderInput.value.trim();

  // Basic client-side URL validation (main process validates again).
  if (!url) {
    alert('Please enter a URL.');
    return;
  }
  if (!/^https?:\/\/.+/i.test(url)) {
    alert('Invalid URL. It must start with http:// or https://');
    return;
  }
  if (!folder) {
    alert('Please choose a save folder.');
    return;
  }

  logBox.value = '';
  setStatus('Downloading...');
  setRunning(true);

  const result = await window.athios.startDownload({ url, folder });
  if (!result || !result.ok) {
    setRunning(false);
    setStatus('Error');
    alert((result && result.message) || 'Failed to start the download.');
  }
});

// --- Stop -----------------------------------------------------------------
stopBtn.addEventListener('click', async () => {
  setStatus('Stopping...');
  stopBtn.disabled = true;
  await window.athios.stopDownload();
});

// --- Live output ----------------------------------------------------------
window.athios.onOutput((text) => {
  appendLog(text);
});

// --- Completion -----------------------------------------------------------
window.athios.onDone((result) => {
  setRunning(false);

  if (result && result.stopped) {
    setStatus('Stopped');
    appendLog('\r\n[Download stopped by user]\r\n');
    return;
  }

  if (result && result.error) {
    setStatus('Error');
    alert('Download failed:\n' + result.error);
    return;
  }

  if (result && result.code === 0) {
    setStatus('Done');
    appendLog('\r\n[Download complete]\r\n');
    alert('Download complete.');
  } else {
    const code = result ? result.code : 'unknown';
    setStatus('Error');
    appendLog('\r\n[wget exited with code ' + code + ']\r\n');
    alert('wget finished with errors (exit code ' + code + ').\n' +
          'Some files may not have been downloaded. See the log for details.');
  }
});
