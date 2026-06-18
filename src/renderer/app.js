'use strict';
const $ = (s) => document.querySelector(s);
let DATA = {}, current = null;
const C = 2 * Math.PI * 50; // circunferencia del arco (r=50)

const GAUGES = [
  { id: 'bat', label: 'Salud batería', unit: '%', max: 100 },
  { id: 'temp', label: 'Temperatura', unit: '°', max: 50 },
  { id: 'cyc', label: 'Ciclos', unit: '', max: 1000 },
];

(async function init() {
  buildGauges();
  DATA = await window.opti.init();
  document.title = 'OptiCert v' + DATA.version;
  $('#adbPill').textContent = DATA.adbOk ? 'ADB ✓' : 'ADB ✗';
  $('#adbPill').style.color = DATA.adbOk ? 'var(--em)' : 'var(--warn)';
  const s = DATA.settings || {};
  $('#setShop').value = s.shop || ''; $('#setTech').value = s.technician || '';
  $('#setImeiKey').value = s.imeiApiKey || ''; $('#setImeiUrl').value = s.imeiEndpoint || ''; $('#setImeiProv').value = s.imeiProvider || '';
  await refresh();
  window.opti.onStep((m) => tick(m));
})();

function buildGauges() {
  $('#gauges').innerHTML = GAUGES.map((g) => `
    <div class="gauge">
      <svg viewBox="0 0 120 120">
        <circle class="track" cx="60" cy="60" r="50" fill="none" stroke-width="10"/>
        <circle class="arc" id="arc-${g.id}" cx="60" cy="60" r="50" fill="none" stroke="#10b981" stroke-width="10"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" transform="rotate(-90 60 60)"/>
      </svg>
      <div class="val" id="val-${g.id}">—</div><div class="lab">${g.label}</div>
    </div>`).join('');
}
function setGauge(id, value, frac, color) {
  const arc = $('#arc-' + id), val = $('#val-' + id);
  if (!arc) return;
  arc.style.stroke = color;
  arc.style.strokeDashoffset = (C * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1);
  // count-up
  const target = value, t0 = performance.now();
  (function step(t) { const k = Math.min(1, (t - t0) / 900); val.textContent = Math.round(target * k) + (id === 'temp' ? '°' : id === 'bat' ? '%' : ''); if (k < 1) requestAnimationFrame(step); else val.textContent = (value == null ? '—' : value) + (value != null ? (id === 'temp' ? '°' : id === 'bat' ? '%' : '') : ''); })(t0);
}

async function refresh() {
  const d = await window.opti.devices();
  const list = (d.list || []).filter((x) => x.state === 'device');
  $('#device').innerHTML = list.length ? list.map((x) => `<option value="${x.serial}">${x.model ? x.model + ' · ' : ''}${x.serial}</option>`).join('') : '<option value="">— sin dispositivos —</option>';
}
$('#refresh').onclick = refresh;

function tick(m) { $('#ticker').textContent = '› ' + m; }

$('#diagBtn').onclick = async () => {
  const serial = $('#device').value; if (!serial) return tick('Conecta un móvil primero');
  $('#diagBtn').disabled = true; $('#diagBtn').textContent = '⏳ Escaneando…';
  $('#cockpit').classList.remove('idle'); $('#phone').classList.remove('done'); $('#phone').classList.add('scanning');
  $('#seal').classList.remove('stamped'); $('#sealLetter').textContent = '…'; $('#genBtn').disabled = true; $('#certOut').style.display = 'none';
  const r = await window.opti.diagnose(serial);
  $('#diagBtn').disabled = false; $('#diagBtn').textContent = '▶ Escanear dispositivo';
  $('#phone').classList.remove('scanning');
  if (!r.ok) { tick('Error: ' + r.error); return; }
  current = r; renderResult(r.diag, r.grade);
};

