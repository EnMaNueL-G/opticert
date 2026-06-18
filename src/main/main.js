'use strict';
/*
 * OptiCert — proceso principal (Electron). Diagnóstico por ADB, grading y
 * certificado PDF firmado (Ed25519) con QR. Ventana segura (contextIsolation).
 *
 * Autotest:  electron . --selftest     Captura UI:  electron . --shot [vista]
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const adb = require('./adb');
const diagnose = require('./diagnose');
const grade = require('./grade');
const cert = require('./cert');
const listing = require('./listing');
const thermal = require('./thermal');
const functional = require('./functional');

let win = null;
let OUT_DIR = '';
let settings = { shop: 'OptiSuite', technician: '', imeiProvider: '', imeiApiKey: '', imeiEndpoint: '' };
let SETFILE = '';

function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETFILE, 'utf8')) }; } catch (_) {} }
function saveSettings() { try { fs.writeFileSync(SETFILE, JSON.stringify(settings, null, 2)); } catch (_) {} }

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 940, minHeight: 620, backgroundColor: '#0b1020', title: 'OptiCert',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/** Renderiza HTML a PDF en una ventana oculta. */
async function printPdf(html, outPath) {
  const tmp = path.join(os.tmpdir(), 'opticert-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  try {
    await w.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 350));
    const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } });
    fs.writeFileSync(outPath, pdf);
  } finally { w.destroy(); try { fs.unlinkSync(tmp); } catch (_) {} }
  return outPath;
}

