# Modelos de los agentes

Cada agente puede ejecutarse con un modelo distinto: uno de mayor capacidad para el que redacta la especificación y uno ligero para el que lanza un script. Como cada persona dispone de una suscripción diferente, el paquete no incluye el modelo: se elige con `/configure-models` (en Codex, `$configure-models`). Es un paso opcional.

Compatible con **Cursor, Claude Code y Codex**, en las que tengan carpeta de agentes en el proyecto.

## Cómo se usa

1. `apm install` (o `apm update`).
2. `/configure-models`: detecta los modelos disponibles, propone uno por agente indicando el motivo y solicita confirmación una sola vez: «¿Los aceptas? [Enter = sí | nombre del agente para cambiarlo]».
3. Para cambiar uno, indica el nombre del agente y el modelo (de la lista o escrito a mano). Enter equivale a no asignar modelo, de modo que el agente hereda el del chat.

Las elecciones se guardan en `.git/delivery-workflow-models.json`: son personales y git no las registra. Sin la skill, desde la raíz del proyecto (la carpeta es `.claude/skills` en Claude Code y `.agents/skills` en Cursor y Codex):

```bash
node .agents/skills/configure-models/scripts/configure-models.mjs apply --set code-developer=NOMBRE   # inherit = sin modelo
node .agents/skills/configure-models/scripts/configure-models.mjs reset                                # elimina todo
```

## Niveles

Cada agente tiene asignado un nivel y cada herramienta selecciona, entre los modelos disponibles, el que corresponde. La configuración está en [agent-profiles.json](../.apm/skills/configure-models/assets/agent-profiles.json): para modificar el criterio, edite ese archivo (prevalece el primer patrón que coincide).

| Agente | Nivel | Por qué |
|---|---|---|
| `concept-developer` | pesado | Redacta la especificación y el plan: un error se propaga a todas las rondas posteriores. |
| `code-developer`, `code-tester`, `concept-tester` | estándar | Escriben código y pruebas y comparan la documentación con el código: un modelo insuficiente puede dar aprobaciones erróneas. |
| `create-issue`, `create-pr`, `create-branch`, `create-commit` | ligero | Completan una plantilla o ejecutan uno o dos scripts. |

## Después de `apm install` o `apm update`

`apm install` elimina la línea `model` de los agentes sin avisar (verificado con `apm` 0.35.0 en las tres herramientas). Por ello:

- `check-status` muestra `Modelos: desincronizado (cursor 0/8)`; si ningún agente lleva modelo, muestra `configurado, pero ningún agente lleva modelo`.
- `/configure-models` parte de lo guardado: con Enter (o `--yes`) se restaura. Sin la skill, `apply` sin argumentos lo hace sin preguntar. Un valor guardado se considera válido si el modelo sigue en la lista actual, si no se pudo leer la lista o si se escribió a mano (en este último caso se emite un aviso, pero se conserva). Si no había nada que proponer (herramienta no disponible, lista vacía), no se guarda nada y el siguiente `apply` vuelve a proponer. Solo `--set agente=inherit` registra «heredar».
- `apm audit` marcará esos agentes como modificados. Es el comportamiento esperado.

**Automatización (no incluida):** tras `apm lifecycle trust`, un bloque `lifecycle: post-install` en `apm.yml` con el comando `apply` lo ejecutó automáticamente en las pruebas. Se excluye porque ese bloque ejecuta comandos en cada instalación y cada persona debe decidir si lo autoriza.

## Por qué no se suben a git

El modelo depende de la suscripción de cada persona: si se versionara, quien no lo tuviera recibiría un agente inoperativo. Por ello los agentes del paquete se tratan como resultado de la instalación y la línea `model` no debe incluirse en los commits ([decisión 0009](adr/0009-los-modelos-son-personales.md)). Gestionar el `.gitignore` queda fuera del alcance de `/configure-models`.

## Notas por herramienta

**Cursor** (verificado con `cursor-agent` 2026.11.11, plan Plus)
- Lista de modelos: `cursor-agent --list-models` y, si falla, `cursor-agent models`. No se ejecuta `agent`, por ser un nombre demasiado genérico. Sin la CLI no hay lista: el modelo debe indicarse manualmente.
- El nombre exacto que figura en la lista es válido en el frontmatter (`grok-4.7-medium` se ejecutó con ese modelo). Un nombre desconocido **no genera error**: el agente usa el modelo del chat y solo se deja una nota en el resultado.
- La lista incluye modelos que el plan no permite (`grok-4.7-low` y `grok-4.7-high` fallaron como subagente). Los patrones son por familia (`claude-*`, `gpt-5*`, `composer`), sin versiones fijas; si uno falla, se cambia con `--set`. Un administrador Enterprise puede restringir más modelos.
- Un `cursor-agent` de 2025 interpreta `models` como una instrucción al agente. Por ello se ejecuta después de `--list-models`, en una carpeta temporal vacía, con un límite de 10 s, y solo se acepta una salida que empiece por «Available models».
- Hay informes de que el IDE ignora `model` en determinados casos. Solo se verificó la CLI; en el IDE conviene comprobar qué modelo usó el subagente.
- Para comprobar un agente: `cursor-agent -p --trust --output-format stream-json "Usa el subagente X"` y revisar `model` en la llamada `taskToolCall`.

**Claude Code** (verificado con 2.1.322, plan Pro)
- No existe un comando que liste los modelos. Se ofrecen los alias `opus`, `sonnet` y `haiku` si `claude auth status` muestra una sesión activa, limitados por `availableModels` de los ajustes de usuario, proyecto y local cuando estén definidos (Claude Code combina esas listas; la lista gestionada por el administrador **no se lee**). Un nombre completo (`claude-opus-…`) escrito a mano se conserva en los `apply` posteriores, con un aviso si no figura en la lista. **No se filtra por plan** (solo se verificó Pro): la propuesta muestra el plan detectado y, si no incluye `opus`, puede cambiarse con `--set concept-developer=sonnet`.
- Los alias son válidos en el frontmatter: el resultado de `claude -p --output-format stream-json --verbose` incluye en `modelUsage` los modelos utilizados.
- Un nombre desconocido **sí falla** (error 404 al invocar al agente).
- `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` **no sobrescribió** `model: opus` del frontmatter en esa versión.

**Codex** (**no verificado con un Codex real**: no estaba instalado)
- Lista de modelos: `codex debug models` y, si falla, `~/.codex/models_cache.json` (o `$CODEX_HOME`). El lector acepta una lista o un objeto con `models` y reconoce `slug`, `id` o `model`. Los fixtures de las pruebas son manuales y los patrones de nivel (`gpt-N-codex`, `…-mini`) son una hipótesis. Se recomienda revisar la propuesta antes de aceptarla.
- Se escribe `model = "…"` en `.codex/agents/<agente>.toml`, a continuación de `name`. Según su documentación, es la clave que Codex lee como modelo del agente; no se ha comprobado.

Cada comando externo tiene un límite de 10 s: si no responde (por ejemplo, por falta de sesión iniciada), el resultado es «desconocido» y los agentes heredan el modelo del chat.