function colorBat(p) { return p == null ? 'var(--mut)' : p >= 90 ? '#10b981' : p >= 80 ? '#34d399' : p >= 70 ? '#f59e0b' : '#ef4444'; }
function colorTemp(t) { return t == null ? 'var(--mut)' : t < 35 ? '#10b981' : t <= 40 ? '#f59e0b' : '#ef4444'; }
function colorCyc(c) { return c == null ? 'var(--mut)' : c < 400 ? '#10b981' : c < 800 ? '#f59e0b' : '#ef4444'; }

function renderResult(diag, g) {
  const s = diag.system, b = diag.battery;
  $('#phone').classList.add('done');
  $('#devName').textContent = `${s.brand || ''} ${s.model || ''}`.trim() || 'Dispositivo';
  const imei = (diag.imeis || [])[0] || '';
  $('#devImei').textContent = 'IMEI ' + (imei || '—');
  const an = (diag.imeiAnalysis || [])[0];
  const fl = $('#imeiFlag');
  if (an && an.imei) { fl.style.display = ''; fl.className = 'imei-flag ' + (an.valid ? 'ok' : 'bad'); fl.textContent = an.valid ? '✓ IMEI válido (Luhn) · ' + blShort(diag.blacklist) : '⚠ IMEI inválido — posible manipulación'; }
  else fl.style.display = 'none';
  $('#devSpecs').innerHTML = `<div style="color:var(--mut)">Android ${esc(s.android || '?')} · ${esc(s.screen || '')}</div>`;

  // gauges
  setGauge('bat', b.healthPct, (b.healthPct || 0) / 100, colorBat(b.healthPct));
  setGauge('temp', b.temp != null ? Math.round(b.temp) : null, (b.temp || 0) / 50, colorTemp(b.temp));
  setGauge('cyc', b.cycles, (b.cycles || 0) / 1000, colorCyc(b.cycles));
  if (b.healthPct == null) $('#val-bat').textContent = 'n/d';
  if (b.cycles == null) $('#val-cyc').textContent = 'n/d';

  // tiles
  $('#tiles').innerHTML = [
    ['RAM', s.ramGB ? s.ramGB + ' GB' : '—'], ['Almacén', s.storage || '—'],
    ['Capacidad', b.capacityNow ? b.capacityNow + ' mAh' : (b.capacityDesign ? b.capacityDesign + ' mAh' : '—')], ['Root', diag.security.rooted ? 'sí' : 'no'],
  ].map(([l, n]) => `<div class="tile"><div class="n">${esc(n)}</div><div class="l">${l}</div></div>`).join('');

  // seal
  const seal = $('#seal'); seal.querySelector('.ring').style.borderColor = g.color;
  $('#sealLetter').textContent = g.grade; $('#sealLetter').style.color = g.color;
  void seal.offsetWidth; seal.classList.add('stamped');
  $('#gLabel').textContent = `Grado ${g.grade} · ${g.label}`;
  const rd = $('#ready'); rd.style.display = ''; rd.className = 'ready ' + (g.readyToSell ? 'yes' : 'no'); rd.textContent = g.readyToSell ? '✓ LISTO PARA VENDER' : '⚠ REVISAR ANTES DE VENDER';
  $('#flags').innerHTML = (g.flags || []).map((f) => `<li class="${f.level}">${esc(f.msg)}</li>`).join('') || '<li class="info">Sin observaciones.</li>';
  $('#genBtn').disabled = false;
  $('#vactions').style.display = 'flex';
  tick(`Escaneo completo · Grado ${g.grade}`);
}
let lastCertId = '';

function blShort(s) { return ({ clean: 'limpio', listed: 'EN LISTA NEGRA', pendiente: 'blacklist: añade clave', error: 'blacklist: error', desconocido: 'blacklist: n/c' }[s] || ''); }

