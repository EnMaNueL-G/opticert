'use strict';
/*
 * OptiCert — motor de diagnóstico por ADB.
 * Recoge sistema, batería (con salud REAL ASOC si hay root), almacenamiento, RAM,
 * pantalla, IMEI y estado de seguridad. Datos SOLO del propio equipo.
 */
const adb = require('./adb');
const imeiMod = require('./imei');

async function sh(serial, args) { try { const r = await adb.shell(args, { serial }); return (r.stdout || '').trim(); } catch (_) { return ''; } }
async function prop(serial, key) { return sh(serial, ['getprop', key]); }

async function isRooted(serial) { return /uid=0/.test(await sh(serial, ['su', '-c', 'id'])); }

const HEALTH = { 1: 'Desconocida', 2: 'Buena', 3: 'Sobrecalentada', 4: 'Muerta', 5: 'Sobretensión', 6: 'Fallo', 7: 'Fría' };

async function battery(serial, rooted) {
  const out = await sh(serial, ['dumpsys', 'battery']);
  const num = (k) => { const m = out.match(new RegExp('^\\s*' + k + ':\\s*(-?\\d+)', 'm')); return m ? parseInt(m[1], 10) : NaN; };
  const txt = (k) => ((out.match(new RegExp('^\\s*' + k + ':\\s*(.+)', 'm')) || [])[1] || '').trim();
  const b = { level: num('level'), healthCode: num('health'), health: HEALTH[num('health')] || '?', temp: num('temperature') / 10, voltage: num('voltage') / 1000, technology: txt('technology') };
  const g = async (p) => (await sh(serial, rooted ? ['su', '-c', 'cat', p] : ['cat', p])).split(/\r?\n/)[0];
  const B = '/sys/class/power_supply/battery/';
  const asoc = parseInt(await g(B + 'fg_asoc'), 10);
  const full = parseInt(await g(B + 'charge_full'), 10);
  const design = parseInt(await g(B + 'charge_full_design'), 10);
  let cyc = await g(B + 'battery_cycle'); if (!cyc) cyc = await g(B + 'cycle_count'); if (!cyc) cyc = await g(B + 'fg_cycle');
  b.asoc = (isFinite(asoc) && asoc > 0 && asoc <= 100) ? asoc : null;
  b.capacityNow = (isFinite(full) && full > 0) ? Math.round(full / 1000) : null;
  b.capacityDesign = (isFinite(design) && design > 0) ? Math.round(design / 1000) : null;
  b.cycles = parseInt(cyc, 10) || null;
  // Salud = ASOC (Samsung) o capacidad actual/diseño. Una batería nueva puede dar >100%
  // (almacena algo más que la capacidad mínima declarada); se capa a 100% para el certificado.
  const hp = b.asoc || (b.capacityNow && b.capacityDesign ? Math.round((b.capacityNow * 100) / b.capacityDesign) : null);
  b.healthPct = hp != null ? Math.min(100, hp) : null;
  return b;
}

function parseDf(df) {
  const line = (df.split(/\r?\n/).find((l) => /\/data/.test(l)) || '').split(/\s+/);
  // df -h: Filesystem Size Used Avail Use% Mounted
  const size = line.find((x) => /[\d.]+G$/i.test(x));
  return size || '';
}

async function system(serial) {
  const [brand, model, manufacturer, android, sdk, serialno] = await Promise.all([
    prop(serial, 'ro.product.brand'), prop(serial, 'ro.product.model'), prop(serial, 'ro.product.manufacturer'),
    prop(serial, 'ro.build.version.release'), prop(serial, 'ro.build.version.sdk'), prop(serial, 'ro.serialno'),
  ]);
  const df = await sh(serial, ['df', '-h', '/data']);
  const mem = await sh(serial, ['cat', '/proc/meminfo']);
  const ramKb = (mem.match(/MemTotal:\s*(\d+)/) || [])[1];
  const size = (await sh(serial, ['wm', 'size'])).match(/(\d+x\d+)/);
  return { brand, model, manufacturer, android, sdk: parseInt(sdk, 10) || null, serialno, ramGB: ramKb ? (+ramKb / 1048576).toFixed(1) : null, screen: size ? size[1] : '', storage: parseDf(df) };
}

async function security(serial, rooted) {
  // Detección best-effort. FRP/iCloud fiable requiere root/comprobación manual.
  let googleAccounts = null;
  if (rooted) { const acc = await sh(serial, ['su', '-c', 'dumpsys', 'account']); googleAccounts = (acc.match(/com\.google/g) || []).length; }
  const encrypted = /encrypted/i.test(await sh(serial, ['getprop', 'ro.crypto.state']));
  return { rooted, encrypted, googleAccounts, frp: googleAccounts == null ? 'revisar manualmente' : (googleAccounts > 0 ? 'cuenta presente (revisar)' : 'sin cuenta') };
}

async function imei(serial) {
  try { const r = await adb.fetchImeis(serial); return (Array.isArray(r) ? r : [r]).filter(Boolean); } catch (_) { return []; }
}

/** Diagnóstico completo. opts.imeiCfg = { apiKey, endpoint } para blacklist BYOK. */
async function full(serial, onStep, opts = {}) {
  const step = onStep || (() => {});
  step('Detectando root…'); const rooted = await isRooted(serial);
  step('Leyendo sistema…'); const sys = await system(serial);
  step('Leyendo batería…'); const bat = await battery(serial, rooted);
  step('Leyendo IMEI…'); const imeis = await imei(serial);
  step('Verificando IMEI (Luhn/TAC)…');
  const imeiAnalysis = imeis.map((x) => imeiMod.analyze(x));
  step('Consultando blacklist…');
  let bl = { status: 'sin-imei' };
  if (imeis[0]) bl = await imeiMod.blacklist(imeis[0], opts.imeiCfg || {});
  step('Estado de seguridad…'); const sec = await security(serial, rooted);
  return { serial, at: Date.now(), system: sys, battery: bat, imeis, imeiAnalysis, blacklist: bl.status, blacklistRaw: bl, security: sec };
}

module.exports = { full, isRooted, battery, system, imei, security };
