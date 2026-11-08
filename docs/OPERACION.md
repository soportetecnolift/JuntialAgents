# Operación de JuntialAgents (backend)

## Arrancar
| Modo | Comandos |
|---|---|
| Desarrollo | `npm run dev:api` y `npm run dev:worker` (en terminales separadas) |
| Servidor | `npm run start:api` y `npm run start:worker` (o con PM2: `juntial-local/ecosystem.config.cjs`) |
| Máquina pequeña | `npm run start:all` (API y worker en un proceso) |

**Orden:** MongoDB y Redis → **Center** → Agents (API y worker) → panel.
Primera vez: `npm install`, `.env` a partir de `.env.example` y `npm run seed` (planes).

## Comprobar que está sano
| Qué | Dónde | Esperado |
|---|---|---|
| API viva | `GET /healthz` | `{"ok":true}` |
| API lista (Mongo y Redis) | `GET /readyz` | `{"ok":true}` |
| Métricas | `GET /metrics` | Formato Prometheus |
| Procesos | `pm2 status` | `agents-api` y `agents-worker` en *online* |
| Colas | Panel de administración → estadísticas | Sin colas atascadas ni muchos fallidos |

Recomendado: un vigilante externo (p. ej. UptimeRobot, gratuito) sobre `/healthz` de Agents y de Center, que te avise si se caen.

## Registros (logs)
- Formato JSON (pino). Cada petición lleva un **`requestId`**, que también aparece en la respuesta de error que ve el usuario (`error.requestId`). **Es la forma de encontrar un error concreto.**
- Con PM2: `pm2 logs agents-api` / `pm2 logs agents-worker`.
- Por cliente: el **registro de actividad** de cada bot (`BotLog`, en el panel) muestra lo que hizo cada agente.
- Por empleado digital: pestaña *Trabajo* → traza paso a paso de cada ejecución.

## Diagnóstico rápido
| Síntoma | Mira primero |
|---|---|
| Nadie puede entrar | Center en marcha; `CENTER_URL`, `CENTER_APP_SECRET`; `CENTER_APPS` en Center con la `PUBLIC_API_URL` exacta |
| Error 503 «Juntial Center no responde» | Center caído o `CENTER_URL` mal |
| Un bot de Telegram no responde | Worker en marcha; webhook apuntando a `PUBLIC_API_URL` (`npm run telegram:rewebhook`); `BotLog` del bot |
| Un empleado no hace sus rutinas | Worker en marcha; horario laboral del puesto; pestaña *Trabajo* (omitidas / errores); está en pausa |
| Una aprobación no avanza | Si tiene política: Center → Aprobaciones (paso y quién decide). Si no: aprobadores del equipo y regla |
| «Límite alcanzado» | Plan de la organización (*admin* → organizaciones) y consumo del mes |
| Correos que no llegan | `SMTP_*`; cola `email` con fallidos; registros del worker |

## Copias de seguridad
El plan gratuito de MongoDB Atlas **no hace copias automáticas.** Haz una cada noche:
```bash
mongodump --uri="$MONGO_URI" --out="copias/agents-$(date +%F)"
```
Guárdalas fuera del PC (disco externo o nube) y **restaura una de prueba cada mes** en una base aparte:
```bash
mongorestore --uri="mongodb+srv://…/juntial_agents_restore" copias/agents-AAAA-MM-DD/juntial_agents
```
Redis **no necesita copia**: las colas se regeneran y las tareas programadas se resincronizan desde Mongo al arrancar el worker.

## Publicar una versión
Sigue `docs/CAMBIOS.md`. En el servidor:
```bash
git fetch --tags && git checkout vX.Y.Z
npm ci
pm2 restart agents-api agents-worker
```
**Volver atrás:** lo mismo con la etiqueta anterior. El worker termina los trabajos en curso antes de cerrarse (cierre ordenado).

## Cambiar de dominio o túnel
1. `PUBLIC_API_URL` (Agents) y la URL de la API de Agents en `CENTER_APPS` (Center).
2. Reiniciar Center, la API y el worker.
3. `npm run telegram:rewebhook`.

## Rotar secretos
| Secreto | Cómo |
|---|---|
| `CENTER_APP_SECRET` | Generar uno nuevo; ponerlo **a la vez** en Agents y en `CENTER_APPS` de Center; reiniciar los dos |
| `JWT_*` | Cambiarlos cierra todas las sesiones (la gente vuelve a entrar con SSO) |
| `ENCRYPTION_KEY` | **No cambiarla** sin migrar: dejaría ilegibles los tokens de bots, API keys de IA y credenciales guardadas |
| Contraseña de Mongo | Atlas → Database Access; actualizar `MONGO_URI` |

## Mantenimiento periódico
- **Semanal:** revisar errores en los registros y los trabajos fallidos de las colas.
- **Mensual:** restaurar una copia de prueba; actualizar dependencias en una rama (`npm outdated`, con pruebas); revisar el consumo de los planes.
- **Trimestral:** revisar `docs/CONTRATO.md`, la deuda conocida (`docs/ARQUITECTURA.md` §11) y los costes.