$('#genBtn').onclick = async () => {
  if (!current) return;
  const diag = { ...current.diag, wiped: $('#wiped').checked };
  $('#genBtn').disabled = true; $('#genBtn').textContent = '⏳ Emitiendo…';
  const r = await window.opti.generate({ diag, grade: current.grade, meta: {} });
  $('#genBtn').disabled = false; $('#genBtn').textContent = '📜 Emitir certificado';
  if (!r.ok) { tick('Error: ' + r.error); return; }
  const o = $('#certOut'); o.style.display = '';
  if (r.saved === false) { tick('Guardado cancelado — no se guardó ningún archivo.'); return; }
  o.innerHTML = `✅ ${esc(r.cert.id)} guardado · <a href="#" id="openCert">abrir PDF</a>`;
  $('#openCert').onclick = (e) => { e.preventDefault(); window.opti.openPath(r.path); };
  lastCertId = r.cert.id;
  tick('Certificado guardado: ' + r.path);
};

/* WiFi-ADB (por si el cable falla) */
$('#wifiBtn').onclick = async () => {
  const serial = $('#device').value; if (!serial) return tick('Elige un equipo primero');
  tick('Activando WiFi-ADB…');
  const r = await window.opti.adbWifi(serial);
  if (r.ok) { tick(r.already ? 'Ese equipo ya está por WiFi.' : `📶 WiFi-ADB activo (${r.serial}). ${r.note || ''}`); await refresh(); }
  else tick('WiFi-ADB: ' + (r.error || 'falló'));
};

/* pruebas funcionales */
const FUNC_ITEMS = [
  { k: 'camara', name: 'Cámaras', auto: true, trig: 'camera' },
  { k: 'linterna', name: 'Linterna (flash)', auto: true },
  { k: 'sensores', name: 'Sensores', auto: true },
  { k: 'carga', name: 'Carga', auto: true },
  { k: 'conect', name: 'WiFi / Bluetooth', auto: true, trig: 'net' },
  { k: 'botones', name: 'Botones físicos', trig: 'buttons' },
  { k: 'micro', name: 'Micrófono', hint: 'graba una nota de voz y escúchala' },
  { k: 'altavoz', name: 'Altavoz', hint: 'reproduce un audio en el móvil' },
  { k: 'auricular', name: 'Auricular (llamada)', hint: 'pruébalo en una llamada' },
  { k: 'tactil', name: 'Pantalla táctil', hint: 'usa la consola: input swipe' },
  { k: 'vibra', name: 'Vibración', trig: 'vibrate' },
];
let funcState = {}, funcAuto = {};
$('#funcBtn').onclick = async () => {
  if (!current) return;
  $('#mfunc').classList.add('show');
  $('#funcList').innerHTML = '<div style="color:var(--mut);padding:10px">Auto-verificando hardware por software…</div>';
  funcState = (current.diag.functional && current.diag.functional.state) ? { ...current.diag.functional.state } : {};
  const d = await window.opti.funcDetect(current.diag.serial); funcAuto = d.ok ? d.auto : {};
  // pre-marca lo auto-verificable (sin tocar el teléfono)
  for (const it of FUNC_ITEMS) { if (it.auto && funcAuto[it.k] && funcState[it.k] == null) funcState[it.k] = funcAuto[it.k].ok ? 'ok' : 'no'; }
  renderFunc();
};
function renderFunc() {
  $('#funcList').innerHTML = FUNC_ITEMS.map((it) => {
    const a = funcAuto[it.k];
    let hint = it.hint || '';
    if (it.auto && a) hint = (a.info || '') + (a.ok ? ' · auto-verificado ✓' : '');
    const st = funcState[it.k];
    const labels = { vibrate: 'Vibrar', camera: '📷 Ver cámara', net: '📶 Ver en vivo', buttons: '⌨ Probar pulsando' };
    const trig = it.trig ? `<button class="ftrig" data-trig="${it.trig}">${labels[it.trig] || 'Probar'}</button>` : '';
    const badge = it.auto ? '<span class="fhint" style="color:var(--cy)">auto</span>' : '';
    return `<div class="frow"><div class="fname">${esc(it.name)} ${badge}<div class="fhint">${esc(hint)}</div></div>${trig}<div class="fmark"><button class="ok ${st === 'ok' ? 'on' : ''}" data-k="${it.k}" data-v="ok">✓</button><button class="no ${st === 'no' ? 'on' : ''}" data-k="${it.k}" data-v="no">✗</button></div></div>`;
  }).join('');
  $('#funcList').querySelectorAll('[data-trig]').forEach((b) => b.onclick = async () => {
    const t = b.dataset.trig;
    if (t === 'vibrate') { const r = await window.opti.funcVibrate(current.diag.serial); tick(r.note); return; }
    if (t === 'camera') return openCamPreview();
    if (t === 'net') return openNet();
    if (t === 'buttons') return openButtons();
  });
  $('#funcList').querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { funcState[b.dataset.k] = (funcState[b.dataset.k] === b.dataset.v) ? null : b.dataset.v; renderFunc(); updateFuncSummary(); });
  updateFuncSummary();
}
function updateFuncSummary() {
  const ok = Object.values(funcState).filter((v) => v === 'ok').length;
  const no = Object.values(funcState).filter((v) => v === 'no').length;
  $('#funcSummary').textContent = `${ok} OK · ${no} fallo(s) · ${FUNC_ITEMS.length - ok - no} sin probar`;
}
$('#funcClose').onclick = () => $('#mfunc').classList.remove('show');
$('#funcSave').onclick = () => {
  const pass = FUNC_ITEMS.filter((it) => funcState[it.k] === 'ok').map((it) => it.name);
  const fail = FUNC_ITEMS.filter((it) => funcState[it.k] === 'no').map((it) => it.name);
  current.diag.functional = { pass, fail, state: { ...funcState } };
  current.grade.flags = (current.grade.flags || []).filter((f) => !/prueba funcional|fallo funcional/i.test(f.msg));
  if (fail.length) current.grade.flags.push({ level: 'bad', msg: 'Fallo funcional: ' + fail.join(', ') });
  else if (pass.length) current.grade.flags.push({ level: 'info', msg: `Pruebas funcionales: ${pass.length} superadas` });
  $('#flags').innerHTML = current.grade.flags.map((f) => `<li class="${f.level}">${esc(f.msg)}</li>`).join('');
  $('#mfunc').classList.remove('show'); tick(`Funcional: ${pass.length} OK, ${fail.length} fallo(s)`);
};

