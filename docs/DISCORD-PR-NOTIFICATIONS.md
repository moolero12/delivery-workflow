# Avisos de revisión de PR en Discord

La acción compuesta de `.github/actions/discord-pr-notifications/` verifica una PR hacia la base configurada, busca dos revisores por coincidencia exacta y única del login de GitHub con el nombre de usuario de Discord y publica un resumen con el enlace y las dos menciones. No utiliza código de la PR. Con cero o un revisor termina sin publicar; si hay más de dos, identidades ausentes o ambiguas, falla sin publicar.

## Usarla en aTempo después de publicar v0.2.0

1. Copiar `examples/atempo/discord-pr-trigger.yml` y `examples/atempo/discord-pr-publish.yml` a `.github/workflows/` de aTempo en una nueva PR. El emisor debe existir en `main`, la rama predeterminada, para que GitHub procese `workflow_run`. La PR #41 anterior no se reutiliza.
2. Tras la release, sustituir `REPLACE_WITH_V0_2_0_COMMIT_SHA` por el SHA completo del commit de `main` etiquetado como `v0.2.0`. Mantener el entorno protegido `discord-pr-notifications` y restringirlo a la rama de confianza.
3. Configurar en ese entorno `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` como secretos, y `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID` como variables. La clave debe ser de 32 bytes codificados en base64. El bot existente debe poder buscar miembros y publicar mensajes en el canal.
4. Comprobar con una PR real hacia `staging` que el mensaje se publica y que una nueva ejecución con la misma pareja de revisores no duplica el aviso. Esa comprobación pertenece a la PR posterior de aTempo.

El disparador no usa secretos y solo sube un número de PR. El emisor descarga ese artefacto de la ejecución completada, vuelve a consultar la PR en GitHub y verifica repositorio, rama, estado, ejecución y revisores antes de usar los secretos. La acción cifra las relaciones con AES-256-GCM, guarda cada entrada durante 48 horas en artefactos cifrados y registra las parejas notificadas en un comentario cifrado de la PR. El grupo de concurrencia serializa el acceso a la caché compartida.

La acción necesita `actions: read`, `pull-requests: read` e `issues: write` en el token de GitHub. La caché y el registro se leen desde el repositorio esperado; los IDs y secretos se pasan por inputs y no forman parte del paquete.
