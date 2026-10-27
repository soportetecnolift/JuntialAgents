# 0001 · Juntial Center separado de JuntialAgents

**Estado:** aceptada.

**Contexto.** Center (identidad y organización) vivía dentro del backend de JuntialAgents. Para sumar más apps (JuntialTellAI…) y tener un programador por app, cada pieza tiene que poder evolucionar y desplegarse sola.

**Decisión.**
- Center es un servicio propio, con su base de datos, y es **proveedor de identidad** (OAuth 2.1 / SSO), **administración de la organización** y **servicio de aprobaciones con políticas** para todas las apps.
- Las apps se integran por el contrato (`docs/CONTRATO.md`): SSO de primera parte, API interna con secreto por app, avisos firmados e introspección de tokens para sus MCP.
- Cada app guarda copias locales de usuario y organización, con los mismos ids que Center.
- Center funciona sin Redis ni worker: con un sustituto en Mongo y envíos dentro del propio proceso.

**Consecuencias.**
- Una app nueva no toca el código de las demás: se registra en `CENTER_APPS` y en el catálogo, y sigue el contrato.
- Si Center se cae, las apps usan los últimos permisos conocidos durante un tiempo y no se salta ninguna aprobación.
- Cambiar el contrato exige versión y aviso a las apps.
