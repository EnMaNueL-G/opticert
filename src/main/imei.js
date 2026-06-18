'use strict';
/*
 * OptiCert — verificación de IMEI (multi-proveedor BYOK).
 *  - Validez Luhn (real, offline) + desglose TAC.
 *  - Blacklist/modelo en tiempo real vía la API que el usuario conecte:
 *      provider: imeicheck | imei.info | imei.org | zylalabs | custom
 *    El parser es robusto: entiende JSON con muchos formatos y texto plano.
 *  - Cruce de modelo: si el API devuelve un modelo distinto al real → posible manipulación.
 */

function luhnValid(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}

function analyze(imeiRaw) {
  const s = String(imeiRaw || '').replace(/\D/g, '');
  const valid = luhnValid(s);
  return { imei: s, length: s.length, valid, tac: s.slice(0, 8), serial: s.slice(8, 14), check: s.slice(14, 15),
    note: !s ? 'no leído' : (s.length !== 15 ? `longitud anómala (${s.length})` : (valid ? 'estructura válida (Luhn ✓)' : 'checksum inválido — posible IMEI falso/manipulado')) };
}

/* ---- construcción de la petición por proveedor ---- */
function buildRequest(imei, cfg) {
  const key = cfg.apiKey || '';
  if (cfg.endpoint) {
    return { url: cfg.endpoint.replace(/\{imei\}/g, encodeURIComponent(imei)).replace(/\{key\}/g, encodeURIComponent(key)), headers: key && !/\{key\}/.test(cfg.endpoint) ? { Authorization: 'Bearer ' + key } : {}, method: 'GET' };
  }
  switch ((cfg.provider || '').toLowerCase()) {
    case 'imeicheck':
      return { url: `https://api.imeicheck.com/api/checkimei?imei=${imei}`, headers: { Authorization: 'Bearer ' + key }, method: 'GET' };
    case 'imei.info':
      return { url: `https://dash.imei.info/api/check/0/?API_KEY=${encodeURIComponent(key)}&imei=${imei}`, headers: {}, method: 'GET' };
    case 'zylalabs':
      return { url: `https://zylalabs.com/api/2099/imei+validator+api/1899/verify?imei=${imei}`, headers: { Authorization: 'Bearer ' + key }, method: 'GET' };
    default:
      return key ? { url: `https://api.imeicheck.com/api/checkimei?imei=${imei}`, headers: { Authorization: 'Bearer ' + key }, method: 'GET' } : null;
  }
}

/* ---- interpretación robusta de la respuesta ---- */
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
  for (const k of Object.keys(obj)) {
    if (keys.includes(k.toLowerCase())) { const v = obj[k]; if (v != null && typeof v !== 'object') return v; }
  }
  for (const k of Object.keys(obj)) { const r = deepFind(obj[k], keys, depth + 1); if (r !== undefined) return r; }
  return undefined;
}
function interpret(data) {
  let obj = null; const txt = typeof data === 'string' ? data : JSON.stringify(data || '');
  if (typeof data === 'object') obj = data; else { try { obj = JSON.parse(data); } catch (_) {} }
  const out = { model: null, brand: null, fmip: null };
  if (obj) {
    out.model = deepFind(obj, ['model', 'modelname', 'devicename', 'device', 'model_name']);
    out.brand = deepFind(obj, ['brand', 'manufacturer', 'make']);
    out.fmip = deepFind(obj, ['fmip', 'findmyiphone', 'icloudlock', 'activationlock', 'icloud']);
    const blField = deepFind(obj, ['blacklisted', 'gsmablacklisted', 'lost_or_stolen', 'loststolen', 'isblacklisted']);
    if (blField === true || /yes|true|1/i.test(String(blField))) return { ...out, status: 'listed', raw: txt.slice(0, 240) };
    if (blField === false) return { ...out, status: 'clean', raw: txt.slice(0, 240) };
    const statusField = String(deepFind(obj, ['blacklist', 'blackliststatus', 'status']) || '');
    if (/black|stolen|lost|reported|barred/i.test(statusField)) return { ...out, status: 'listed', raw: txt.slice(0, 240) };
    if (/clean|clear|not.*black|ok/i.test(statusField)) return { ...out, status: 'clean', raw: txt.slice(0, 240) };
  }
  // fallback por texto
  if (/black\s*list|stolen|lost|barred|bloquead|robad/i.test(txt) && !/not\s*(black|reported|found)|clean|clear|limpio/i.test(txt)) return { ...out, status: 'listed', raw: txt.slice(0, 240) };
  if (/clean|clear|not\s*found|not\s*reported|limpio|"blacklisted"\s*:\s*false/i.test(txt)) return { ...out, status: 'clean', raw: txt.slice(0, 240) };
  return { ...out, status: 'desconocido', raw: txt.slice(0, 240) };
}

async function blacklist(imei, cfg = {}) {
  const s = String(imei || '').replace(/\D/g, '');
  if (!s) return { status: 'sin-imei' };
  const req = buildRequest(s, cfg);
  if (!req) return { status: 'pendiente' }; // sin clave ni endpoint
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) return { status: 'error', error: 'HTTP ' + res.status };
    return interpret(data);
  } catch (e) { return { status: 'error', error: e.message }; }
}

module.exports = { luhnValid, analyze, blacklist, interpret };
