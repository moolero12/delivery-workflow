---
name: check-status
description: "Resume la rama actual, la rama base, si el .env tiene el token de GitHub, la cuenta del token y Node 20+, el remoto y los cambios sin commit. Úsala antes de elegir el momento."
---

### Herramienta: CHECK_STATUS

- **Descripción**: Úsala única y exclusivamente cuando necesites saber la rama actual, la rama base, si hay cambios sin commit, si la rama sigue a un remoto, si el `.env` del proyecto tiene `GITHUB_TOKEN`, de qué cuenta es, si está Node 20+ y si los agentes tienen modelo.

- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/check-status.sh"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/check-status`.

#### Especificación de Argumentos

No recibe argumentos.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: El script escribe, en este orden, el repositorio, la rama, la rama base, el token de GitHub, GitHub CLI, Node, los modelos de los agentes (`Modelos:`: sin configurar, configurado o desincronizado), el remoto con los commits por subir y por bajar, el último commit, la pull request abierta de esta rama si hay token (número, `reviewDecision` e issue de `Closes #N`), los ficheros preparados, los modificados sin preparar y los que no tienen seguimiento. Si el código de salida no es 0, lee el error y comunícalo. No inventes la rama ni los ficheros. Si la línea de la pull request dice `CHANGES_REQUESTED` y una issue, el momento es cambios pedidos.
- **Si la rama base no se detecta**: Pide a la persona que defina `GIT_WORKFLOW_BASE` con el nombre de su rama base.
- **Si falta el token de GitHub**: Todo lo que toca GitHub va a fallar. Repite a la persona el error del script: tiene que crear un `.env` en la raíz del proyecto con `GITHUB_TOKEN=su_token`, con un token de su propia cuenta, y tener `.env` en `.gitignore`. No hace falta reiniciar nada: los scripts leen el `.env` en cada llamada. No uses `gh auth login` ni otra variable del entorno.
- **Si GitHub rechaza el token**: Pide a la persona que cree otro token y lo cambie en el `.env`.
- **Si `Modelos:` dice «sin configurar» o «desincronizado»**: No es un error y no bloquea nada. Dilo una vez: los agentes usan el modelo del chat, y para elegir uno la persona ejecuta `/configure-models` (tras `apm install` o `apm update` se vuelven a poner las líneas de modelo que `apm install` borra). Si dice «no se pudo comprobar», sigue.
- **Si falta `gh` o Node 20+**: La issue, la pull request, las etiquetas, la spec en la issue y la caché de revisores van a fallar. Pide a la persona que los instale antes de dejar la tarea escrita.
