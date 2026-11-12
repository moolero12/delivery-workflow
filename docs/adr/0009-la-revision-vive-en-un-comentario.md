# La revisión vive en un comentario

Cuando una pull request pide cambios, la spec, el plan y las tasks de esa petición se escriben en un comentario de la misma issue, no en el cuerpo. El cuerpo se queda con la primera entrega. El comentario usa las plantillas de `issue-spec/assets` y empieza por `<!-- Revisión N -->`. Cada ronda sigue dejando su propio comentario, como ya hace el ciclo.

Se descartó reescribir `## Spec`, `## Plan` y `## Tasks` del cuerpo: se perdería lo ya implementado y el límite de 65 536 caracteres es de ese cuerpo. Se descartó abrir otra issue: dos sitios para la misma tarea, y la PR ya cierra la issue original.

## Consecuencias

- El ciclo de cambios pedidos opera con `--revision` sobre el último comentario `<!-- Revisión N -->`.
- El estado Borrador / Implementada / Fallida de esa pasada vive en ese comentario. El cuerpo no se toca.
- No se abre otra issue. El cuerpo no se reescribe.
- Una segunda petición de cambios publica `<!-- Revisión 2 -->`. El ciclo usa siempre la última.
