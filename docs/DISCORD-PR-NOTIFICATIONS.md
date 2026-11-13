# Avisos de revisión de PR en Discord

La acción compuesta de `.github/actions/discord-pr-notifications/` verifica una PR hacia la base configurada, busca a cada revisor por coincidencia exacta y única del login de GitHub con el nombre de usuario de Discord y publica el repositorio de origen, un resumen, el enlace y todas las menciones. No utiliza código de la PR. Con cero o un revisor termina sin publicar; si alguna identidad está ausente o es ambigua, falla sin publicar.

## Avisos de este repositorio

Los workflows `.github/workflows/discord-pr-trigger.yml` y `.github/workflows/discord-pr-publish.yml` se activan para PR dirigidas a `staging`, también si se crean manualmente. El disparador no recibe secretos. El emisor vive en `staging`, la rama predeterminada de este repositorio, y usa la acción local del commit confiable de esa rama.

El administrador configura en el entorno protegido `discord-pr-notifications`, limitado a `staging`, los secretos `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` y las variables `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`. La clave debe ser de 32 bytes codificados en base64. El bot necesita permiso para buscar miembros y publicar en el canal. Tras fusionar los workflows en `staging`, se comprueba con una PR real que el aviso aparece una sola vez aunque se repita la ejecución.

El disparador no usa secretos y solo sube un número de PR. El emisor descarga ese artefacto de la ejecución completada, vuelve a consultar la PR en GitHub y verifica repositorio, rama, estado, ejecución y revisores antes de usar los secretos. La acción cifra las relaciones con AES-256-GCM, guarda cada entrada durante 48 horas en artefactos cifrados y registra los conjuntos de revisores notificados en un comentario cifrado de la PR. El grupo de concurrencia serializa el acceso a la caché. Se admiten desde dos hasta 100 revisores, el máximo de menciones explícitas de Discord; si el mensaje supera los 2000 caracteres, la acción falla sin publicar.

La acción necesita `actions: read`, `pull-requests: read` e `issues: write` en el token de GitHub. La caché y el registro se leen desde el repositorio esperado; los IDs y secretos se pasan por inputs y no forman parte del paquete.
