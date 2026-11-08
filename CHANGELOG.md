# Registro de cambios

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) · Versiones: [SemVer](https://semver.org/lang/es/).

## [Sin publicar]
### Añadido
- Documentación de arquitectura, operación y proceso de cambios (`docs/`), límites de Claude Code (`.claude/settings.json`) y plantilla de *pull request*.
- Permisos de Claude Code para `gh`: puede abrir, ver y listar *pull requests* y consultar sus comprobaciones (`gh pr create/view/checks/list`); tiene prohibido fusionarlos (`gh pr merge`) y borrar repositorios (`gh repo delete`).
- `.gitattributes`: todo el texto se normaliza a finales de línea LF (`* text=auto eol=lf`), también al descargarlo en Windows; las imágenes se marcan como binarias.

## [1.0.0] - 2026-10-27
### Añadido
- Separación de Juntial Center y JuntialAgents en servicios independientes, conectados por el contrato v1 (`docs/CONTRATO.md` en los backends).

### Añadido (después de 1.0.0, sin etiqueta)
- `AUTH_API_URL`: el panel puede usar una dirección distinta de la pública (por ejemplo, local con túnel). El login se completa con un pase de un solo uso.
