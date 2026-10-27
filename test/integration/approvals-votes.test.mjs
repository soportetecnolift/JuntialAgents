import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, resetRedis, fakeLLM, fakeTelegram, toolResults, seedTenant, makeWorker, sleep } from '../helpers/setup.mjs';
const PORT = 6200; setupEnv(PORT, { SMTP_HOST: 'smtp.prueba' });
const centerSim = fakeCenter(PORT + 3);

const { db, oid } = await fakeDb(['Bot', 'Tenant', 'Plan', 'Usage', 'User', 'Notification', 'WorkerRun', 'WorkerApproval', 'WorkerMessage', 'WorkerLink', 'BotLog', 'CrmRecord', 'CrmActivity', 'FieldDef', 'Workflow', 'ChatContext', 'Message']);
// La IA propone un cambio de datos (requiere aprobación) y termina
fakeLLM(PORT + 1, (b) => (toolResults(b) ? '<aviso>Te dejo un cambio para aprobar.</aviso>'
  : { content: [{ type: 'text', text: 'La fecha venció; la paso a hoy.' }, { type: 'tool_use', id: 't1', name: 'crm_update', input: { id: 'rec1', fields: { status: 'Cualificado' } } }] }));
const tg = fakeTelegram(PORT + 2);

const { T } = seedTenant(db, oid);
const { encrypt } = await import('../../src/lib/crypto.js');
db.CrmRecord.push({ _id: 'rec1', tenantId: T, data: { name: 'Colombia 15', status: 'Nuevo' } });
const TGB = oid(); db.Bot.push({ _id: TGB, tenantId: T, kind: 'telegram', name: 'Sara', status: 'active', telegram: { connected: true, tokenEnc: encrypt('123456:ABC-prueba'), username: 'SaraBot' }, ai: {}, behavior: {}, flood: {} });
const ANT = oid(); const HEL = oid(); const PEP = oid(); const REP = 8788578156;
const PEOPLE = [{ _id: ANT, name: 'Antonio Ramón Martínez', telegramUsername: 'antonio_rm', telegramChatId: 5550001, canApprove: true },
  { _id: HEL, name: 'Helena Martínez', email: 'helena@tecnolift.es', canApprove: true },
  { _id: PEP, name: 'Pepe Amorós', telegramUsername: 'pepe_ops', telegramChatId: 5550003, canApprove: false }];
const reporting = { notifyPanel: true, telegramBotId: TGB, chatId: REP, email: { enabled: true, to: ['gerencia@tecnolift.es'], events: ['approvals'] } };

const express = (await import('express')).default; const { approvalPublic } = await import('../../src/modules/worker/channels.js');
express().use('/a', approvalPublic).listen(PORT);
const { runWorker } = await import('../../src/modules/worker/engine.js'); const { route } = await import('../../src/telegram/ingress.js');
const { getBotRuntime, bumpBotVersion } = await import('../../src/telegram/runtime.js'); const { Q } = await import('../../src/lib/queues.js');

async function newApproval(rule, people = PEOPLE) {
  const W = await makeWorker(db, oid, T, { approvalRule: rule, people, reporting }); await bumpBotVersion(W);
  tg.calls.length = 0; await runWorker({ botId: W, trigger: { type: 'manual', label: 'Prueba' }, instruction: 'Revisa' }); await sleep(300);
  return db.WorkerApproval.at(-1);
}
const fresh = (a) => db.WorkerApproval.find((x) => String(x._id) === String(a._id));
async function press(a, username, chatId, chatType, yn) {
  const msg = fresh(a).tgMessages.find((m) => m.chatId === chatId) || fresh(a).tgMessages[0];
  tg.calls.length = 0;
  await route(await getBotRuntime(TGB), { callback_query: { id: 'cq', from: { id: 9, username, first_name: username }, message: { message_id: msg.messageId, chat: { id: chatId, type: chatType } }, data: `a|${a._id}|${yn}` } });
  await sleep(250); return tg.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.text).join(' ');
}
before(async () => { await resetRedis(); });

test('regla «todos»: la solicitud llega a cada aprobador por su canal y solo ellos deciden', async () => {
  const a = await newApproval({ mode: 'all', onlyApprovers: true });
  assert.equal(a.need, 2);
  const chats = tg.sent().map((m) => m.chat_id);
  assert.ok(chats.includes(REP), 'llega al chat de informes'); assert.ok(chats.includes(5550001), 'llega al privado de Antonio');
  assert.ok(!chats.includes(5550003), 'Pepe (no aprobador) no la recibe');
  const mails = (await Q.email.getJobs(['waiting'])).map((j) => j.data);
  assert.ok(mails.some((m) => m.to === 'helena@tecnolift.es'), 'Helena la recibe por email');
  assert.ok(!mails.some((m) => m.to === 'gerencia@tecnolift.es'), 'no se envía el enlace compartido (no identificaría a nadie)');

  assert.match(await press(a, 'pepe_ops', REP, 'group', 'y'), /no puede aprobar/); assert.equal(fresh(a).status, 'pending');
  assert.match(await press(a, 'desconocido', REP, 'group', 'y'), /Solo pueden decidir/); assert.equal(fresh(a).status, 'pending');
  assert.match(await press(a, 'antonio_rm', 5550001, 'private', 'y'), /1\/2/); assert.equal(fresh(a).status, 'pending');
  assert.match(await press(a, 'antonio_rm', 5550001, 'private', 'y'), /Ya votaste/);

  const html = mails.find((m) => m.to === 'helena@tecnolift.es').html;
  const token = html.match(/\/a\/(apr_[A-Za-z0-9_-]+)/)[1];
  tg.calls.length = 0;
  const r = await fetch(`http://127.0.0.1:${PORT}/a/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) }).then((x) => x.json());
  await sleep(300);
  assert.equal(r.status, 'executed'); assert.equal(fresh(a).status, 'executed');
  assert.match(fresh(a).decidedBy, /Antonio.*\+.*Helena/);
  const closed = tg.calls.filter((c) => c.method === 'editMessageReplyMarkup').map((c) => c.chat_id);
  assert.ok(closed.includes(REP) && closed.includes(5550001), 'se cierran los botones en todos los chats');
});

test('regla «basta uno»: un rechazo lo para al momento', async () => {
  const a = await newApproval({ mode: 'any', onlyApprovers: true });
  assert.equal(a.need, 1);
  await press(a, 'antonio_rm', 5550001, 'private', 'n');
  assert.equal(fresh(a).status, 'rejected');
});

test('sin aprobadores en el equipo: funciona como siempre (decide cualquiera del chat de informes)', async () => {
  const a = await newApproval({ mode: 'any' }, PEOPLE.map((p) => ({ ...p, canApprove: false })));
  await press(a, 'pepe_ops', REP, 'group', 'y');
  assert.equal(fresh(a).status, 'executed');
});
