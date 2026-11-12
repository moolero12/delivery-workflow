# La prosa del flujo sigue say-it-straight

Issues, spec, plan, tasks, cuerpos de PR y documentación del proyecto que el ciclo toque se escriben en **español**, con reglas de prosa declarativa en la skill `say-it-straight`. Los títulos de issue y PR y los commits siguen en **inglés** (`commit-changes`). El chat del orquestador y las entrevistas no usan esta skill.

Las reglas se destilaron de prácticas de prosa técnica y de estilo claro (conclusión primero, un hecho un sitio, sin texto defensivo). No se empaquetan skills externas ni guías que obliguen inglés en los docs del consumidor.

`create-issue`, `create-pr` y `concept-developer` la precargan al redactar. `concept-tester` la usa al comprobar verdad y prosa, sin editar.

## Opciones consideradas

- **Copiar skills de terceros en el manifiesto APM:** Más peso, idioma mixto y solapamiento con plantillas. Se descarta.
- **Solo `docs/STYLE.md` en cada proyecto:** No cubre issues ni spec en GitHub. Se complementa, no sustituye.
- **Incluir `concept-tester`:** Alinea estilo con verdad en cada ronda; no duplica `code-tester`.

## Consecuencias

- Hay diecinueve skills en `.apm/skills/` (la nueva no lleva scripts).
- Los consumidores reciben la skill al actualizar el paquete vía APM.
