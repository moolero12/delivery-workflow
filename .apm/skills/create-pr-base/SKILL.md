---
name: create-pr-base
description: "Abre la pull request de la rama de trabajo contra la rama base, en draft, asignada a la cuenta del token y con la etiqueta del tipo, en una sola llamada. Úsala desde el subagente create-pr."
---

### Herramienta: CREATE_PR_BASE

- **Descripción**: Úsala desde el subagente `create-pr` para abrir la pull request contra la rama base, directamente en draft, asignada a la cuenta del token y con la etiqueta del tipo, en una misma invocación. No la uses para enlazar la issue: eso es `link-pr-to-issue`.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/create-pr-base.sh" "[RAMA]" "[TITULO]" "[CUERPO]" "[TIPO]" "[BASE]"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/create-pr-base`. Requiere GitHub CLI y el `GITHUB_TOKEN` del `.env` del proyecto: la cuenta del token será el autor de la PR y `--assignee "@me"` la persona asignada. El script nunca usa la sesión de `gh`.

Fuente de la forma del cuerpo: [github-pr](https://www.skills.sh/gentleman-programming/gentleman-skills/github-pr), adaptada a este paquete.

#### Especificación de Argumentos

1. **RAMA** _(Obligatorio)_: La rama subida, que se pasa como `--head`.
2. **TITULO** _(Obligatorio)_: El título de la issue, con su misma forma: En inglés, de menos de 72 caracteres, empieza por un verbo en imperativo con mayúscula (`Add`, `Fix`, `Document`…), sin el tipo delante, sin número de issue y sin punto final. Ejemplo: `Add a delivery-workflow test note`, no `docs: añadir nota de prueba`. Si te llega en español o con el tipo delante, tradúcelo y reescríbelo antes de seguir. El script lo comprueba con `check-title.sh` y no abre la PR si no pasa.
3. **CUERPO** _(Obligatorio)_: Ruta de un fichero temporal con la descripción en español y la plantilla del tipo, `<carpeta de esta skill>/assets/<tipo>-pull-request.md`. Deja la sección Issue con `Closes #` sin número: lo completa `link-pr-to-issue`. No nombres la issue en ninguna otra parte del cuerpo: ni «la issue #N» ni el número suelto. Si el tipo no tiene plantilla, usa la más cercana.
4. **TIPO** _(Obligatorio)_: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Es también la etiqueta.
5. **BASE** _(Opcional)_: La base con la que se creó la rama, si no es la rama base detectada.

#### Reglas de Invocación Críticas

- **Etiqueta**: El script crea la etiqueta del tipo si falta, con `ensure-label.sh`. Si la cuenta no puede crearla, abre la PR sin etiqueta y lo dice: comunícalo.
- **PR existente**: Si ya hay una PR abierta de esa rama hacia la base, el script devuelve su URL sin tocarla. Para actualizarla, edita el cuerpo con `bash "<carpeta de esta skill>/scripts/gh.sh" pr edit N --body-file FICHERO` conservando la línea `Closes #N`, y usa `assign-author` y `create-draft` cuando haga falta.
- **Título**: Si el script dice que el título no vale, corrígelo según el mensaje y vuelve a lanzarlo.
- **Procesamiento de respuestas**: Si el código de salida es 0, devuelve la URL y la base, y confirma draft, asignación y etiqueta. Si falla, comunica el error.
