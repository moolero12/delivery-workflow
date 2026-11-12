# El token de GitHub sale del .env del proyecto

Todo lo que el paquete hace en GitHub va por `gh`, lanzado desde `gh.sh` con el `GITHUB_TOKEN` del `.env` de la raíz del proyecto. Se quita el servidor MCP de GitHub de `apm.yml`. Cada persona pone en su `.env` un token de su propia cuenta, y el `.env` tiene que estar en `.gitignore`.

Antes había dos credenciales: el MCP leía `GITHUB_TOKEN` del entorno al arrancar la herramienta, y los scripts usaban la sesión de `gh`. Una herramienta abierta desde el escritorio no ve las variables de la terminal, así que el MCP fallaba si no se abría desde la terminal. Las herramientas solo resuelven `${GITHUB_TOKEN}` desde el entorno, no desde un fichero, así que un `.env` no arreglaba el MCP. Se descartó mantenerlo detrás de un proxy local que leyera el `.env`: más código para lo mismo que ya hace `gh`.

Se descartó un token compartido del proyecto: la issue, la pull request y las asignaciones saldrían a nombre de esa cuenta, y los commits y el push a nombre de cada persona.

## Consecuencias

- `gh.sh` nunca usa la sesión de `gh` ni las variables del entorno: si falta el `.env`, falta `GITHUB_TOKEN` o el `.env` no está ignorado, falla sin llamar a GitHub. `gh` no necesita `gh auth login`.
- `gh.sh` lee el `.env` línea a línea y no lo ejecuta. Acepta `export`, comillas y un comentario `# …` detrás del valor.
- En un worktree sin `.env`, `gh.sh` usa el de la copia principal del repositorio.
- `gh.sh` deja el token también en `GH_ENTERPRISE_TOKEN`, que es el que `gh` usa cuando `GH_HOST` no es github.com.
- `check-status` dice de qué cuenta es el token. El orquestador para si falta o GitHub lo rechaza.
- `gh.sh` se copia igual en cada skill que llama a GitHub, porque cada carpeta de skill viaja sola. Un test comprueba que las copias son iguales.
- La instalación ya no escribe ningún token en la configuración de las herramientas: sobran `env -u GITHUB_TOKEN`, la comprobación de tokens y la cabecera `X-MCP-Features` de Cursor.
- El push sigue usando las credenciales de git de cada persona.
