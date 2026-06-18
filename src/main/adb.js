'use strict';
/*
 * OptiFleet — capa ADB (reutiliza el motor probado del Toolkit).
 * execFile con array de argumentos: sin shell, sin inyección. Soporta múltiples
 * dispositivos en paralelo, captura binaria (PNG) y streaming de larga duración.
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let ADB_PATH = null;

function candidatePaths() {
  const c = [];
  const local = process.env.LOCALAPPDATA;
  const pf = process.env['ProgramFiles'];
  const pf86 = process.env['ProgramFiles(x86)'];
  if (local) c.push(path.join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  if (pf) c.push(path.join(pf, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  if (pf86) c.push(path.join(pf86, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  c.push(path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  if (process.resourcesPath) {
    c.push(path.join(process.resourcesPath, 'scrcpy', 'adb.exe'));        // adb empaquetado (junto a scrcpy)
    c.push(path.join(process.resourcesPath, 'platform-tools', 'adb.exe'));
  }
  c.push(path.join(__dirname, '..', '..', 'vendor', 'scrcpy', 'adb.exe')); // modo desarrollo
  c.push(path.join(__dirname, '..', '..', 'platform-tools', 'adb.exe'));
  // adb del Toolkit hermano (modo desarrollo)
  c.push(path.join(__dirname, '..', '..', '..', 'optisuite-toolkit', 'vendor', 'scrcpy', 'adb.exe'));
  return c;
}

function resolveAdb() {
  if (ADB_PATH) return ADB_PATH;
  try {
    const r = spawn ? require('child_process').spawnSync(process.platform === 'win32' ? 'where' : 'which', ['adb']) : null;
    if (r && r.status === 0) {
      const line = String(r.stdout).split(/\r?\n/).find(Boolean);
      if (line && fs.existsSync(line.trim())) { ADB_PATH = line.trim(); return ADB_PATH; }
    }
  } catch (_) {}
  for (const p of candidatePaths()) {
    try { if (fs.existsSync(p)) { ADB_PATH = p; return ADB_PATH; } } catch (_) {}
  }
  ADB_PATH = 'adb';
  return ADB_PATH;
}

function adbAvailable() {
  const p = resolveAdb();
  if (p === 'adb') {
    try { return require('child_process').spawnSync('adb', ['version']).status === 0; } catch (_) { return false; }
  }
  return fs.existsSync(p);
}

function run(args, { serial = null, timeout = 60000, binary = false } = {}) {
  const adb = resolveAdb();
  const full = serial ? ['-s', serial, ...args] : args;
  const opts = { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 96, encoding: binary ? 'buffer' : 'utf8' };
  return new Promise((resolve) => {
    execFile(adb, full, opts, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
        stdout: binary ? (stdout || Buffer.alloc(0)) : (stdout || '').toString(),
        stderr: binary ? (stderr ? stderr.toString() : '') : (stderr || '').toString(),
        error: err ? (err.killed ? 'timeout' : err.message) : null,
      });
    });
  });
}

function shell(args, opts = {}) { return run(['shell', ...args], opts); }

async function devices() {
  const r = await run(['devices', '-l']);
  const out = [];
  if (!r.ok && !r.stdout) return { ok: false, list: [], error: r.error };
  const lines = r.stdout.split(/\r?\n/).slice(1);
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    const m = t.match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const rest = m[3] || '';
    out.push({
      serial: m[1],
      state: m[2],
      model: ((rest.match(/model:(\S+)/) || [])[1] || '').replace(/_/g, ' '),
      device: (rest.match(/device:(\S+)/) || [])[1] || '',
      transport: /^\d+\.\d+\.\d+\.\d+:/.test(m[1]) ? 'wifi' : 'usb',
    });
  }
  return { ok: true, list: out };
}

/** Captura de pantalla como Buffer PNG (para el mosaico). */
async function screencap(serial, timeout = 12000) {
  const r = await run(['exec-out', 'screencap', '-p'], { serial, timeout, binary: true });
  if (r.ok && r.stdout && r.stdout.length > 8) return r.stdout;
  return null;
}

/* IMEI: el código de transacción de iphonesubinfo varía por versión/OEM. */
function parseParcelDigits(out) {
  const digits = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/'([^']*)'/);
    if (m) for (const ch of m[1]) if (ch >= '0' && ch <= '9') digits.push(ch);
  }
  return digits.join('');
}
async function fetchImeis(serial) {
  const found = [];
  for (const code of ['1', '2', '3', '4', '5', '6', '7']) {
    for (const args of [
      ['service', 'call', 'iphonesubinfo', code],
      ['service', 'call', 'iphonesubinfo', code, 's16', 'com.android.shell'],
    ]) {
      const r = await shell(args, { serial, timeout: 6000 });
      const d = parseParcelDigits(r.stdout);
      if (d && d.length >= 14 && d.length <= 16) {
        const imei = d.slice(0, 15);
        if (!found.includes(imei)) found.push(imei);
        break;
      }
    }
    if (found.length >= 2) break;
  }
  return found;
}

/* ---------- Vídeo H.264 en vivo (Fase 2) ----------
 * screenrecord emite un stream H.264 (Annex-B) por stdout; lo enviamos en crudo al
 * renderer, que lo decodifica con WebCodecs. exec-out garantiza stdout binario limpio. */
function startVideo(id, serial, onData, onClose, opts = {}) {
  stopStream(id);
  const adb = resolveAdb();
  const size = opts.size ? ['--size', String(opts.size)] : [];
  const args = ['-s', serial, 'exec-out', 'screenrecord', '--output-format=h264',
    '--bit-rate', String(opts.bitrate || 6000000), ...size, '--time-limit', '180', '-'];
  let child;
  try { child = spawn(adb, args, { windowsHide: true }); }
  catch (e) { onClose && onClose(e.message); return false; }
  streams.set(id, child);
  child.stdout.on('data', (d) => onData(d));            // d = Buffer (H.264 crudo)
  child.stderr.on('data', () => {});
  child.on('close', (code) => { streams.delete(id); onClose && onClose(null, code); });
  child.on('error', (e) => { streams.delete(id); onClose && onClose(e.message); });
  return true;
}

/* ---------- Streaming ---------- */
const streams = new Map();
function startStream(id, args, { serial = null }, onData, onEnd) {
  stopStream(id);
  const adb = resolveAdb();
  const full = serial ? ['-s', serial, ...args] : args;
  let child;
  try { child = spawn(adb, full, { windowsHide: true }); }
  catch (e) { onData(`[ERROR] ${e.message}\n`); onEnd && onEnd(); return false; }
  streams.set(id, child);
  child.stdout.on('data', (d) => onData(d.toString()));
  child.stderr.on('data', (d) => onData(d.toString()));
  child.on('close', (code) => { streams.delete(id); onEnd && onEnd(code); });
  child.on('error', (e) => { onData(`[ERROR] ${e.message}\n`); streams.delete(id); onEnd && onEnd(1); });
  return true;
}
function stopStream(id) { const c = streams.get(id); if (c) { try { c.kill(); } catch (_) {} streams.delete(id); return true; } return false; }
function stopAllStreams() { for (const id of [...streams.keys()]) stopStream(id); }

module.exports = {
  resolveAdb, adbAvailable, run, shell, devices, screencap, fetchImeis,
  startVideo, startStream, stopStream, stopAllStreams,
};
