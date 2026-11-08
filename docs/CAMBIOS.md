# Proceso de cambios

Objetivo: **ningún cambio llega a los clientes sin estar revisado, probado y con forma de deshacerse.** Vale igual para personas y para trabajadores de Claude Code.

## El ciclo
1. **Issue**: qué se quiere y por qué. Un issue = un cambio pequeño y entendible.
2. **Rama** desde `main`: `tipo/descripcion-corta` (`feat/filtro-fechas`, `fix/refresh-401`, `docs/arquitectura`).
3. **Cambio + prueba.** Todo cambio de comportamiento lleva su prueba; un fallo corregido lleva la prueba que lo reproduce.
4. ***Pull request*** con la plantilla rellena. La integración continua tiene que estar en verde.
5. **Revisión humana.** Un trabajador de Claude Code nunca fusiona: propone.
6. **Fusión** a `main` (*squash*).
7. **Staging**: se despliega y se comprueba con datos parecidos a los reales.
8. **Versión**: etiqueta `vX.Y.Z` + entrada en `CHANGELOG.md`.
9. **Producción** en un horario tranquilo, vigilando los registros la primera hora.

## Entornos
| Entorno | Base de datos | Quién lo usa |
|---|---|---|
| Local | `juntial_<app>_dev` | Quien programa |
| Staging | `juntial_<app>_staging` | Comprobación antes de publicar |
| Producción | `juntial_<app>` | Clientes |

Cada entorno tiene su `.env` y sus secretos. **Nunca se prueba contra la base de producción.**

## Versiones (SemVer)
- **Parche** (`1.2.3 → 1.2.4`): corrección sin cambios visibles.
- **Menor** (`1.2 → 1.3`): algo nuevo, compatible con lo anterior.
- **Mayor** (`1 → 2`): rompe algo (API, contrato, datos). Requiere plan de migración y aviso previo.

## Reglas que evitan problemas graves
1. **Contrato entre Center y las apps** (`docs/CONTRATO.md`): primero se **añade** lo nuevo, después se pasan las apps, y al final se **retira** lo viejo. Si se rompe, se sube la versión del contrato y Center mantiene la anterior un tiempo. Antes de publicar Center o una app: `npm run test:e2e` (en Agents).
2. **Base de datos: expandir y luego contraer.** Primero se añade el campo nuevo (el código viejo lo ignora); después se migran los datos con un script probado en staging; el campo viejo se quita en otra versión. Así **volver a la versión anterior siempre es posible**.
3. **Copias de seguridad antes de cada publicación** que toque datos, y una restauración de prueba al mes.
4. **Lo grande se publica apagado** (interruptor por organización): primero una organización de prueba, después un cliente y por último todos.
5. **Secretos fuera del código**: nunca en el repositorio, ni siquiera en `.env.example` (solo valores de ejemplo).
6. **Volver atrás = desplegar la etiqueta anterior.** Si un cambio no se puede deshacer así, el *pull request* tiene que explicar cómo se deshace.

## Si algo sale mal en producción
1. **Parar el daño**: volver a la versión anterior.
2. Avisar a los clientes afectados.
3. Buscar la causa (registros por `requestId`).
4. Corregir con su prueba y seguir el ciclo normal.
5. Escribir en `docs/incidentes/AAAA-MM-DD-titulo.md` qué pasó, el impacto, la causa y qué se cambia para que no se repita. Sin culpables.
