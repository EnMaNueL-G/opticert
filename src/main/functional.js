'use strict';
/*
 * OptiCert — pruebas funcionales.
 *  - AUTO (sin tocar el teléfono): presencia de cámaras/flash, sensores VIVOS,
 *    estado de carga, WiFi/Bluetooth — verificado por software (ADB).
 *  - ASISTIDO: dispara vibración / abre cámara para que el operario confirme.
 *  - MANUAL: micro, altavoz, auricular, táctil, botones — se prueban en el móvil.
 */
const adb = require('./adb');

async function sh(serial, args) { try { return ((await adb.shell(args, { serial, timeout: 6000 })).stdout || '').trim(); } catch (_) { return ''; } }

/** Verificación automática por software (no requiere el teléfono en mano). */
async function auto(serial) {
  const feats = await sh(serial, ['pm', 'list', 'features']);
  const has = (f) => feats.includes(f);
  const sensorTypes = (feats.match(/feature:android\.hardware\.sensor\./g) || []).length;
  const sens = await sh(serial, ['dumpsys', 'sensorservice']);
  const sensorsAlive = /last\s+\d+\s+events|accelerometer/i.test(sens);
  const bat = await sh(serial, ['dumpsys', 'battery']);
  const charging = /(AC|USB|Wireless) powered:\s*true/i.test(bat) || /status:\s*2/.test(bat);
  const wifiOn = (await sh(serial, ['settings', 'get', 'global', 'wifi_on'])).trim() === '1';
  const btOn = (await sh(serial, ['settings', 'get', 'global', 'bluetooth_on'])).trim() === '1';
  const back = has('android.hardware.camera') || has('android.hardware.camera.any');
  const front = has('android.hardware.camera.front');
  return {
    camara: { auto: true, ok: back || front, info: `${back ? 'trasera' : ''}${back && front ? ' + ' : ''}${front ? 'frontal' : ''} detectada(s)` },
    linterna: { auto: true, ok: has('android.hardware.camera.flash'), info: has('android.hardware.camera.flash') ? 'flash detectado (enciéndela para confirmar)' : 'sin flash' },
    sensores: { auto: true, ok: sensorsAlive || sensorTypes > 0, info: sensorsAlive ? `vivos (${sensorTypes} tipos, reportando datos)` : (sensorTypes ? `${sensorTypes} detectados` : 'no detectados') },
    carga: { auto: charging, ok: charging, info: charging ? 'cargando ✓' : 'conecta el cargador para autoverificar' },
    conect: { auto: true, ok: has('android.hardware.wifi') && has('android.hardware.bluetooth'), info: `WiFi ${wifiOn ? 'on' : 'off'} · BT ${btOn ? 'on' : 'off'}` },
  };
}

/** Vibración: usa el servicio correcto por versión. NUNCA afirma que vibró (no es verificable). */
async function vibrate(serial) {
  const sdk = parseInt(await sh(serial, ['getprop', 'ro.build.version.sdk']), 10) || 0;
  const tries = sdk >= 30
    ? [['cmd', 'vibrator_manager', 'synced', 'oneshot', '1000'], ['cmd', 'vibrator', 'vibrate', '1000']]
    : sdk >= 28
      ? [['cmd', 'vibrator', 'vibrate', '1000'], ['cmd', 'vibrator', 'vibrate', '-f', '1000']]
      : [];
  let triggered = false;
  for (const c of tries) { const r = await sh(serial, c); if (!/can't find|unknown|error|exception|usage:/i.test(r)) { triggered = true; break; } }
  return { triggered, sdk, note: triggered ? '✋ ¿Vibró el móvil? Marca ✓ si sí, ✗ si no (no se puede confirmar por software).' : `No se pudo disparar por ADB (Android ${sdk}). Prueba la vibración a mano y marca ✓/✗.` };
}

async function openCamera(serial, facing) {
  await sh(serial, ['input', 'keyevent', 'KEYCODE_WAKEUP']);
  const args = ['am', 'start', '-a', 'android.media.action.STILL_IMAGE_CAMERA'];
  if (facing === 'front') args.push('--ei', 'android.intent.extras.CAMERA_FACING', '1', '--ei', 'android.intent.extras.LENS_FACING_FRONT', '1', '--ez', 'android.intent.extra.USE_FRONT_CAMERA', 'true');
  await sh(serial, args);
  return { ok: true };
}

/** Captura un frame del visor de la cámara para mostrarlo en la herramienta. */
async function camFrame(serial) {
  try {
    const buf = await adb.screencap(serial, 8000);
    if (!buf || buf.length < 1000) return { ok: false };
    return { ok: true, data: 'data:image/png;base64,' + buf.toString('base64') };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Muestra en vivo de red: WiFi (RSSI, velocidad, throughput) + Bluetooth. */
async function net(serial) {
  const w = await sh(serial, ['cmd', 'wifi', 'status']);
  const num = (re) => { const m = w.match(re); return m ? parseFloat(m[1]) : null; };
  const wifiOn = /Wifi is enabled/i.test(w);
  const ssid = (w.match(/SSID:\s*"([^"]+)"/) || [])[1] || null;
  const rssi = num(/RSSI:\s*(-?\d+)/);
  const link = num(/Link speed:\s*(\d+)/i);
  const tx = num(/successfulTxPacketsPerSecond:\s*([\d.]+)/);
  const rx = num(/successfulRxPacketsPerSecond:\s*([\d.]+)/);
  let networks = parseInt((await sh(serial, ['cmd', 'wifi', 'list-scan-results'])).split(/\r?\n/).length, 10) - 1;
  if (!(networks >= 0)) networks = null;
  const bt = await sh(serial, ['dumpsys', 'bluetooth_manager']);
  const btEnabled = /enabled:\s*true/i.test(bt);
  const btName = (bt.match(/name:\s*(.+)/) || [])[1] || null;
  const bonded = (bt.match(/Bonded devices/i) ? (bt.split(/Bonded devices.*\n/)[1] || '').split(/\n\s*\n/)[0] : '');
  const btBonded = (bonded.match(/([0-9a-f]{2}:){5}[0-9a-f]{2}/gi) || []).length;
  return { wifiOn, ssid, rssi, link, tx, rx, networks, btEnabled, btName, btBonded };
}

module.exports = { auto, vibrate, openCamera, camFrame, net };
