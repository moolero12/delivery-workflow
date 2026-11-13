---
name: discord-reviewers
description: "Reutiliza relaciones confirmadas de Discord y las comunica a la PR sin bloquear las revisiones de GitHub."
---

# Revisores de Discord

La usa `create-pr` cuando la persona pide revisión. La PR ya existe como borrador. Desde la raíz del proyecto, ejecuta `node "<carpeta de esta skill>/scripts/discord-reviewers.mjs"`. La carpeta es `${CLAUDE_SKILL_DIR}` en Claude Code y `.agents/skills/discord-reviewers` en Cursor y Codex.

1. Después de resolver los logins de GitHub, consulta `get OWNER/REPO LOGIN...`. La caché local vive en `.git/`, separada por servidor, cuenta y repositorio. Cada relación caduca a las 48 horas.
2. Si la persona proporciona en este chat el nombre de Discord, el apodo exacto del servidor o una mención/ID, guarda solo la relación confirmada. No adivines por parecido. Una relación ausente o dudosa no detiene la solicitud de revisión; comunícala al final como «sin mención de Discord». La comprobación final de pertenencia al servidor la hace el workflow protegido.
3. Guarda cada respuesta confirmada con `set OWNER/REPO LOGIN IDENTIDAD`. Si corrige una relación vigente, añade `--replace`. `remove OWNER/REPO LOGIN` la olvida.
4. Si existe al menos una relación, ejecuta `publish OWNER/REPO NUMERO_PR LOGIN...` para publicar o actualizar el comentario técnico en la PR. Incluye solo relaciones confirmadas y nunca tokens. Si falla este paso, comunica el fallo y continúa con `assign-reviewers`; se puede repetir la publicación después.
5. Solicita todos los revisores de GitHub resueltos aunque ninguno tenga relación con Discord. El aviso publicará la PR y sus logins cuando haya dos revisores solicitados; mencionará solo a quienes el workflow pueda verificar. Una relación confirmada después activará un nuevo aviso para esa persona.

Una PR creada manualmente puede avisar sin relaciones previas. El comentario técnico sirve de puente hacia GitHub Actions cuando se confirma una identidad; la caché local nunca contiene el token del bot.
