'use strict';
/*
 * OptiCert — generación del certificado.
 *  - Firma Ed25519 del contenido (antifalsificable, gratis, instantáneo).
 *  - QR que enlaza a la verificación (id + firma) — verificable con la clave pública.
 *  - Plantilla HTML lista para exportar a PDF (lo hace main vía printToPDF).
 * La clave privada vive solo en tu equipo (userData). La pública se publica para verificar.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QR = require('qrcode');

let KEYS = null;
let KEYFILE = '';
function initKeys(userData) {
  KEYFILE = path.join(userData, 'opticert-keys.json');
  try { KEYS = JSON.parse(fs.readFileSync(KEYFILE, 'utf8')); }
  catch (_) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    KEYS = { publicKey, privateKey, created: Date.now() };
    try { fs.writeFileSync(KEYFILE, JSON.stringify(KEYS, null, 2)); } catch (__) {}
  }
  return KEYS;
}
function pubKeyShort() { return crypto.createHash('sha256').update(KEYS.publicKey).digest('hex').slice(0, 16); }

function blLabel(s) { return ({ listed: '⛔ EN LISTA NEGRA (robado/bloqueado)', clean: '✓ limpio (no en lista negra)', pendiente: 'pendiente (configura clave API)', error: 'error de consulta', desconocido: 'no concluyente', 'sin-imei': 'sin IMEI' }[s] || s || 'no verificado'); }

function canonical(obj) {
  const sort = (o) => Array.isArray(o) ? o.map(sort) : (o && typeof o === 'object' ? Object.keys(o).sort().reduce((a, k) => (a[k] = sort(o[k]), a), {}) : o);
  return JSON.stringify(sort(obj));
}
function sign(payload) { return crypto.sign(null, Buffer.from(canonical(payload)), KEYS.privateKey).toString('base64'); }
function verify(payload, signature) { try { return crypto.verify(null, Buffer.from(canonical(payload)), KEYS.publicKey, Buffer.from(signature, 'base64')); } catch (_) { return false; } }

/** Construye el objeto certificado + firma + QR + HTML. */
async function build(diag, grade, meta = {}) {
  const id = 'OC-' + new Date(diag.at || Date.now()).toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const cert = {
    id, issuedAt: Date.now(),
    shop: meta.shop || 'OptiSuite', technician: meta.technician || '',
    device: { brand: diag.system.brand, model: diag.system.model, android: diag.system.android, storage: diag.system.storage, ram: diag.system.ramGB, screen: diag.system.screen, serial: diag.system.serialno },
    imeis: diag.imeis || [],
    battery: { healthPct: diag.battery.healthPct, capacityNow: diag.battery.capacityNow, capacityDesign: diag.battery.capacityDesign, cycles: diag.battery.cycles, temp: diag.battery.temp, status: diag.battery.health },
    thermal: diag.thermal ? `${diag.thermal.verdict} (máx ${diag.thermal.max != null ? diag.thermal.max.toFixed(1) + '°C' : '?'}, Δ${diag.thermal.delta != null ? diag.thermal.delta + '°C' : '?'})` : null,
    security: { rooted: diag.security.rooted, frp: diag.security.frp, encrypted: diag.security.encrypted },
    imeiValid: (diag.imeiAnalysis || []).length ? (diag.imeiAnalysis.every((a) => a.valid) ? 'sí (Luhn ✓)' : 'NO — posible IMEI falso') : 'n/d',
    wiped: !!diag.wiped, wipeVideo: !!diag.wipeVideo, blacklist: blLabel(diag.blacklist),
    functional: diag.functional ? { ok: (diag.functional.pass || []).length, fail: diag.functional.fail || [] } : null,
    grade: grade.grade, gradeLabel: grade.label, readyToSell: grade.readyToSell, flags: grade.flags,
  };
  const signature = sign(cert);
  const verifyUrl = `https://optisuite.app/cert?id=${encodeURIComponent(id)}&k=${pubKeyShort()}`;
  const qr = await QR.toDataURL(verifyUrl, { margin: 1, width: 220, color: { dark: '#0b1020', light: '#ffffff' } });
  const html = render(cert, signature, qr, verifyUrl);
  return { cert, signature, pubKey: KEYS.publicKey, verifyUrl, qr, html };
}

