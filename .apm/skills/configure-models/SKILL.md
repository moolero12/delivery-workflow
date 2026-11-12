---
name: configure-models
description: "Elige el modelo de IA de cada agente del paquete según la suscripción de la persona y lo escribe en los archivos de los agentes. Úsala tras apm install o apm update, o cuando la persona quiera cambiar el modelo de un agente."
---

### Herramienta: CONFIGURE_MODELS

- **Descripción**: Úsala única y exclusivamente para elegir, con la persona, el modelo de cada agente (`concept-developer`, `code-developer`, …). Sin esta configuración los agentes usan el modelo del chat y nada falla. Funciona con Cursor, Claude Code y Codex.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/configure-models.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio git.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/configure-models`.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: lee los modelos y devuelve, por herramienta, la propuesta de cada agente (modelo, nivel, motivo y si viene de lo guardado). No escribe nada.
   - `apply`: escribe el modelo en cada agente y guarda la elección. Sin `--set` usa lo guardado o, si no hay nada, la propuesta.
   - `reset`: quita el modelo de todos los agentes y borra lo guardado.
2. **`--set agente=modelo`** _(Opcional, repetible)_: el modelo de ese agente. `inherit` quita el modelo (el agente usa el del chat). Exige `--target` si hay más de una herramienta: cada herramienta nombra sus modelos a su manera.
3. **`--yes` / `-y`** _(Opcional)_: acepta la propuesta sin preguntar.
4. **`--target cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas la respuesta con `--set`.
- **Con `--yes`**: Lanza `detect` y después `apply --yes` sin `--set`, sin preguntar nada. Muestra la tabla final.
- **Sin `--yes`**:
  1. Lanza `detect`. Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`.
  2. Muestra una tabla por herramienta con las columnas agente, modelo (`heredar` si es `null`) y motivo. Debajo, las `notes`. Si la detección es `unknown`, di el motivo, que ningún agente tiene modelo propuesto y que la persona puede escribir uno a mano.
  3. Pregunta **una vez**: «¿Los aceptas? [Enter = sí | nombre del agente para cambiarlo]». Si hay `saved`, di que son los modelos guardados.
  4. Si responde con el nombre de un agente, pregunta su modelo. Enséñale los de la lista detectada y acepta cualquier otro escrito a mano; Enter = `inherit`. Repite la pregunta hasta que acepte.
  5. Lanza `apply` con un `--set` por cada cambio. Si hay varias herramientas, un `apply --target T` por cada una, con solo sus cambios, y las que no cambian con un `apply` sin `--set`. Muestra la tabla final con lo que devuelve el script.
- **Un modelo escrito a mano**: Avisa de que si la herramienta no lo reconoce, Cursor usará el modelo del chat sin decir nada y Claude Code dará un error al llamar al agente. El script ya añade este aviso en `notes` si el modelo no está en la lista.
- **Después de `apm install` o `apm update`**: Instalar borra las líneas `model`. Si ya hay elecciones guardadas, `apply` sin argumentos las vuelve a poner sin preguntar nada. Dilo así a la persona.
- **Procesamiento de respuestas**: El script escribe JSON. `result` vale `cambiado`, `igual` o `ausente` (falta el archivo: pide `apm install`). Si el código de salida no es 0, lee el error y comunícalo. No inventes modelos ni resultados.
