---
name: discord-reviewers
description: "Pregunta en el chat por identidades de Discord desconocidas y comunica las relaciones confirmadas a la PR antes de solicitar revisores."
---

# Revisores de Discord

La usa `create-pr` cuando la persona pide revisión. La PR ya existe como borrador; este paso termina antes de solicitar revisores en GitHub. Desde la raíz del proyecto, ejecuta `node "<carpeta de esta skill>/scripts/discord-reviewers.mjs"`. La carpeta es `${CLAUDE_SKILL_DIR}` en Claude Code y `.agents/skills/discord-reviewers` en Cursor y Codex.

1. Después de resolver los logins de GitHub, consulta `get OWNER/REPO LOGIN...`. La caché local vive en `.git/`, separada por servidor, cuenta y repositorio. Cada relación caduca a las 48 horas.
2. Para cada login sin relación, pide en este chat el nombre de usuario de Discord, el apodo exacto del servidor o una mención/ID. Usa los nombres disponibles como pistas, pero no guardes una suposición. Si la respuesta no identifica a una persona con claridad, pide precisión. La comprobación final de pertenencia al servidor la hace el workflow protegido.
3. Guarda cada respuesta confirmada con `set OWNER/REPO LOGIN IDENTIDAD`. Si corrige una relación vigente, añade `--replace`. `remove OWNER/REPO LOGIN` la olvida.
4. Con al menos dos relaciones disponibles, ejecuta `publish OWNER/REPO NUMERO_PR LOGIN...` **antes** de `assign-reviewers`. Publica o actualiza un comentario técnico en la PR con solo esas relaciones; nunca incluye tokens. Comprueba que el comando devuelve éxito antes de solicitar la revisión.
5. Si hay más revisores y falta alguno, pregunta igualmente. Si la persona no puede resolverlo ahora, se puede pedir la revisión de todos: el aviso mencionará solo a los dos o más que el workflow confirme. Con menos de dos relaciones, no publiques el comentario ni pidas la revisión todavía.

Una PR creada manualmente no dispone de esta caché local. Su aviso queda pendiente hasta que existan al menos dos identidades verificadas. El comentario técnico sirve de puente hacia GitHub Actions; la caché local nunca contiene el token del bot.
