import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, centerSign, resetRedis, fakeLLM, fakeTelegram, toolResults, seedTenant, makeWorker, sleep } from '../helpers/setup.mjs';
const PORT = 6900; setupEnv(PORT);
const center = fakeCenter(PORT + 3);
const { db, oid } = await fakeDb(['Bot', 'Tenant', 'Plan', 'Usage', 'User', 'Notification', 'WorkerRun', 'WorkerApproval', 'WorkerMessage', 'WorkerLink', 'BotLog', 'CrmRecord', 'CrmActivity', 'FieldDef', 'Workflow', 'ChatContext', 'Message', 'Session', 'Audit']);
fakeLLM(PORT + 1, (b) => (toolResults(b) ? '<aviso>Te dejo un cambio para aprobar.</aviso>' : { content: [{ type: 'text', text: 'La factura supera 5.000 €.' }, { type: 'tool_use', id: 't1', name: 'crm_update', input: { id: 'rec1', fields: { status: 'Cualificado' }, total: 12100 } }] }));
const tg = fakeTelegram(PORT + 2);
const { T } = seedTenant(db, oid);
const { encrypt } = await import('../../src/lib/crypto.js');
db.CrmRecord.push({ _id: 'rec1', tenantId: T, data: { name: 'Colombia 15', status: 'Nuevo' } });
const TGB = oid(); db.Bot.push({ _id: TGB, tenantId: T, kind: 'telegram', name: 'Sara', status: 'active', telegram: { connected: true, tokenEnc: encrypt('123456:ABC-prueba') }, ai: {}, behavior: {}, flood: {} });
const OPS = String(oid());
const W = await makeWorker(db, oid, T, { departmentId: OPS, reporting: { notifyPanel: true, telegramBotId: TGB, chatId: 8788578156 } });
const { runWorker } = await import('../../src/modules/worker/engine.js'); const { route } = await import('../../src/telegram/ingress.js'); const { getBotRuntime } = await import('../../src/telegram/runtime.js');
const { createApp } = await import('../../src/app.js'); const srv = createApp().listen(PORT); const P = `http://127.0.0.1:${PORT}`;
const last = () => db.WorkerApproval.at(-1);
let created; let seq = 0; center.on('POST /internal/approvals', (b) => { created = b; return { policy: { id: 'p1', name: 'Compras > 5.000 €' }, approvalId: `ca-${++seq}`, steps: [{ name: 'Responsable del área' }, { name: 'Dirección' }] }; });
let votes = []; center.on('POST /internal/approvals/:id/vote', (b) => { votes.push(b); return votes.length === 1 ? { ok: true, status: 'pending', info: 'Paso «Responsable del área» aprobado. Ahora decide: Dirección' } : { ok: true, status: 'approved', by: 'Antonio' }; });
before(async () => { await resetRedis(); });

test('si encaja una política, la aprobación la gestiona Center con el contexto completo', async () => {
  await runWorker({ botId: W, trigger: { type: 'manual', label: 'Facturas' }, instruction: 'Revisa' }); await sleep(300);
  assert.equal(created.category, 'data'); assert.equal(created.amount, 12100, 'el importe se detecta en los argumentos'); assert.equal(created.departmentId, OPS); assert.equal(created.agentName, 'Coordinador de operaciones');
  assert.equal(last().centerApprovalId, 'ca-1'); assert.equal(last().policyName, 'Compras > 5.000 €');
  assert.match(tg.sent().find((m) => m.chat_id === 8788578156).text, /La gestiona Juntial Center/);
});

test('el voto por Telegram se reenvía a Center y, con la decisión final, se ejecuta la acción', async () => {
  const msg = last().tgMessages[0];
  const press = async (username) => { await route(await getBotRuntime(TGB), { callback_query: { id: 'cq', from: { id: 9, username }, message: { message_id: msg.messageId, chat: { id: 8788578156, type: 'group' } }, data: `a|${last()._id}|y` } }); await sleep(250); };
  await press('pepe_ops'); assert.equal(votes[0].actor.telegramUsername, 'pepe_ops'); assert.equal(last().status, 'pending');
  await press('antonio_rm'); assert.equal(last().status, 'executed'); assert.match(last().decidedBy, /Antonio/);
  assert.equal(db.CrmRecord[0].data.status, 'Cualificado', 'la acción se ejecutó en Agents');
});

test('aviso firmado de Center: aplica la decisión; una firma falsa se rechaza; repetirlo no hace nada', async () => {
  votes = [];
  await runWorker({ botId: W, trigger: { type: 'manual', label: 'Otra' }, instruction: 'Revisa' }); await sleep(200);
  const a = last(); const body = JSON.stringify({ approvalId: a.centerApprovalId, externalId: String(a._id), status: 'rejected', by: 'Helena', via: 'email', feedback: 'No toca' });
  assert.equal((await fetch(`${P}/internal/center/approvals`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-juntial-signature': 't=1,v1=falsa' }, body })).status, 401);
  const ok = await fetch(`${P}/internal/center/approvals`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-juntial-signature': await centerSign(body) }, body });
  assert.equal(ok.status, 200); assert.equal(last().status, 'rejected'); assert.equal(last().decidedBy, 'Helena');
  const again = await (await fetch(`${P}/internal/center/approvals`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-juntial-signature': await centerSign(body) }, body })).json();
  assert.equal(again.already, 'rejected');
});

test('si Center no responde al crearla, no se salta la política: solo la decide un administrador desde el panel', async () => {
  center.down = true;
  await runWorker({ botId: W, trigger: { type: 'manual', label: 'Sin Center' }, instruction: 'Revisa' }); await sleep(200);
  center.down = false; const a = last();
  assert.equal(a.centerUnavailable, true);
  const { voteApproval, decideApproval } = await import('../../src/modules/worker/engine.js');
  assert.match((await voteApproval(a._id, { approve: true, person: { _id: oid(), name: 'X', canApprove: true }, via: 'telegram' })).error, /solo puede decidirla un administrador/);
  assert.equal((await decideApproval(a._id, { approve: true, by: 'soporte@tecnolift.es', via: 'panel' })).status, 'executed');
  srv.close();
});
