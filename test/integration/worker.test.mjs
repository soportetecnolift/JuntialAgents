import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, resetRedis, fakeLLM, toolResults, systemText, seedTenant, makeWorker, sleep } from '../helpers/setup.mjs';
const PORT = 6500; setupEnv(PORT, { WEB_URL: 'https://panel.test' });
const centerSim = fakeCenter(PORT + 3);
const { db, oid } = await fakeDb(['Bot', 'Tenant', 'Plan', 'Usage', 'User', 'Notification', 'WorkerRun', 'WorkerApproval', 'WorkerMessage', 'WorkerLink', 'WorkerRoutine', 'BotLog', 'CrmRecord', 'CrmActivity', 'FieldDef', 'Workflow']);
let scenario = 'rutina';
const llm = fakeLLM(PORT + 1, (b) => {
  const n = toolResults(b); const all = JSON.stringify(b.messages);
  if (scenario === 'rutina') {
    if (n === 0) return { content: [{ type: 'tool_use', id: 't1', name: 'crm_search', input: { query: 'Colombia' } }] };
    if (n === 1) return { content: [{ type: 'text', text: 'La fecha venció el 16/10; la paso a hoy para que cuadre.' },
      { type: 'tool_use', id: 't2', name: 'crm_update', input: { id: 'rec1', fields: { status: 'Cualificado' } } },
      { type: 'tool_use', id: 't3', name: 'track', input: { action: 'open', text: 'Confirmar con Antonio si Colombia 15 salió de fábrica', who: 'Antonio' } },
      { type: 'tool_use', id: 't4', name: 'message_person', input: { person: 'helena', text: 'Helena, ¿miras la factura de Colombia 15?' } }] };
    return '<aviso>\n**Colombia 15** · fabricación vencida · se lo he preguntado a Antonio.\nTe dejo un cambio para aprobar.\n</aviso>\n<detalle>\n- 14 tratos más sin incidencias\n</detalle>';
  }
  if (scenario === 'corte') { // se corta por longitud anunciando una consulta; tras el aviso, consulta y entrega
    if (n === 0) return { content: [{ type: 'tool_use', id: 'c1', name: 'crm_search', input: {} }] };
    if (n === 1 && !all.includes('se cortó por longitud')) return { content: [{ type: 'text', text: 'Vuelvo a consultar solo los campos que necesito. Prepararé la consulta con' }], stop_reason: 'max_tokens' };
    if (n === 1) return { content: [{ type: 'tool_use', id: 'c2', name: 'crm_search', input: { limit: 50 } }] };
    return '<aviso>Informe de legalización completo.</aviso>';
  }
  // La petición de recuperación llega sin herramientas y con un solo mensaje: se comprueba primero
  if (scenario === 'vacio') return all.includes('Redacta AHORA') ? '<aviso>Informe recuperado.</aviso>' : n === 0 ? { content: [{ type: 'tool_use', id: 'v1', name: 'crm_search', input: {} }] } : '';
  if (scenario === 'nada') return '<aviso>[SIN_NOVEDADES]</aviso>';
  if (scenario === 'lento') return new Promise((r) => setTimeout(() => r(`<aviso>Hecho: ${all.includes('TAREA 1') ? 'TAREA 1' : 'TAREA 2'}</aviso>`), all.includes('TAREA 1') ? 2500 : 100));
  return '<aviso>ok</aviso>';
});
const { T } = seedTenant(db, oid);
db.CrmRecord.push({ _id: 'rec1', tenantId: T, data: { name: 'Colombia 15', status: 'Nuevo' } });
const W = await makeWorker(db, oid, T, { people: [{ _id: oid(), name: 'Helena Martínez', email: 'helena@tecnolift.es', relation: 'compañero' }] });
const bot = () => db.Bot.find((b) => String(b._id) === String(W)); const lastRun = () => db.WorkerRun.at(-1);
const { runWorker, processWorkerJob, syncHeartbeat } = await import('../../src/modules/worker/engine.js'); const { Q } = await import('../../src/lib/queues.js'); const { bumpBotVersion } = await import('../../src/telegram/runtime.js');
before(async () => { await resetRedis(); });

