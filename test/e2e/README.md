# Prueba entre servicios (Center real + Agents real)

Arranca **Juntial Center** (proceso hijo) y **JuntialAgents** (este proceso) de verdad, cada uno con su base simulada, y comprueba por HTTP:
1. SSO «Entrar con Juntial Center».
2. Aprobación con política: el empleado pide, Center decide (Pepe vota por Telegram) y Agents ejecuta.
3. Claude conecta al MCP de Agents con el OAuth de Center.

```bash
# desde juntial-agents-bk, con juntial-center-bk al lado y ambos con npm install hecho
CENTER_DIR=../juntial-center-bk AGENTS_DIR=. npm run test:e2e
```
Necesita Redis (usa la base de datos 14).
