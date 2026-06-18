'use strict';
/*
 * OptiCert — generador de anuncios para marketplaces (Back Market / Wallapop / eBay).
 * Convierte el diagnóstico + grado en un título, descripción, precio sugerido y CSV
 * listos para publicar. Ahorra horas de listar. No publica: genera el contenido.
 */

// Precio base orientativo por grado (EUR), ajustable por el usuario en el futuro.
const GRADE_PRICE = { A: 0.78, B: 0.62, C: 0.46, D: 0.30 }; // factor sobre un valor de referencia

function suggestPrice(diag, grade) {
  // Heurística simple: parte de un valor de referencia por gama (RAM como proxy) y aplica grado.
  const ram = parseFloat(diag.system.ramGB || '0');
  const base = ram >= 6 ? 320 : ram >= 4 ? 200 : ram >= 3 ? 130 : 80;
  const f = GRADE_PRICE[grade.grade] || 0.4;
  let price = Math.round((base * f) / 5) * 5;
  // batería gastada baja un poco más
  if (diag.battery.healthPct != null && diag.battery.healthPct < 80) price = Math.round(price * 0.9 / 5) * 5;
  return price;
}

function build(diag, grade, certId) {
  const s = diag.system, b = diag.battery;
  const title = `${cap(s.brand)} ${s.model} ${s.storage || ''} · Grado ${grade.grade}${b.healthPct != null ? ` · Batería ${b.healthPct}%` : ''}`.replace(/\s+/g, ' ').trim();
  const price = suggestPrice(diag, grade);
  const desc = [
    `${cap(s.brand)} ${s.model} reacondicionado y verificado.`,
    ``,
    `📊 Estado: Grado ${grade.grade} (${grade.label.replace(' (provisional)', '')}).`,
    b.healthPct != null ? `🔋 Salud de batería: ${b.healthPct}%${b.cycles ? ` · ${b.cycles} ciclos` : ''}.` : (b.cycles ? `🔋 Ciclos de batería: ${b.cycles}.` : ''),
    `📱 ${s.android ? 'Android ' + s.android + ' · ' : ''}${s.ramGB ? s.ramGB + ' GB RAM · ' : ''}${s.storage ? s.storage + ' almacenamiento' : ''}.`,
    `✅ IMEI verificado${diag.blacklist === 'clean' ? ' y limpio (no en lista negra)' : ''}.`,
    grade.readyToSell ? `✔️ Listo para usar.` : `ℹ️ Revisar detalles antes de comprar.`,
    ``,
    `📜 Incluye certificado de diagnóstico OptiCert${certId ? ' (' + certId + ')' : ''} verificable por QR.`,
  ].filter((l) => l !== undefined).join('\n');

  const csv = toCsv([['referencia', 'titulo', 'marca', 'modelo', 'almacenamiento', 'ram', 'grado', 'bateria_salud', 'ciclos', 'imei', 'precio_sugerido', 'certificado'],
    [certId || '', title, s.brand, s.model, s.storage, s.ramGB, grade.grade, b.healthPct != null ? b.healthPct : '', b.cycles || '', (diag.imeis || [])[0] || '', price, certId || '']]);

  return { title, desc, price, csv };
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function toCsv(rows) { return rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n'); }

module.exports = { build, suggestPrice };