/* grabar borrado (RGPD) — OptiCert SOLO graba, no ejecuta el reset */
$('#wipeBtn').onclick = async () => {
  if (!current) return;
  if (!confirm('Se grabará la pantalla 20s como prueba de borrado.\nDurante la grabación, realiza tú el restablecimiento de fábrica en el móvil.\n\n¿Empezar a grabar?')) return;
  $('#wipeBtn').disabled = true; $('#wipeBtn').textContent = '🔴 Grabando 20s…';
  const r = await window.opti.wipeRecord({ serial: current.diag.serial, seconds: 20 });
  $('#wipeBtn').disabled = false; $('#wipeBtn').textContent = '🎥 Grabar borrado';
  if (!r.ok) { tick('Grabación falló: ' + (r.error || '')); return; }
  $('#wiped').checked = true; current.diag.wipeVideo = r.path;
  tick('Borrado grabado (' + Math.round(r.size / 1024) + ' KB) — adjunto al certificado');
};

/* cámara en vivo dentro de la herramienta */
let camTimer = null, camRunning = false;
async function openCamPreview() {
  if (!current) return;
  $('#mcam').classList.add('show');
  await window.opti.funcCamera({ serial: current.diag.serial });
  if (!camRunning) { camRunning = true; camLoop(); }   // un único bucle continuo
}
async function camLoop() {
  if (!$('#mcam').classList.contains('show') || !current) { camRunning = false; return; }
  const r = await window.opti.funcCamFrame(current.diag.serial);
  if (r.ok) $('#camImg').src = r.data;
  camTimer = setTimeout(camLoop, 120);   // continuo: tan rápido como permite el screencap (~1-2 fps)
}
$('#camClose').onclick = () => { $('#mcam').classList.remove('show'); camRunning = false; clearTimeout(camTimer); };

