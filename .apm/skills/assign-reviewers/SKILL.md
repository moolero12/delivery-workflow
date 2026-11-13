---
name: assign-reviewers
description: "Verifica los logins ya resueltos, pide su revisión en la pull request y la saca de draft. La ejecuta create-pr al pedir revisión."
---

### ASSIGN_REVIEWERS

La ejecuta `create-pr` con la PR y los logins de GitHub ya resueltos. Cada llamada a GitHub va por `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git: lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. No llamar a `gh` directamente: usaría otra cuenta. Abajo, `gh.sh` es `bash "<carpeta de esta skill>/scripts/gh.sh"`. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/assign-reviewers`.

1. Leer autor, borrador y revisores actuales con `gh.sh pr view NUMERO --repo OWNER/REPO --json author,isDraft,reviewRequests`. Excluir al autor y deduplicar logins.
2. Verificar en vivo que cada login sigue siendo colaborador mediante `gh.sh api repos/OWNER/REPO/collaborators/LOGIN`; un rechazo no autoriza a escoger otra persona.
3. Solicitar solo revisores que falten y pasar a lista para revisión cuando se haya pedido. Con `gh.sh pr edit NUMERO --repo OWNER/REPO --add-reviewer LOGIN` y `gh.sh pr ready NUMERO --repo OWNER/REPO` si estaba en borrador.
4. Consultar la PR para confirmar resultado. Si una escritura falla o se interrumpe, leer antes de repetir; no presentar una revisión como pedida sin verificarla.

No asignar al autor ni modificar tokens. Un fallo de permisos no borra alias ni acredita una solicitud de revisión.
