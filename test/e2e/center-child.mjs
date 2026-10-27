// Proceso de Juntial Center REAL para la prueba entre servicios (base simulada en memoria con datos iniciales).
const CENTER = (await import('node:path')).resolve(process.env.CENTER_DIR);
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: '7400', PUBLIC_API_URL: 'http://127.0.0.1:7400', WEB_URL: 'http://center.test', MONGO_URI: 'mongodb://simulada',
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'), JWT_ACCESS_SECRET: 'c'.repeat(40), JWT_REFRESH_SECRET: 'd'.repeat(40), CENTER_APPS: 'juntialagents:secreto-compartido-e2e-1234:http://127.0.0.1:7410:http://agents.test' });
const M = await import(`${CENTER}/src/models/index.js`); const { Kv } = await import(`${CENTER}/src/lib/redis.js`);
const { installFakeDb, oid } = await import(`${CENTER}/test/helpers/fakedb.mjs`);
const mongoose = (await import(`${CENTER}/node_modules/mongoose/index.js`)).default; mongoose.connect = async () => {};
const db = installFakeDb({ ...M, Kv }, ['User', 'Session', 'Otp', 'Tenant', 'Membership', 'Department', 'Invitation', 'OrgApp', 'OrgConnection', 'CenterEvent', 'CenterSubscription', 'ApprovalPolicy', 'CenterApproval', 'OAuthClient', 'OAuthGrant', 'Notification', 'Audit', 'Kv']);
const ids = JSON.parse(process.env.E2E_IDS);
db.Tenant.push({ _id: ids.ORG, name: 'Tecnolift', status: 'active' });
db.User.push({ _id: ids.ANA, email: 'ana@tecnolift.es', name: 'Ana', role: 'client', tenantId: ids.ORG, status: 'active', emailVerified: true });
db.User.push({ _id: ids.PEPE_U, email: 'pepe@tecnolift.es', name: 'Pepe', role: 'client', tenantId: ids.ORG, status: 'active', emailVerified: true });
db.Membership.push({ _id: ids.ANA_M, orgId: ids.ORG, userId: ids.ANA, email: 'ana@tecnolift.es', name: 'Ana', orgRole: 'owner', appRoles: { juntialagents: 'admin' }, status: 'active' });
db.Membership.push({ _id: ids.PEPE_M, orgId: ids.ORG, userId: ids.PEPE_U, email: 'pepe@tecnolift.es', name: 'Pepe', orgRole: 'member', departmentIds: [ids.OPS], appRoles: { juntialagents: 'editor' }, telegramUsername: 'pepe_ops', status: 'active' });
db.Department.push({ _id: ids.OPS, orgId: ids.ORG, name: 'Operaciones', headId: ids.PEPE_M });
db.OrgApp.push({ _id: oid(), orgId: ids.ORG, appId: 'juntialagents', enabled: true });
db.ApprovalPolicy.push({ _id: oid(), orgId: ids.ORG, name: 'Compras de Operaciones > 5.000 €', enabled: true, priority: 1, match: { app: 'juntialagents', departmentIds: [ids.OPS], categories: ['data'], minAmount: 5000 }, steps: [{ name: 'Responsable del área', approvers: { kind: 'department_head' }, mode: 'any', timeoutHours: 24, onTimeout: 'remind' }] });
const { registerFirstPartyApps } = await import(`${CENTER}/src/modules/oauth/server.js`); await registerFirstPartyApps();
const { createApp } = await import(`${CENTER}/src/app.js`);
createApp().listen(7400, () => process.send?.('listo'));
