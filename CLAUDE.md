# JuntialAgents · backend (juntial-agents-bk)

## Antes de empezar cualquier tarea
1. Lee `docs/ARQUITECTURA.md` (cómo está construido), `docs/CONTRATO.md` (copia del contrato con Center), `docs/OPERACION.md` (arrancar, vigilar, diagnosticar) y `docs/CAMBIOS.md` (cómo se publica un cambio). Si algo de lo que vas a cambiar contradice esos documentos, **pregunta antes de seguir**.
2. Trabaja en una rama (`feat/…`, `fix/…`, `docs/…`), nunca en `main`. No subas a `main` ni fusiones: abre un *pull request* con la plantilla rellena.
3. Todo cambio de comportamiento lleva su prueba, y el de un fallo, la prueba que lo reproduce.
4. Si cambias cómo funciona algo descrito en `docs/`, actualiza ese documento en el mismo *pull request*, y añade la entrada en `CHANGELOG.md` (sección «Sin publicar»).
5. Nunca leas ni escribas `.env`, ni pongas secretos reales en el código ni en `.env.example`.

Eres el programador de **JuntialAgents**: agentes de IA (bots de Telegram, agentes web con voz y **empleados digitales**), CRM con campos personalizados, reglas de flujo, funciones JavaScript (sandbox QuickJS), conectores MCP, API pública v1 y servidor MCP para apps de IA.

**La identidad y la organización son de Juntial Center** (otro servicio). Contrato: `docs/CONTRATO.md` (copia; la fuente de verdad está en `juntial-center-bk`).

## Mapa
- `src/server.js` (API) y `src/worker.js` (colas BullMQ: Telegram, rutinas, reglas, emails, webhooks). `src/all.js`: los dos en un proceso, para planes pequeños.
- `src/lib/center.js`: **todo lo que se pide a Center** (permisos, áreas, aprobaciones con política, eventos, conexiones, validación de tokens del MCP).
- `src/modules/auth/`: **SSO con Center** (`sso.js`) y sesión propia de Agents (`service.js`: access de 15 min + cookie `ja_rt` de 30 días). User y Tenant son **copias locales** con el mismo id que en Center.
- `src/modules/org/`: permisos por rol de app (`access.js`, con respaldo si Center no responde), rutas de organización servidas por Center y avisos firmados de Center (`centerHooks.js`).
- `src/modules/worker/`: el empleado digital (motor, canales, conversación, equipo, memoria de trabajo, modo proactivo, guion, puesta a punto).
- `src/modules/oauth/`: MCP (`mcp.js`) y validación de tokens con Center (`tokens.js`).
- `src/modules/crm/`, `bots/`, `web/`, `mcp/`, `tasks/`, `webhooks/`, `plans/`, `support/`, `developer/`, `admin/`.

## Comandos
```bash
npm install
cp .env.example .env     # CENTER_APP_SECRET = el secreto de juntialagents en CENTER_APPS de Center
npm run seed             # planes
npm run dev:api          # http://localhost:4000
npm run dev:worker
npm test                 # obligatorio. Necesita Redis (usa la base de datos 15; TEST_REDIS_URL para cambiarla)
npm run test:e2e         # Center real + Agents real (ver test/e2e/README.md)
```
Las pruebas usan una base simulada (`test/helpers/fakedb.mjs`), una IA simulada, un Telegram simulado y un **Center simulado** (`fakeCenter` en `test/helpers/setup.mjs`).

## Reglas
1. **Nada de identidad ni organización aquí**: ni contraseñas, ni miembros, ni políticas. Si hace falta algo de Center, se pide por `lib/center.js`, y si no existe en el contrato, se pide al programador de Center.
2. **Las aprobaciones nunca se saltan**: si Center no responde al crear una, queda pendiente y solo la decide un administrador desde el panel (`centerUnavailable`).
3. Los avisos de Center (`/internal/center/approvals`) se verifican con su firma y se aplican de forma **idempotente**.
4. Toda consulta va filtrada por `tenantId` (la organización activa).
5. Valida con `zod`, rutas con `asyncH`, errores previstos con los helpers de `lib/errors.js`, textos en español.
6. Cada cambio de comportamiento lleva su prueba. `npm test` en verde antes de terminar.

## Cosas aprendidas (no repetir)
- Las pruebas **no leen el `.env`** de quien las ejecuta (`DOTENV_CONFIG_PATH` en `test/helpers/setup.mjs`). Si una prueba necesita una variable, se la da `setupEnv()`.
- Si la dirección pública (`PUBLIC_API_URL`, p. ej. un túnel) no es la que usa el panel (`AUTH_API_URL`), el login vuelve a la pública y abre la sesión en la del panel con un pase de un solo uso (`/api/auth/sso/finish`): la cookie tiene que quedar en el mismo sitio que el panel.
- `categorize()` (riesgo de cada herramienta) mira **todos** los tokens del nombre: `executeCOQLQuery` es lectura.
- Si dos tareas del mismo empleado coinciden, la segunda **espera su turno** (reintento cada 30 s, hasta 2 h); nunca se pierde. Ojo con los `return` sin `await` dentro de un `try`.
- El aviso del empleado es corto (`<aviso>`) y el detalle va aparte (`<detalle>`, solo en el panel).
- Al guardar el puesto se reescribe `bot.worker` entero: no guardes ahí datos que no viajen con él (por eso los enlaces personales están en `WorkerLink`).
- No llames `short` a una variable dentro del motor: es la función que resume cada paso.
- Los enlaces de chat de una persona (`/w/<enlace>`) la identifican; quien no tenga `canApprove` no puede aprobar hablando.

## Cuando acabes un cambio
`npm test` en verde (y `npm run test:e2e` si tocaste algo que hable con Center).
