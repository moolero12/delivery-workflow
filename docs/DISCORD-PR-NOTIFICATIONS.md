# Avisos de revisión de PR en Discord

La acción compuesta de `.github/actions/discord-pr-notifications/` verifica una PR hacia la base configurada y publica el repositorio, un resumen, el enlace y los revisores solicitados en GitHub. No utiliza código de la PR. Con al menos dos revisores solicitados, publica aunque ninguno tenga relación conocida con Discord; menciona solo a los verificados y muestra los demás logins como «sin mención de Discord». Si una relación se confirma más tarde, envía un aviso adicional solo para esa persona.

## Confirmar nombres distintos en el chat

Cuando se pide «que la revisen», la PR ya existe como borrador. `create-pr` resuelve primero los logins de GitHub y usa la skill `discord-reviewers` para consultar una caché local de 48 horas en `.git/`. Si la persona aporta en el chat un nombre de usuario de Discord, un apodo exacto del servidor o una mención/ID, guarda solo esa relación confirmada. No supone que los nombres de ambas plataformas sean iguales ni espera una respuesta para pedir la revisión.

Si dispone de una o más relaciones, el agente publica o actualiza un comentario técnico en la PR. Ese comentario contiene logins y nombres o IDs de Discord, visibles para quien pueda leer la PR; no contiene tokens ni claves. Si no puede publicarlo, continúa con la revisión y comunica el fallo. El emisor acepta comentarios recientes del autor de la PR o de un miembro autorizado del repositorio, comprueba que cada identidad corresponde a un miembro del servidor y guarda la relación resultante en su caché cifrada. El comentario deja de utilizarse a las 48 horas, aunque permanece en el historial de la PR.

## Avisos de este repositorio

Los workflows `.github/workflows/discord-pr-trigger.yml` y `.github/workflows/discord-pr-confirmation-trigger.yml` recogen una PR hacia `staging` o un comentario de confirmación y suben solo el número de PR. Ninguno recibe secretos ni ejecuta código de la PR. El emisor `.github/workflows/discord-pr-publish.yml` vive en `staging`, la rama predeterminada, y usa la acción local del commit confiable de esa rama. Una PR manual también avisa: primero busca coincidencias exactas y únicas; las relaciones con nombres distintos se pueden confirmar después en un comentario técnico reciente.

El administrador configura en el entorno protegido `discord-pr-notifications`, limitado a `staging`, los secretos `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` y las variables `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`. La clave debe ser de 32 bytes codificados en base64. El bot necesita permiso para buscar miembros y publicar en el canal. Tras fusionar los workflows en `staging`, se comprueba con una PR real que el aviso aparece una sola vez aunque se repita la ejecución.

El emisor descarga el artefacto de la ejecución completada, vuelve a consultar la PR en GitHub y verifica repositorio, rama, estado, ejecución y revisores antes de usar los secretos. La acción cifra las relaciones con AES-256-GCM, guarda cada entrada durante 48 horas en artefactos cifrados y registra por separado el anuncio inicial, los revisores mostrados y los ya mencionados. Así evita duplicados incluso cuando el primer aviso no lleva menciones. El grupo de concurrencia serializa el acceso a la caché. Discord permite hasta 100 menciones explícitas por mensaje; si el contenido supera los 2000 caracteres, la acción falla sin publicar.

La acción necesita `actions: read`, `pull-requests: read` e `issues: write` en el token de GitHub. La caché y el registro se leen desde el repositorio esperado; los IDs y secretos se pasan por inputs y no forman parte del paquete.
