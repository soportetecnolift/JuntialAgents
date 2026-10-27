# JuntialAgents · backend

Agentes de IA (Telegram, web con voz, **empleados digitales**), CRM con campos personalizados, reglas de flujo, funciones JavaScript, conectores MCP, API pública v1 (`/docs`) y servidor MCP para Claude, ChatGPT y otras apps de IA.

La **identidad y la organización** las da **Juntial Center**: aquí se entra con «Entrar con Juntial Center» (SSO) y los permisos, las políticas de aprobación, las conexiones y los eventos se piden a Center.

Necesita **Node 22, MongoDB, Redis** y Juntial Center en marcha.
```bash
npm install && cp .env.example .env
npm run seed
npm run dev:api      # http://localhost:4000
npm run dev:worker
npm test             # necesita Redis
npm run test:e2e     # Center real + Agents real
```
- Contrato con Center: [`docs/CONTRATO.md`](docs/CONTRATO.md)
- Para programar aquí con Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Telegram tras cambiar de dominio: `npm run telegram:rewebhook`
