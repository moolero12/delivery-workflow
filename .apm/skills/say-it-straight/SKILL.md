---
name: say-it-straight
description: "Prosa en español para issues, spec, PRs y docs: declarativa, concreta y sin relleno defensivo. La usan create-issue, create-pr, concept-developer y concept-tester. Fuera de alcance: commits (commit-changes, inglés) y chat del orquestador."
---

# Skill: Say it straight

## 1. Perfil y Rol

- **Rol:** Reglas de prosa para lo que un humano lee en GitHub o en `docs/`.
- **Objetivo Principal:** Texto en español que dice qué hay, qué cambia y cómo se comprueba, sin disculparse ni adornar.
- **Tono de Comunicación:** Neutro, directo, en español.

## 2. Contexto y Alcance

- **Cuándo actuar:** Al redactar el cuerpo de una issue, `## Spec`, `## Plan`, `## Tasks`, el cuerpo de una PR, o el `README.md` y los `docs/` que el cambio toque. Al comprobar, `concept-tester` aplica estas reglas además de la verdad frente al código.
- **Fuera de alcance:** Títulos de issue y PR (inglés, plantillas). Mensajes de commit y desglose (`commit-changes`, inglés). Respuestas del orquestador y entrevistas. No traduzcas identificadores de código.

Precedencia:

1. Verdad y **Huecos** (no inventes; si falta un dato, hueco y para).
2. Plantillas del tipo y de `issue-spec`. **Fuera de esto** es alcance: no lo borres como disclaimer.
3. `docs/STYLE.md` del proyecto consumidor, si existe.
4. Esta skill.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Recepción:** Identifica qué bloque vas a escribir o revisar.
2. **Validación:** Comprueba que cada afirmación se rastrea a código, issue, doc o comprobación. Si no, hueco o quita la frase.
3. **Procesamiento:**
   - Abre con el punto: qué hace, qué cubre o qué cambió.
   - Un párrafo, un trabajo; voz activa; verbos concretos.
   - Un hecho, un sitio; el resto enlaza. No repitas lo mismo en spec y en docs.
   - No narres el chat, las rondas, los agentes ni «como se comentó».
   - Quita muletillas y hedges apilados sin sustituir precisión real.
4. **Formateo:** Respeta la plantilla y las secciones que toque; no conviertas una spec en tutorial ni un ADR en changelog.

## 4. Herramientas y APIs Asignadas

- **Plantillas de `create-issue` y `create-pr-base`:** La forma del cuerpo.
- **Plantillas de `issue-spec`:** La forma de Spec, Plan y Tasks.
- **`docs/STYLE.md` del proyecto:** Si existe, manda sobre tono local en docs del consumidor.

## 5. Manejo de Errores y Excepciones

### Reglas de escritura

- **Afirma el alcance:** «El cambio cubre X», no «esto no pretende cubrir todo Y».
- **Conserva límites válidos:** Huecos, Fuera de esto, RNF y condiciones que cambian la interpretación.
- **Conclusión primero** en cada bloque (issue, sección de spec, párrafo de PR).
- **Forma afirmativa** cuando sea posible; **lenguaje concreto**; **omite palabras de más**.

### Construcciones a evitar (salvo que la precisión lo exija)

«Cabe destacar», «es importante mencionar», «no se pretende», «esto no quiere decir», «en este sentido», «a día de hoy», «básicamente», «simplemente», «obviamente», «claro está», cadenas del tipo «podría quizás potencialmente».

### Inspiración

Reglas destiladas de guías de prosa técnica y de estilo claro; no se copian skills externas en el paquete.
