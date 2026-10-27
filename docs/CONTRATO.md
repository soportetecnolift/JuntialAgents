# Contrato de Juntial Center con sus apps · v1

Fuente de verdad: **este archivo, en `juntial-center-bk`**. Cada app guarda una copia en su propio `docs/CONTRATO.md` y la actualiza cuando cambia la versión.
Regla: **un cambio que rompa algo de este contrato sube la versión (v2) y se avisa a las apps antes de desplegarlo.**

## 1. Registro de una app
Center conoce cada app por la variable `CENTER_APPS` (`id:secreto:urlApi:urlPanel`, varias separadas por coma) y por su entrada en el catálogo (`src/modules/center/apps.js`: nombre, icono, roles, eventos que publica y consume).
- **id**: identificador estable (`juntialagents`, `juntial-tellai`…). Es también el `client_id` OAuth y la clave de `appRoles` de cada miembro.
- **secreto**: compartido con la app (`CENTER_APP_SECRET`). Sirve para la API interna, para canjear códigos OAuth y para firmar los avisos.
- La app tiene que exponer `GET {urlApi}/api/auth/sso/callback` y, si usa aprobaciones, `POST {urlApi}/internal/center/approvals`.

## 2. Inicio de sesión único (SSO)
OAuth 2.1, *authorization code* con PKCE S256. La app es un **cliente confidencial de primera parte**: no hay pantalla de consentimiento.
1. La app redirige a `GET {CENTER}/oauth/authorize?response_type=code&client_id={id}&redirect_uri={urlApi}/api/auth/sso/callback&code_challenge=…&code_challenge_method=S256&state=…&scope=openid profile&resource={urlApi}`.
2. Center identifica a la persona en su panel y vuelve a `redirect_uri?code=…&state=…`.
3. La app canjea el código **desde su servidor**: `POST {CENTER}/oauth/token` (`grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`) con `Authorization: Basic base64(id:secreto)`.
4. `GET {CENTER}/oauth/userinfo` con el `access_token` → `{ sub, email, name, avatar, role, tid }`.
   - `role`: `client` (persona de una organización) o `superadmin` / `admin` / `employee` (equipo de la plataforma).
   - `tid`: organización activa (puede ser `null` para el equipo).
5. La app revoca el token (`POST {CENTER}/oauth/revoke`) y **abre su propia sesión**. Guarda una copia local de usuario y organización **con los mismos ids** que en Center.

## 3. API interna (servicio a servicio)
`{CENTER}/internal/*`, con `Authorization: Basic base64(id:secreto)`. Respuestas JSON. Los errores devuelven `{ error: { message } }` con el código HTTP correspondiente (401 si la app no está autorizada, 404 si no existe).

| Método y ruta | Para qué |
|---|---|
| `GET /users/:id` | Usuario: `{ id, email, name, avatar, role, status, tenantId }` |
| `GET /orgs/:id` | Organización: `{ id, name, slug, logo, status, timezone, country }` |
| `GET /memberships?orgId=&userId=` (o `&telegramUsername=` o `&email=`) | Permisos: `{ id, orgId, userId, orgRole, appRole, appEnabled, departmentIds, telegramUsername }`. **404 si no es miembro.** `appRole` ∈ `admin` · `editor` · `viewer` · `none` |
| `GET /users/:id/orgs` | Organizaciones de una persona, con su `orgRole` y su `appRole` |
| `GET /orgs/:id/departments` · `/orgs/:id/members` · `/orgs/:id/events?type=&limit=` | Áreas, miembros y eventos |
| `POST /approvals` | Pedir una aprobación (ver 4) |
| `POST /approvals/:id/vote` | `{ approve, via, feedback?, actor: { userId \| memberId \| email \| telegramUsername } }` |
| `POST /approvals/:id/cancel` | Retirar una aprobación que ya no tiene sentido |
| `GET /approvals?orgId=&userId=&scope=mine\|all&status=pending\|all` | Bandeja de una persona |
| `POST /policies/simulate` | `{ orgId, category, tool?, amount?, departmentId? }` → qué política y qué personas aprobarían |
| `POST /events` | `{ orgId, type, data, actor? }`: publicar en el bus de la organización |
| `POST /connections/:orgId/:slug/request` | Petición HTTP con una conexión compartida: `{ url, method, headers?, body? }` → `{ status, ok, headers, body }`. **El secreto nunca sale de Center** |
| `POST /oauth/introspect` | `{ token }` → `{ active, grantId, clientId, oauthScopes, user: { id, role, tenantId, email } }`. Solo es activo si el token es **para esta app** |

Recomendado: guardar en caché unos 60 s lo que se consulta en cada petición (permisos, tokens). Si Center no responde, usar los últimos permisos conocidos durante un tiempo limitado y **nunca** saltarse una aprobación.

## 4. Aprobaciones con política
1. Cuando una acción necesita aprobación, la app llama a `POST /internal/approvals` con `{ orgId, externalId (su id), label, category, tool?, reason?, amount?, departmentId?, agentId?, agentName?, link?, ttlHours? }`.
2. Respuesta:
   - `{ policy: null }` → ninguna política encaja: la app decide con su propia regla.
   - `{ policy: { id, name }, approvalId, steps }` → **la gestiona Center**: avisa a cada aprobador (panel y email con enlace personal), recoge los votos, aplica quórum y plazos.
3. Votos que lleguen a la app (Telegram, su panel…) se reenvían con `POST /internal/approvals/:approvalId/vote`.
4. Al decidirse, Center llama a `POST {urlApi}/internal/center/approvals` con `{ approvalId, externalId, status: approved|rejected|expired, by, via, feedback, decidedAt }` y la cabecera `X-Juntial-Signature: t={unix},v1={HMAC-SHA256(secreto, "{t}.{cuerpo}")}`. Hay reintentos a 1 min, 5 min y 30 min. La app **verifica la firma**, ejecuta o descarta la acción y responde 2xx. El aviso puede repetirse: la app tiene que ser **idempotente**.
5. Center **nunca ejecuta** acciones de una app.

`category`: `read` · `internal` · `data` · `external` · `destructive`. `amount`: número en la moneda de la organización (para las políticas "a partir de X").

## 5. Eventos
Nombres `ámbito.objeto.acción` en minúsculas (`approval.decided`, `worker.run.completed`, `center.member.joined`). Los publica la app con `POST /internal/events`, y Center los entrega a las suscripciones de la organización (webhooks firmados con el secreto de la suscripción, misma cabecera `X-Juntial-Signature`). Cada app declara en el catálogo los que publica (`publishes`) y los que consume (`consumes`).

## 6. Apps de IA (MCP)
Center es el **servidor de autorización** (RFC 8414 en `/.well-known/oauth-authorization-server`, registro dinámico, PKCE S256, `resource` RFC 8707). Cada app que tenga MCP:
- publica `/.well-known/oauth-protected-resource` con `resource: {urlApi}/mcp` y `authorization_servers: [{CENTER}]`;
- responde 401 con `WWW-Authenticate: Bearer resource_metadata="…"` cuando no hay token;
- valida cada token con `POST /internal/oauth/introspect` y lo traduce a sus propios permisos (`juntial:read` → solo lectura; `juntial:write` → escritura).

## 7. Roles
- **De organización** (`orgRole`): `owner` · `admin` · `member`.
- **De app** (`appRole`): `admin` (todo) · `editor` (todo salvo administración) · `viewer` (solo lectura) · `none` (sin acceso). El propietario es siempre `admin`.
- **De plataforma** (`role` del usuario): `client` · `employee` · `admin` · `superadmin`.
