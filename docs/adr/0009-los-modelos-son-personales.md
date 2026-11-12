# El modelo de cada agente es personal y no se sube a git

Cada agente puede llevar un `model`, y `configure-models` lo escribe en los archivos que `apm install` despliega (`.cursor/agents/…`, `.claude/agents/…`, `.codex/agents/…`). El modelo depende de la suscripción de cada persona, por lo que esas líneas no deben llegar al repositorio: los archivos de agentes del paquete son resultado de la instalación y la línea `model` es de cada persona. Gestionar el `.gitignore` queda fuera del alcance de la skill. Las elecciones se guardan en `.git/delivery-workflow-models.json`, que git no ve, y `apply` es idempotente, de modo que puede repetirse tras cada `apm install`.

Los archivos desplegados son resultado de una instalación: `apm install` los vuelve a escribir y, como se comprobó con `apm` 0.35.0, elimina la línea `model` sin avisar. Un `apply` repetible es coherente con ese comportamiento. Las preguntas las formula la skill, no el script, conforme a la decisión 0001.

## Opciones consideradas

- **Ajuste de equipo:** subir los modelos al repositorio, con un modelo por agente para todos. Se descarta: exige que todos dispongan del mismo modelo, lo cual no ocurre, y un modelo no disponible hace fallar al agente o lo redirige sin aviso al modelo del chat.
- **Subir las líneas y vivir con las diferencias:** cada persona edita y los cambios de `model` entran en los commits. Se descarta: genera ruido en cada pull request y conflictos continuos.
- **Un archivo de elecciones dentro del proyecto:** más visible, pero habría que ignorarlo y no se sincroniza con nada. Se prefiere `.git/`, como la caché de revisores.

## Consecuencias

- Tras `apm install` o `apm update` es necesario volver a aplicar. `check-status` lo indica con «desincronizado» y el orquestador lo comunica una sola vez, sin interrumpir el flujo. `apm audit` marca los agentes como modificados: es lo esperado.
- Cada persona decide cómo evitar que la línea `model` llegue a los commits; la skill no modifica el `.gitignore` ni el índice de git.
- El catálogo de agentes (`agent-profiles.json`) debe listar exactamente los de `.apm/agents/`: una prueba falla si se añade un agente sin ficha, para que no quede sin modelo.
- El nombre del modelo debe ser el que facilita la herramienta. Si no lo reconoce, el agente usa el modelo del chat sin avisar; por eso la lista se obtiene de la herramienta y los valores escritos a mano generan un aviso.
- Cada herramienta aporta un detector y su formato de archivo (`.md` o `.toml`); el catálogo y la escritura son comunes.
