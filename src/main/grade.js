'use strict';
/*
 * OptiCert — grading objetivo A/B/C/D a partir del diagnóstico.
 * Reglas por defecto (configurables): la salud de batería marca el grado base;
 * los problemas de seguridad/estado bajan o bloquean el grado.
 */
const DEFAULT_RULES = {
  battery: [[90, 'A'], [80, 'B'], [70, 'C'], [0, 'D']], // umbral mínimo -> grado
  cyclesWarn: 800,
  tempWarn: 40,
};

function batteryGrade(pct, rules) {
  if (pct == null) return null;
  for (const [min, g] of rules.battery) if (pct >= min) return g;
  return 'D';
}

/** Grado provisional cuando NO hay salud real (sin root): se estima por ciclos/estado. */
function provisionalGrade(b) {
  if (b.healthCode && b.healthCode > 2) return 'D';        // sobrecalentada/fallo/muerta
  const c = b.cycles;
  if (c != null) { if (c < 400) return 'B'; if (c < 800) return 'C'; return 'D'; }
  if (b.healthCode === 2) return 'B';                       // "Buena" según el sistema
  return null;
}

/** Devuelve { grade, label, color, flags[], readyToSell, score }. */
function evaluate(diag, rules = DEFAULT_RULES) {
  const flags = [];
  const b = diag.battery || {};
  const sec = diag.security || {};
  let grade = batteryGrade(b.healthPct, rules);
  let provisional = false;
  if (grade == null) { grade = provisionalGrade(b); provisional = true; }

  if (b.healthPct == null) flags.push({ level: 'info', msg: 'Salud de batería real no disponible (sin root): grado PROVISIONAL por ciclos/estado' });
  if (b.cycles && b.cycles > rules.cyclesWarn) flags.push({ level: 'warn', msg: `Ciclos altos (${b.cycles})` });
  if (b.temp && b.temp > rules.tempWarn) flags.push({ level: 'warn', msg: `Temperatura alta (${b.temp.toFixed(1)}°C)` });
  if (b.healthCode && b.healthCode > 2) flags.push({ level: 'bad', msg: `Estado de batería: ${b.health}` });

  // Seguridad / listo para vender
  let blocked = false;
  if (sec.frp && /presente/.test(sec.frp)) { flags.push({ level: 'bad', msg: 'Posible cuenta vinculada (FRP/iCloud): verificar antes de vender' }); blocked = true; }
  if (!diag.imeis || !diag.imeis.length) flags.push({ level: 'warn', msg: 'IMEI no leído' });
  if ((diag.imeiAnalysis || []).some((a) => a.imei && !a.valid)) { flags.push({ level: 'bad', msg: 'IMEI con checksum inválido (Luhn) — posible IMEI falso/manipulado' }); blocked = true; }
  if (diag.blacklist === 'listed') { flags.push({ level: 'bad', msg: 'IMEI en lista negra (robado/bloqueado)' }); blocked = true; grade = 'D'; }
  else if (diag.blacklist === 'clean') flags.push({ level: 'info', msg: 'IMEI verificado: limpio (no en lista negra)' });
  else if (diag.blacklist === 'pendiente') flags.push({ level: 'info', msg: 'Blacklist: añade tu clave API (Ajustes) para consulta en tiempo real' });
  const br = diag.blacklistRaw || {};
  if (br.brand && diag.system.brand) {
    const a = String(br.brand).toLowerCase(), b = diag.system.brand.toLowerCase();
    if (!a.includes(b) && !b.includes(a)) flags.push({ level: 'warn', msg: `Marca según IMEI (${br.brand}) ≠ dispositivo (${diag.system.brand}) — posible manipulación` });
  }
  if (br.fmip != null && /lock|true|yes|activ|1/i.test(String(br.fmip))) { flags.push({ level: 'bad', msg: 'Find My iPhone / iCloud / FRP ACTIVO — no vendible' }); blocked = true; }
  if (!diag.wiped) flags.push({ level: 'info', msg: 'Borrado de datos no realizado todavía' });

  const readyToSell = !blocked && (grade === 'A' || grade === 'B' || grade === 'C');
  const META = { A: ['Excelente', '#19c37d'], B: ['Bueno', '#7cc4ff'], C: ['Aceptable', '#f59e0b'], D: ['Deficiente', '#ef4444'] };
  const m = META[grade] || ['Sin grado', '#94a3c7'];
  return { grade: grade || '—', label: (provisional && grade ? m[0] + ' (provisional)' : m[0]), color: m[1], flags, readyToSell, blocked, provisional };
}

module.exports = { evaluate, DEFAULT_RULES };
