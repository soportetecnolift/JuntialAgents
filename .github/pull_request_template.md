## Qué cambia
<!-- En dos o tres frases. Enlaza el issue: Closes #123 -->

## Por qué

## Cómo se ha probado
- [ ] `npm test` en verde (o `npm run build` en los paneles)
- [ ] Prueba nueva que cubre este cambio (o explica por qué no hace falta)
- [ ] Probado a mano en local: <!-- qué pasos -->

## Riesgo
- [ ] Toca el **contrato** con Center u otras apps → `docs/CONTRATO.md` actualizado y `npm run test:e2e` en verde
- [ ] Toca la **base de datos** → compatible con la versión anterior (expandir y luego contraer)
- [ ] Toca **seguridad** (login, permisos, secretos, aislamiento entre organizaciones)
- [ ] Necesita **variables nuevas** → añadidas a `.env.example` y documentadas

## Cómo se deshace
<!-- Normalmente: «desplegar la versión anterior». Si no basta, explica cómo. -->

## Documentación
- [ ] `docs/ARQUITECTURA.md` y `CLAUDE.md` siguen siendo ciertos (o los he actualizado)
- [ ] Entrada en `CHANGELOG.md` (sección «Sin publicar»)
