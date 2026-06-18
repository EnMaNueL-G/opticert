'use strict';
/*
 * OptiCert — test de estrés térmico (mejorado).
 * Carga REAL de todos los núcleos (bucles aritméticos, no I/O) y vigila la
 * temperatura de la CPU leyendo /sys/class/thermal/thermal_zone*-/temp (reacciona
 * rápido y sube de verdad). Cae a la temperatura de batería si no hay zonas térmicas.
 * Veredicto por la SUBIDA (delta), que es independiente del modelo.
 */
const adb = require('./adb');

// timeout corto para que NUNCA cuelgue (algunos thermal_zone/temp bloquean)
async function sh(serial, cmd, ms = 6000) { try { return ((await adb.shell(['sh', '-c', cmd], { serial, timeout: ms })).stdout || '').trim(); } catch (_) { return ''; } }

async function batteryTemp(serial) {
  // dumpsys directo (sin 'sh -c' ni redirecciones): fiable y rápido (~120ms)
  try {
    const r = await adb.shell(['dumpsys', 'battery'], { serial, timeout: 4000 });
    const m = (r.stdout || '').match(/temperature:\s*(-?\d+)/);
    return m ? parseInt(m[1], 10) / 10 : null;
  } catch (_) { return null; }
}
async function zoneTemp(serial) {
  // lectura protegida con timeout EN EL DISPOSITIVO para no bloquear nunca
  const out = await sh(serial, 'for z in /sys/class/thermal/thermal_zone*/temp; do timeout 1 cat "$z" 2>/dev/null; done', 5000);
  const vals = out.split(/\s+/).map(Number).filter((n) => isFinite(n) && n !== 0);
  const norm = vals.map((v) => (Math.abs(v) > 1000 ? v / 1000 : v)).filter((v) => v >= 10 && v <= 120);
  return norm.length ? Math.max(...norm) : null;
}
async function cpuTemp(serial) {
  // batería primero (rápido, siempre funciona) + intenta zonas de CPU si responden
  const bat = await batteryTemp(serial);
  const zone = await zoneTemp(serial);
  if (zone != null) return zone;
  return bat;
}

async function run(serial, seconds, onReading) {
  const sec = Math.max(15, Math.min(180, +seconds || 60));
  const cb = onReading || (() => {});
  // Decide la fuente UNA vez (zonas CPU si responden; si no, batería rápida).
  const useZone = (await zoneTemp(serial)) != null;
  const read = useZone ? () => zoneTemp(serial) : () => batteryTemp(serial);
  const start = await read();
  const readings = [];
  // Carga: un bucle aritmético tight por núcleo (100% CPU), se autotermina a los sec.
  // Carga DESACOPLADA (nohup &): devuelve al instante para que las lecturas no se bloqueen.
  // Deja 1 núcleo libre, baja prioridad, y se autotermina (pkill por marca OCLOAD) a los sec.
  const script = `nohup sh -c 'm=$(cat /sys/devices/system/cpu/present 2>/dev/null | sed "s/.*-//"); m=${'$'}{m:-3}; c=$((m+1)); n=$((c/2)); [ $n -lt 1 ] && n=1; i=0; while [ $i -lt $n ]; do nice -n 19 sh -c "while true; do j=0; while [ \\$j -lt 200000 ]; do j=\\$((j+1)); done; done" OCLOAD & i=$((i+1)); done; sleep ${sec}; pkill -f OCLOAD 2>/dev/null' >/dev/null 2>&1 &`;
  await sh(serial, script, 6000).catch(() => {});
  const load = Promise.resolve();
  const t0 = Date.now();
  let max = start || 0;
  while ((Date.now() - t0) / 1000 < sec) {
    await new Promise((r) => setTimeout(r, 2000));
    const tp = await read();
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (tp != null) { max = Math.max(max, tp); readings.push({ elapsed, temp: tp }); cb({ elapsed, temp: tp, max }); }
  }
  await load;
  const end = await cpuTemp(serial);
  const delta = (start != null && max != null) ? +(max - start).toFixed(1) : null;
  let verdict, color;
  if (max == null) { verdict = 'no medible'; color = '#94a3c7'; }
  else if (max >= 75 || (delta != null && delta > 22)) { verdict = 'Sobrecalentamiento'; color = '#ef4444'; }
  else if (max >= 60 || (delta != null && delta > 12)) { verdict = 'Se calienta (revisar disipación)'; color = '#f59e0b'; }
  else { verdict = 'Disipación correcta'; color = '#10b981'; }
  return { start, max, end, delta, verdict, color, seconds: sec, readings, source: useZone ? 'cpu' : 'bateria' };
}

module.exports = { run, cpuTemp };