test('rutina: actúa (crea la aprobación sola), apunta un pendiente, avisa a un compañero y entrega un aviso corto', async () => {
  scenario = 'rutina'; await runWorker({ botId: W, trigger: { type: 'manual', label: 'Control de fabricación' }, instruction: 'Revisa' });
  const r = lastRun();
  assert.match(systemText(llm.requests.at(-1)), /como una persona del equipo por WhatsApp/);
  assert.ok(r.summary.split('\n').length <= 6, 'el aviso es corto'); assert.match(r.detail, /14 tratos/, 'el detalle va aparte');
  assert.equal(db.WorkerApproval.at(-1).status, 'pending', 'el cambio se pidió como aprobación');
  assert.match(bot().worker.threads.at(-1).text, /Confirmar con Antonio/, 'pendiente en su memoria de trabajo');
  assert.match(bot().worker.journal.at(-1).text, /Control de fabricación/, 'queda en su diario');
  assert.ok((await Q.email.getJobs(['waiting'])).some((j) => j.data.to === 'helena@tecnolift.es'), 'avisó a Helena por su canal');
  assert.ok(r.steps.filter((s) => s.kind === 'tool').every((s) => typeof s.result === 'string'), 'cada paso guarda su resultado (sin errores internos)');
  const msg = db.WorkerMessage.filter((m) => String(m.botId) === String(W)).at(-1).text;
  assert.match(msg, /Detalle: https:\/\/panel\.test/, 'el aviso enlaza al detalle');
});

test('respuesta cortada por longitud: repite la consulta y entrega el informe completo (sin la frase cortada)', async () => {
  scenario = 'corte'; await runWorker({ botId: W, trigger: { type: 'manual', label: 'Legalización' }, instruction: 'Revisa' });
  assert.equal(lastRun().summary, 'Informe de legalización completo.');
});

test('resumen vacío: se recupera el informe a partir de lo consultado', async () => {
  scenario = 'vacio'; await runWorker({ botId: W, trigger: { type: 'manual', label: 'Planificación' }, instruction: 'Revisa' });
  assert.equal(lastRun().summary, 'Informe recuperado.');
});

test('sin novedades: no molesta (no se envía aviso)', async () => {
  scenario = 'nada'; await runWorker({ botId: W, trigger: { type: 'schedule', label: 'Parte diario' }, instruction: 'Revisa' });
  assert.equal(lastRun().report.sent, false); assert.equal(lastRun().report.reason, 'Sin novedades');
});

test('dos encargos seguidos: el segundo espera su turno en vez de perderse', async () => {
  scenario = 'lento'; await resetRedis(); const before = db.WorkerRun.length;
  const { Worker } = await import('bullmq'); const { createRedis } = await import('../../src/lib/redis.js');
  const failed = []; const w = new Worker('workers', processWorkerJob, { connection: createRedis(), concurrency: 10, lockDuration: 600000 }); w.on('failed', (j, e) => failed.push(e.message));
  await Q.workers.add('event', { botId: String(W), instruction: 'TAREA 1', label: 'Tarea 1', manual: true }, { attempts: 1 });
  await Q.workers.add('event', { botId: String(W), instruction: 'TAREA 2', label: 'Tarea 2', manual: true }, { attempts: 1 });
  await sleep(40000); await w.close();
  assert.deepEqual(failed, []); assert.equal(db.WorkerRun.length - before, 2, 'se ejecutan las dos');
  assert.ok(db.BotLog.some((l) => l.event === 'worker.queued'), 'el registro avisa de la espera');
});

test('modo proactivo: latido programado, recoge pendientes vencidos y aprobaciones atascadas; se quita al desactivarlo', async () => {
  scenario = 'nada'; const b = bot(); b.worker.proactive = { enabled: true, everyHours: 3 };
  b.worker.threads.push({ _id: oid(), text: 'Llamar a Antonio', status: 'open', due: new Date(Date.now() - 864e5), createdAt: new Date() });
  db.WorkerApproval.push({ _id: oid(), tenantId: T, botId: W, status: 'pending', label: 'Cambio atascado', createdAt: new Date(Date.now() - 30 * 3600e3), expiresAt: new Date(Date.now() + 864e5) });
  await bumpBotVersion(W); await syncHeartbeat(b);
  assert.ok((await Q.workers.getJobSchedulers()).some((x) => String(x.key || x.id).startsWith('hb-')));
  await processWorkerJob({ name: 'heartbeat', data: { botId: String(W) } });
  const instr = JSON.stringify(llm.requests.at(-1).messages[0].content);
  assert.match(instr, /VENCIDO/); assert.match(instr, /Cambio atascado/);
  b.worker.proactive.enabled = false; await syncHeartbeat(b);
  assert.ok(!(await Q.workers.getJobSchedulers()).some((x) => String(x.key || x.id).startsWith('hb-')));
});