function row(k, v) { return v == null || v === '' ? '' : `<tr><td class="k">${k}</td><td class="v">${esc(v)}</td></tr>`; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function render(c, sig, qr, url) {
  const gColor = { A: '#19c37d', B: '#3b82f6', C: '#f59e0b', D: '#ef4444' }[c.grade] || '#64748b';
  const flags = (c.flags || []).map((f) => `<li style="color:${f.level === 'bad' ? '#dc2626' : f.level === 'warn' ? '#b45309' : '#475569'}">${esc(f.msg)}</li>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;font-family:Segoe UI,Arial,sans-serif}
  body{margin:0;color:#0f172a;background:#fff}
  .page{width:780px;margin:0 auto;padding:34px 40px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${gColor};padding-bottom:14px}
  .brand{font-size:24px;font-weight:800}.brand span{color:#7c5cff}
  .brand small{display:block;font-size:12px;color:#64748b;font-weight:500}
  .cid{text-align:right;font-size:12px;color:#475569}.cid b{font-size:14px;color:#0f172a}
  .grade{display:flex;align-items:center;gap:16px;margin:18px 0;padding:16px 20px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc}
  .gbadge{width:74px;height:74px;border-radius:16px;background:${gColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:800}
  .gtext .l{font-size:20px;font-weight:700}.gtext .s{color:#64748b;font-size:13px}
  .ready{margin-left:auto;font-weight:700;padding:6px 14px;border-radius:20px;${c.readyToSell ? 'background:#dcfce7;color:#15803d' : 'background:#fee2e2;color:#b91c1c'}}
  .cols{display:flex;gap:24px;margin-top:6px}
  table{border-collapse:collapse;width:100%}td{padding:5px 6px;font-size:13px;border-bottom:1px solid #f1f5f9}
  td.k{color:#64748b;width:46%}td.v{font-weight:600}
  h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin:16px 0 6px}
  .qr{text-align:center}.qr img{width:150px}.qr .u{font-size:10px;color:#64748b;word-break:break-all}
  .flags{font-size:12px;margin:6px 0 0;padding-left:18px}
  .foot{margin-top:22px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:11px;color:#64748b}
  .sig{font:10px/1.4 Consolas,monospace;color:#94a3b8;word-break:break-all;margin-top:6px}
  </style></head><body><div class="page">
    <div class="top">
      <div class="brand">🔎 Opti<span>Cert</span><small>Certificado de diagnóstico de dispositivo · ${esc(c.shop)}</small></div>
      <div class="cid">Certificado<br><b>${esc(c.id)}</b><br>${new Date(c.issuedAt).toLocaleString('es-ES')}${c.technician ? '<br>Técnico: ' + esc(c.technician) : ''}</div>
    </div>
    <div class="grade">
      <div class="gbadge">${esc(c.grade)}</div>
      <div class="gtext"><div class="l">Grado ${esc(c.grade)} · ${esc(c.gradeLabel)}</div><div class="s">Salud de batería: <b>${c.battery.healthPct != null ? c.battery.healthPct + '%' : 'n/d'}</b></div></div>
      <div class="ready">${c.readyToSell ? '✓ Listo para vender' : '⚠ Revisar'}</div>
    </div>
    <div class="cols">
      <div style="flex:1">
        <h3>Dispositivo</h3>
        <table>${row('Marca', c.device.brand)}${row('Modelo', c.device.model)}${row('Android', c.device.android)}${row('Almacenamiento', c.device.storage)}${row('RAM', c.device.ram ? c.device.ram + ' GB' : '')}${row('Pantalla', c.device.screen)}${row('IMEI', (c.imeis || []).join('  '))}</table>
        <h3>Batería</h3>
        <table>${row('Salud real', c.battery.healthPct != null ? c.battery.healthPct + ' %' : 'n/d (sin root)')}${row('Capacidad actual', c.battery.capacityNow ? c.battery.capacityNow + ' mAh' : '')}${row('Capacidad de fábrica', c.battery.capacityDesign ? c.battery.capacityDesign + ' mAh' : '')}${row('Ciclos', c.battery.cycles)}${row('Temperatura', c.battery.temp ? c.battery.temp.toFixed(1) + ' °C' : '')}${row('Estado', c.battery.status)}${row('Test térmico', c.thermal)}</table>
        <h3>Seguridad</h3>
        <table>${row('IMEI válido (Luhn)', c.imeiValid)}${row('Estado IMEI / blacklist', c.blacklist)}${row('Cuenta vinculada (FRP)', c.security.frp)}${row('Datos borrados', c.wiped ? (c.wipeVideo ? 'Sí — vídeo de prueba adjunto' : 'Sí (certificado)') : 'No')}${row('Cifrado', c.security.encrypted ? 'Sí' : 'No')}${c.functional ? row('Pruebas funcionales', `${c.functional.ok} superadas${c.functional.fail.length ? ' · fallos: ' + c.functional.fail.join(', ') : ''}`) : ''}</table>
        ${flags ? `<h3>Observaciones</h3><ul class="flags">${flags}</ul>` : ''}
      </div>
      <div class="qr">
        <h3>Verificación</h3>
        <img src="${qr}"><div class="u">${esc(url)}</div>
        <div style="font-size:11px;color:#475569;margin-top:6px">Escanea para verificar la autenticidad de este certificado.</div>
      </div>
    </div>
    <div class="foot">
      Certificado emitido por ${esc(c.shop)} bajo su responsabilidad, a partir de pruebas de software del propio dispositivo. No constituye garantía salvo la que ofrezca el vendedor. Datos únicamente del equipo; no se recogen datos personales.
      <div class="sig">Firma Ed25519: ${esc(sig)}</div>
    </div>
  </div></body></html>`;
}

module.exports = { initKeys, build, sign, verify, canonical, pubKey: () => KEYS && KEYS.publicKey };