/* WiFi/Bluetooth en vivo (gráfico de señal en tiempo real) */
let netTimer = null, netHist = [];
async function openNet() {
  if (!current) return;
  netHist = []; $('#mnet').classList.add('show');
  netLoop();
}
async function netLoop() {
  if (!$('#mnet').classList.contains('show') || !current) return;
  const r = await window.opti.netSample(current.diag.serial);
  if (r.ok) {
    const n = r.net;
    netHist.push(n.rssi != null ? n.rssi : -100); if (netHist.length > 40) netHist.shift();
    drawNet();
    const bars = n.rssi == null ? '—' : n.rssi >= -55 ? '▮▮▮▮ excelente' : n.rssi >= -67 ? '▮▮▮ buena' : n.rssi >= -78 ? '▮▮ regular' : '▮ débil';
    $('#netInfo').innerHTML = `<b>📶 WiFi:</b> ${n.wifiOn ? 'encendido' : 'apagado'} ${n.ssid ? '· red <b>' + esc(n.ssid) + '</b>' : ''}<br>
      Señal: <b>${n.rssi != null ? n.rssi + ' dBm' : 'n/d'}</b> (${bars}) · Velocidad: ${n.link || '?'} Mbps<br>
      Tráfico: ↑${(n.tx || 0).toFixed(1)} / ↓${(n.rx || 0).toFixed(1)} paq/s · Redes detectadas: ${n.networks != null ? n.networks : '?'}<br>
      <b>📶 Bluetooth:</b> ${n.btEnabled ? 'encendido' : 'apagado/BLE'} ${n.btName ? '· ' + esc(n.btName) : ''} · emparejados: ${n.btBonded || 0}`;
  }
  netTimer = setTimeout(netLoop, 1500);
}
function drawNet() {
  const svg = $('#netChart'); if (!svg) return;
  const W = 520, H = 150, lo = -100, hi = -30;
  const y = (v) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
  const grid = [-50, -70, -85].map((v) => `<line x1="0" y1="${y(v).toFixed(0)}" x2="${W}" y2="${y(v).toFixed(0)}" stroke="rgba(120,200,170,.15)"/><text x="4" y="${(y(v) - 3).toFixed(0)}" fill="#7fa99c" font-size="10">${v}dBm</text>`).join('');
  const step = netHist.length > 1 ? W / (netHist.length - 1) : W;
  const pts = netHist.map((v, i) => `${(i * step).toFixed(0)},${y(v).toFixed(0)}`).join(' ');
  const last = netHist[netHist.length - 1];
  const col = last >= -67 ? '#10b981' : last >= -78 ? '#f59e0b' : '#ef4444';
  svg.innerHTML = grid + `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
}
$('#netClose').onclick = () => { $('#mnet').classList.remove('show'); clearTimeout(netTimer); };

/* Botones físicos: se marcan al pulsarlos (getevent en vivo) */
const BTN_DEFS = [{ k: 'VOLUMEUP', n: 'Volumen +' }, { k: 'VOLUMEDOWN', n: 'Volumen −' }, { k: 'POWER', n: 'Encendido' }];
let btnPressed = {};
window.opti.onButton((k) => {
  if (!$('#mbtn').classList.contains('show')) return;
  btnPressed[k] = true; renderButtons();
});
async function openButtons() {
  if (!current) return;
  btnPressed = {}; $('#mbtn').classList.add('show'); renderButtons();
  await window.opti.buttonsListen(current.diag.serial);
}
function renderButtons() {
  $('#btnList').innerHTML = BTN_DEFS.map((b) => `<div class="frow" style="${btnPressed[b.k] ? 'border-color:var(--em);background:rgba(16,185,129,.15)' : ''}"><div class="fname">${b.n}</div><div style="font-weight:700;color:${btnPressed[b.k] ? 'var(--em)' : 'var(--mut)'}">${btnPressed[b.k] ? '✓ pulsado' : 'pulsa el botón…'}</div></div>`).join('');
  const done = BTN_DEFS.every((b) => btnPressed[b.k]);
  $('#btnSummary').textContent = done ? '✓ Todos los botones responden' : `${Object.keys(btnPressed).length}/${BTN_DEFS.length} detectados`;
  if (done && current) { current.diag.functional = current.diag.functional || { pass: [], fail: [], state: {} }; }
}
$('#btnClose').onclick = () => { $('#mbtn').classList.remove('show'); window.opti.buttonsStop(); };
$('#btnMark').onclick = () => {
  const ok = BTN_DEFS.every((b) => btnPressed[b.k]);
  funcState.botones = ok ? 'ok' : 'no';
  if (current.diag.functional && current.diag.functional.state) current.diag.functional.state.botones = funcState.botones;
  $('#mbtn').classList.remove('show'); window.opti.buttonsStop(); tick('Botones: ' + (ok ? 'todos OK' : 'incompletos'));
};

/* consola ADB (ejecutar comandos / probar táctil) */
$('#consoleBtn').onclick = () => $('#mcon').classList.add('show');
$('#conClose').onclick = () => $('#mcon').classList.remove('show');
$('#conRun').onclick = runCon;
$('#conInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runCon(); });
document.querySelectorAll('[data-cmd]').forEach((b) => b.onclick = () => { $('#conInput').value = b.dataset.cmd; runCon(); });
async function runCon() {
  const serial = $('#device').value; if (!serial) { $('#conOut').textContent = 'Elige un equipo primero.'; return; }
  const cmd = $('#conInput').value.trim(); if (!cmd) return;
  $('#conOut').textContent = '$ ' + cmd + '\n…ejecutando';
  const r = await window.opti.adbExec({ serial, cmd });
  $('#conOut').textContent = '$ ' + cmd + '\n' + (r.ok ? r.out : 'ERROR: ' + r.error);
}

/* test de estrés térmico con gráfico en vivo */
let thReadings = [], thSeconds = 60;
window.opti.onThermal((r) => {
  thReadings.push(r); drawTherm();
  $('#thNow').textContent = r.temp.toFixed(1) + '°C · ' + r.elapsed + 's';
  $('#thMax').textContent = 'máx ' + r.max.toFixed(1) + '°C';
  setGauge('temp', Math.round(r.temp), r.temp / 50, colorTemp(r.temp));
});
function drawTherm() {
  const svg = $('#thermChart'); if (!svg) return;
  const W = 520, H = 180, tmin = 20, tmax = 50;
  const x = (e) => (Math.min(e, thSeconds) / thSeconds) * W;
  const y = (t) => H - ((Math.max(tmin, Math.min(tmax, t)) - tmin) / (tmax - tmin)) * H;
  const grid = [30, 40, 45].map((t) => `<line x1="0" y1="${y(t).toFixed(0)}" x2="${W}" y2="${y(t).toFixed(0)}" stroke="rgba(120,200,170,.15)"/><text x="5" y="${(y(t) - 3).toFixed(0)}" fill="#7fa99c" font-size="10">${t}°</text>`).join('');
  const pts = thReadings.map((r) => `${x(r.elapsed).toFixed(0)},${y(r.temp).toFixed(0)}`).join(' ');
  const last = thReadings[thReadings.length - 1]; const col = last ? colorTemp(last.temp) : '#10b981';
  svg.innerHTML = grid + `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5"/>` + (last ? `<circle cx="${x(last.elapsed).toFixed(0)}" cy="${y(last.temp).toFixed(0)}" r="4" fill="${col}"/>` : '');
}
$('#thermBtn').onclick = async () => {
  if (!current) return;
  if (!confirm('Se cargará la CPU del móvil ~60s para medir cómo sube la temperatura. ¿Empezar?')) return;
  thReadings = []; thSeconds = 60; drawTherm();
  $('#thNow').textContent = '—'; $('#thMax').textContent = 'máx —';
  $('#thermStatus').textContent = 'Cargando todos los núcleos y midiendo… (~60s)';
  $('#mtherm').classList.add('show');
  const r = await window.opti.thermalTest({ serial: current.diag.serial, seconds: thSeconds });
  if (!r.ok) { $('#thermStatus').textContent = 'Error: ' + r.error; return; }
  const t = r.thermal; current.diag.thermal = t;
  $('#thermStatus').innerHTML = `Veredicto: <b style="color:${t.color}">${esc(t.verdict)}</b> · inicio ${fmtT(t.start)} → máx ${fmtT(t.max)} (Δ${t.delta != null ? t.delta : '?'}°C)`;
  const lvl = /Sobre/.test(t.verdict) ? 'bad' : /calienta/.test(t.verdict) ? 'warn' : 'info';
  current.grade.flags = (current.grade.flags || []).filter((f) => !/térmic|disipac|calienta|sobrecalent/i.test(f.msg));
  current.grade.flags.push({ level: lvl, msg: `Test térmico: ${t.verdict} (máx ${fmtT(t.max)}, Δ${t.delta}°C)` });
  $('#flags').innerHTML = current.grade.flags.map((f) => `<li class="${f.level}">${esc(f.msg)}</li>`).join('');
  tick('Test térmico: ' + t.verdict);
};
$('#thermClose').onclick = () => $('#mtherm').classList.remove('show');
function fmtT(t) { return t != null ? t.toFixed(1) + '°C' : 'n/d'; }

