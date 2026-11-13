# Avisos de revisión de PR en Discord

La acción compuesta de `.github/actions/discord-pr-notifications/` verifica una PR hacia la base configurada y publica el repositorio, un resumen, el enlace y los revisores solicitados en GitHub. No utiliza código de la PR. Con al menos dos revisores solicitados, publica aunque ninguno tenga relación conocida con Discord; menciona solo a los verificados y muestra los demás logins como «sin mención de Discord». Si una relación se confirma más tarde, envía un aviso adicional solo para esa persona.

## Activación optativa y nombres distintos

Ninguna skill ni agente del paquete consulta Discord o condiciona una solicitud de revisión. Instalar el paquete mediante APM no instala estos workflows: cada repositorio opta por ellos al añadir sus archivos de `.github/workflows/` y configurar el entorno protegido. `delivery-workflow` los incluye para sus propias PR; aTempo podrá activar la misma acción desde sus workflows fijados al SHA de una versión publicada.

El emisor busca primero la relación cifrada de 48 horas y luego una coincidencia exacta y única entre login de GitHub y usuario de Discord. Si los nombres son distintos, el autor de la PR o un miembro autorizado puede escribir `/discord-map LOGIN_GITHUB ID_DISCORD` en un comentario de la PR, sustituyendo ambos valores por el login y el ID reales. El ID se obtiene desde Discord con el modo desarrollador y «Copiar ID de usuario». El emisor valida la autoría del comentario, que el login sea un revisor solicitado y que el ID pertenezca al servidor. El comentario es visible para quien pueda leer la PR y deja de utilizarse a las 48 horas, aunque permanece en su historial. No contiene tokens ni claves. Confirmar la relación es opcional: la PR y el aviso continúan sin esa mención.

## Avisos de este repositorio

Los workflows `.github/workflows/discord-pr-trigger.yml` y `.github/workflows/discord-pr-confirmation-trigger.yml` recogen una PR hacia `staging` o un comentario `/discord-map` y suben solo el número de PR. Ninguno recibe secretos ni ejecuta código de la PR. El emisor `.github/workflows/discord-pr-publish.yml` vive en `staging`, la rama predeterminada, y usa la acción local del commit confiable de esa rama. Una PR creada manualmente sigue exactamente el mismo camino.

El administrador configura en el entorno protegido `discord-pr-notifications`, limitado a `staging`, los secretos `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` y las variables `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`. La clave debe ser de 32 bytes codificados en base64. El bot necesita permiso para buscar miembros y publicar en el canal. Tras fusionar los workflows en `staging`, se comprueba con una PR real que el aviso aparece una sola vez aunque se repita la ejecución.

El emisor descarga el artefacto de la ejecución completada, vuelve a consultar la PR en GitHub y verifica repositorio, rama, estado, ejecución y revisores antes de usar los secretos. La acción cifra las relaciones con AES-256-GCM, guarda cada entrada durante 48 horas en artefactos cifrados y registra por separado el anuncio inicial, los revisores mostrados y los ya mencionados. Así evita duplicados incluso cuando el primer aviso no lleva menciones. El grupo de concurrencia serializa el acceso a la caché. Discord permite hasta 100 menciones explícitas por mensaje; si el contenido supera los 2000 caracteres, la acción falla sin publicar.

La acción necesita `actions: read`, `pull-requests: read` e `issues: write` en el token de GitHub. La caché y el registro se leen desde el repositorio esperado; los IDs y secretos se pasan por inputs y no forman parte del paquete.