/* ---------------- IPC ---------------- */
ipcMain.handle('app:init', async () => ({ version: app.getVersion(), settings, pubKey: cert.pubKey(), outDir: OUT_DIR, adbOk: adb.adbAvailable() }));
ipcMain.handle('cert:devices', async () => { try { return await adb.devices(); } catch (e) { return { ok: false, list: [], error: e.message }; } });
ipcMain.handle('cert:diagnose', async (_e, serial) => {
  try {
    const diag = await diagnose.full(serial, (msg) => { if (win && !win.isDestroyed()) win.webContents.send('cert:step', msg); }, { imeiCfg: { provider: settings.imeiProvider, apiKey: settings.imeiApiKey, endpoint: settings.imeiEndpoint } });
    const g = grade.evaluate(diag);
    return { ok: true, diag, grade: g };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cert:generate', async (_e, { diag, grade: g, meta }) => {
  try {
    const out = await cert.build(diag, g, { shop: settings.shop, technician: (meta && meta.technician) || settings.technician });
    // Confirmación: el usuario elige DÓNDE guardar (o cancela). No se guarda nada hasta confirmar.
    const r = await dialog.showSaveDialog(win, {
      title: 'Guardar certificado',
      defaultPath: path.join(OUT_DIR, `${out.cert.id}.pdf`),
      filters: [{ name: 'Certificado PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return { ok: true, saved: false, cert: out.cert };
    await printPdf(out.html, r.filePath);
    return { ok: true, saved: true, cert: out.cert, signature: out.signature, path: r.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('listing:build', async (_e, { diag, grade: g, certId }) => { try { return { ok: true, ...listing.build(diag, g, certId) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('listing:saveCsv', async (_e, { csv, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (name || 'anuncio') + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, '﻿' + csv, 'utf8'); shell.showItemInFolder(r.filePath); return { ok: true, path: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
});

/* Grabación del borrado (RGPD): OptiCert SOLO graba la pantalla como prueba; NO ejecuta el reset. */
ipcMain.handle('wipe:record', async (_e, { serial, seconds }) => {
  const sec = Math.max(5, Math.min(180, +seconds || 20));
  const remote = '/sdcard/optiwipe_' + Date.now() + '.mp4';
  const local = path.join(OUT_DIR, 'borrado_' + serial.replace(/[^\w.-]+/g, '_') + '_' + Date.now() + '.mp4');
  try {
    if (win && !win.isDestroyed()) win.webContents.send('cert:step', `Grabando ${sec}s (haz el restablecimiento ahora)…`);
    await adb.run(['shell', 'screenrecord', '--time-limit', String(sec), remote], { serial, timeout: (sec + 15) * 1000 });
    await adb.run(['pull', remote, local], { serial, timeout: 60000 });
    try { await adb.shell(['rm', remote], { serial }); } catch (_) {}
    const ok = fs.existsSync(local) && fs.statSync(local).size > 1000;
    return { ok, path: ok ? local : '', size: ok ? fs.statSync(local).size : 0 };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('thermal:test', async (_e, { serial, seconds }) => {
  try {
    const r = await thermal.run(serial, seconds, (reading) => { if (win && !win.isDestroyed()) win.webContents.send('cert:thermal', reading); });
    return { ok: true, thermal: r };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('func:detect', async (_e, serial) => { try { return { ok: true, auto: await functional.auto(serial) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('func:vibrate', async (_e, serial) => functional.vibrate(serial));
ipcMain.handle('func:camera', async (_e, { serial, facing }) => functional.openCamera(serial, facing));
ipcMain.handle('func:camFrame', async (_e, serial) => functional.camFrame(serial));
ipcMain.handle('net:sample', async (_e, serial) => { try { return { ok: true, net: await functional.net(serial) }; } catch (e) { return { ok: false, error: e.message }; } });

/* Botones físicos en vivo: escucha getevent y avisa al pulsar Vol+/Vol-/Power. */
ipcMain.handle('buttons:listen', async (_e, serial) => {
  try {
    adb.startStream('btns', ['shell', 'getevent', '-lt'], { serial }, (txt) => {
      const re = /KEY_(VOLUMEUP|VOLUMEDOWN|POWER)\b[\s\S]{0,40}?(DOWN|00000001)/gi;
      let m; while ((m = re.exec(txt))) { if (win && !win.isDestroyed()) win.webContents.send('cert:button', m[1].toUpperCase()); }
    }, () => {});
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('buttons:stop', async () => { try { adb.stopStream('btns'); } catch (_) {} return { ok: true }; });

/* Consola ADB: ejecutar comandos en el equipo (probar táctil con input tap/swipe, etc.). */
ipcMain.handle('adb:exec', async (_e, { serial, cmd }) => {
  if (!serial || !cmd) return { ok: false, error: 'falta equipo o comando' };
  try {
    const r = await adb.shell(['sh', '-c', String(cmd)], { serial, timeout: 20000 });
    return { ok: true, out: ((r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')).trim() || '(sin salida)' };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* WiFi-ADB: convierte el equipo USB a inalámbrico (por si el cable falla). */
ipcMain.handle('adb:wifi', async (_e, serial) => {
  try {
    if (/:\d+$/.test(serial)) return { ok: true, already: true, serial };
    const ipout = (await adb.run(['-s', serial, 'shell', 'ip', '-o', '-4', 'addr', 'show', 'wlan0'], {})).stdout || '';
    const ip = (ipout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/) || [])[1] || ((await adb.shell(['ip', 'route'], { serial })).stdout.match(/src\s+(\d+\.\d+\.\d+\.\d+)/) || [])[1];
    if (!ip) return { ok: false, error: 'No se pudo leer la IP WiFi del equipo (¿WiFi encendido?)' };
    await adb.run(['-s', serial, 'tcpip', '5555'], {});
    await new Promise((r) => setTimeout(r, 1500));
    const con = (await adb.run(['connect', ip + ':5555'], {})).stdout || '';
    const ok = /connected/i.test(con);
    return { ok, serial: ip + ':5555', ip, note: ok ? 'Ya puedes desconectar el cable.' : con.trim() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('certs:list', async () => {
  try { return fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.pdf')).map((f) => ({ name: f, path: path.join(OUT_DIR, f), mtime: fs.statSync(path.join(OUT_DIR, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, 50); } catch (_) { return []; }
});

ipcMain.handle('settings:get', async () => settings);
ipcMain.handle('settings:set', async (_e, s) => { settings = { ...settings, ...s }; saveSettings(); return { ok: true, settings }; });
ipcMain.handle('app:openPath', async (_e, p) => { shell.openPath(p || OUT_DIR); return { ok: true }; });
ipcMain.handle('app:openExternal', async (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { ok: true }; });

/* ---------------- autotest ---------------- */
async function selftest() {
  const out = (s) => process.stdout.write(s + '\n');
  out('OptiCert selftest ──────────────');
  const d = await adb.devices().catch(() => ({ list: [] }));
  const serials = (d.list || []).filter((x) => x.state === 'device').map((x) => x.serial);
  out('Dispositivos: ' + (serials.join(', ') || 'NINGUNO'));
  if (!serials.length) { out('RESULTADO: sin dispositivo para probar'); app.exit(1); return; }
  const serial = serials[0];
  out('Diagnosticando ' + serial + ' …');
  const diag = await diagnose.full(serial, (m) => out('  · ' + m));
  out(`  Modelo: ${diag.system.brand} ${diag.system.model} · Android ${diag.system.android}`);
  out(`  Batería: salud ${diag.battery.healthPct != null ? diag.battery.healthPct + '%' : 'n/d'} · ${diag.battery.cycles || '?'} ciclos · ${diag.battery.temp}°C`);
  out(`  IMEI: ${(diag.imeis || []).join(', ') || 'n/d'} · root: ${diag.security.rooted}`);
  const g = grade.evaluate(diag);
  out(`  GRADO: ${g.grade} (${g.label}) · listo para vender: ${g.readyToSell}`);
  const built = await cert.build(diag, g, { shop: settings.shop });
  const file = path.join(OUT_DIR, built.cert.id + '.pdf');
  await printPdf(built.html, file);
  const okPdf = fs.existsSync(file) && fs.statSync(file).size > 5000;
  const okSig = cert.verify(built.cert, built.signature);
  out(`  Certificado PDF: ${okPdf ? 'generado (' + Math.round(fs.statSync(file).size / 1024) + ' KB)' : 'FALLÓ'} → ${file}`);
  out(`  Firma Ed25519 válida: ${okSig ? 'sí ✓' : 'NO ✗'}`);
  out('\nRESULTADO: ' + (okPdf && okSig ? 'OK ✓' : 'REVISAR ✗'));
  app.exit(okPdf && okSig ? 0 : 1);
}

/* ---------------- captura ---------------- */
function shot() {
  createWindow();
  const viewArg = (process.argv[process.argv.indexOf('--shot') + 1] || '').replace(/^--/, '');
  win.webContents.once('did-finish-load', async () => {
    win.show(); await new Promise((r) => setTimeout(r, 1800));
    if (viewArg === 'about') {
      try { await win.webContents.executeJavaScript(`document.querySelector('#mabout').classList.add('show')`); } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    } else if (viewArg === 'cammodal') {
      try { await win.webContents.executeJavaScript(`(function(){var c=document.createElement('canvas');c.width=540;c.height=1200;var x=c.getContext('2d');x.fillStyle='#123';x.fillRect(0,0,540,1200);x.fillStyle='#0fa';x.font='40px sans';x.fillText('VISOR CAMARA (prueba)',40,600);document.querySelector('#camImg').src=c.toDataURL();document.querySelector('#camWho').textContent='trasera';document.querySelector('#mcam').classList.add('show');})()`); } catch (_) {}
      await new Promise((r) => setTimeout(r, 700));
    } else if (viewArg === 'scan') {
      try { await win.webContents.executeJavaScript(`(function(){var s=document.querySelector('#device');if(s&&s.options.length&&s.value){document.querySelector('#diagBtn').click();return true}return false})()`); } catch (_) {}
      await new Promise((r) => setTimeout(r, 11000));
    } else if (viewArg) { try { await win.webContents.executeJavaScript(`window.__go && window.__go('${viewArg}')`); } catch (_) {} await new Promise((r) => setTimeout(r, 900)); }
    try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(process.cwd(), '..', '..', 'Salidas-Logs', 'opticert-shot.png'), img.toPNG()); process.stdout.write('SHOT_OK\n'); }
    catch (e) { process.stdout.write('SHOT_ERR ' + e.message + '\n'); }
    app.exit(0);
  });
}

/* ---------------- ciclo de vida ---------------- */
const isSelftest = process.argv.includes('--selftest');
const isShot = process.argv.includes('--shot');
app.whenReady().then(() => {
  SETFILE = path.join(app.getPath('userData'), 'opticert-settings.json'); loadSettings();
  cert.initKeys(app.getPath('userData'));
  try { OUT_DIR = path.join(app.getPath('documents'), 'OptiCert'); fs.mkdirSync(OUT_DIR, { recursive: true }); }
  catch (_) { OUT_DIR = path.join(app.getPath('userData'), 'out'); fs.mkdirSync(OUT_DIR, { recursive: true }); }
  if (isSelftest) { selftest(); return; }
  if (isShot) { shot(); return; }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
const gotLock = (isSelftest || isShot) ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