/* anuncio marketplace */
$('#listBtn').onclick = async () => {
  if (!current) return;
  const r = await window.opti.listingBuild({ diag: current.diag, grade: current.grade, certId: lastCertId });
  if (!r.ok) { tick('Error: ' + r.error); return; }
  $('#lstTitle').value = r.title; $('#lstPrice').value = r.price + ' €'; $('#lstDesc').value = r.desc;
  $('#mlist')._csv = r.csv; $('#mlist').classList.add('show');
};
$('#lstClose').onclick = () => $('#mlist').classList.remove('show');
$('#lstCsv').onclick = async () => { const r = await window.opti.listingSaveCsv({ csv: $('#mlist')._csv, name: 'anuncio_' + (lastCertId || 'opticert') }); if (r.ok) tick('CSV guardado'); };
document.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copyText($('#' + b.dataset.copy).value));
function copyText(t) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); tick('Copiado al portapapeles'); }

/* historial */
$('#historyBtn').onclick = async () => {
  const list = await window.opti.certsList();
  $('#histList').innerHTML = list.length ? list.map((f) => `<div class="hrow"><span class="n">${esc(f.name)}</span><span class="o" data-open="${esc(f.path)}">abrir ↗</span></div>`).join('') : '<div style="color:var(--mut)">Aún no hay certificados.</div>';
  $('#histList').querySelectorAll('[data-open]').forEach((x) => x.onclick = () => window.opti.openPath(x.dataset.open));
  $('#mhist').classList.add('show');
};
$('#histClose').onclick = () => $('#mhist').classList.remove('show');

/* acerca de / apoyo */
$('#aboutBtn').onclick = () => $('#mabout').classList.add('show');
$('#aboutClose').onclick = () => $('#mabout').classList.remove('show');
document.querySelectorAll('[data-link]').forEach((b) => b.onclick = () => window.opti.openExternal(b.dataset.link));
document.querySelectorAll('[data-copy2]').forEach((b) => b.onclick = () => copyText(b.dataset.copy2));

/* settings */
$('#settingsBtn').onclick = () => $('#mset').classList.add('show');
$('#setCancel').onclick = () => $('#mset').classList.remove('show');
$('#openOut').onclick = () => window.opti.openPath('');
$('#setSave').onclick = async () => {
  const r = await window.opti.setSettings({ shop: $('#setShop').value.trim() || 'OptiSuite', technician: $('#setTech').value.trim(), imeiProvider: $('#setImeiProv').value, imeiApiKey: $('#setImeiKey').value.trim(), imeiEndpoint: $('#setImeiUrl').value.trim() });
  DATA.settings = r.settings; $('#mset').classList.remove('show'); tick('Ajustes guardados');
};
window.__go = (v) => { if (v === 'settings') $('#mset').classList.add('show'); };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
