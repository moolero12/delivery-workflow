# Cambios respecto a `staging`

El paquete sale de dos piezas de la rama `staging` del repositorio de origen, [venturars/neoland-102026](https://github.com/venturars/neoland-102026), en el commit `73e25550`:

- **La plantilla de git**, [`exercises/git-workflow-agent-template`](https://github.com/venturars/neoland-102026/tree/staging/exercises/git-workflow-agent-template), con lo que entró hasta venturars/neoland-102026#1125 (plantillas por tipo, `knowledge`, PR con `gh`, caché de revisores).
- **El ciclo de agentes**, [`exercises/ChromaDB`](https://github.com/venturars/neoland-102026/tree/staging/exercises/ChromaDB) (`AGENTS.md`, `agents/` y `templates/specs/`).

Estos cambios las juntan en un paquete APM que se instala en cualquier proyecto, con Claude Code, Cursor o Codex. Lo que no aparece aquí está igual que en `staging`.

## Estructura

| En `staging` | Ahora | Por qué |
|---|---|---|
| `agents/create-issue.md`, `create-branch.md`, `create-commit.md`, `create-pr.md` | `.apm/agents/<nombre>.agent.md` | APM busca los subagentes en `.apm/agents/` con la extensión `.agent.md`. |
| `agents/launch-push.md` | — | El orquestador usa directamente la skill `launch-push` ([ADR 0001](docs/adr/0001-orquestador-y-entrevista-como-skills.md)). |
| `ChromaDB/agents/concept-developer.md`, `code-developer.md`, `code-tester.md`, `concept-tester.md` | `.apm/agents/<nombre>.agent.md` | Igual. Los nombres pasan a guiones (`code_developer` → `code-developer`). |
| `agents/git-workflow-agent.md` y `ChromaDB/AGENTS.md` | `.apm/skills/delivery-workflow/SKILL.md` | Un solo orquestador para el flujo de git y el ciclo. Es una skill porque tiene que poder preguntar a la persona ([ADR 0001](docs/adr/0001-orquestador-y-entrevista-como-skills.md)). Se invoca como `/delivery-workflow`. |
| `agents/help-me-to-think.md` | `.apm/skills/help-me-to-think/SKILL.md` | Pasa de subagente a skill: la entrevista espera las respuestas en la conversación ([ADR 0001](docs/adr/0001-orquestador-y-entrevista-como-skills.md)). |
| `skills/grill-with-docs/`, `skills/grill-me/` | `.apm/skills/entrevista-con-repo/`, `entrevista-libre/` | Renombradas: con el nombre de la skill de Matt Pocock, la del usuario (`~/.claude/skills/`) gana a la del proyecto y la tapa. |
| `skills/create-branch-from-staging/` y `skills/create-branch/` | `.apm/skills/create-branch/` | Fusionadas: la rama base se detecta y la base pasa a ser opcional ([ADR 0002](docs/adr/0002-rama-base-detectada.md)). |
| `skills/create-pr-base-staging/` | `.apm/skills/create-pr-base/` | La base ya no es siempre `staging`. |
| `tools/<script>` | `.apm/skills/<skill>/scripts/<script>` | APM copia cada carpeta de skill entera, pero no una carpeta `tools/` suelta. |
| `templates/issues/*_issue.md` | `.apm/skills/create-issue/assets/` | La plantilla viaja con la skill que la usa. |
| `templates/pull-request/*-pull-request.md` | `.apm/skills/create-pr-base/assets/` | Igual. |
| `ChromaDB/templates/specs/spec.md`, `plan.md`, `tasks.md` | `.apm/skills/issue-spec/assets/` | Igual, y pasan a ser secciones de la issue (ver Spec en la issue). |
| `MCPS/github-mcp-server/mcp.txt` | — | Se quita. El paquete no usa el MCP de GitHub: todo va por `gh` con el token del `.env` ([ADR 0007](docs/adr/0007-el-token-sale-del-env.md)). |
| — | `.apm/skills/<skill>/scripts/gh.sh` | Nuevo, igual en cada skill que llama a GitHub: lanza `gh` con el `GITHUB_TOKEN` del `.env`. |
| — | `.apm/skills/issue-spec/` | Nueva: lee y escribe la spec en la issue. |
| — | `.apm/skills/say-it-straight/` | Nueva: prosa en español declarativa para issue, spec, PR y docs; sin copiar skills externas ([ADR 0011](docs/adr/0011-say-it-straight.md)). |
| — | `apm.yml`, `README.md`, `CAMBIOS.md`, `GLOSSARY.md`, `docs/MANTENIMIENTO.md`, `docs/adr/`, `tests/`, `.github/` | Manifiesto, documentación, tests y publicación del paquete. |

## Plantilla de git

- **Rama base detectada.** Donde ponía `staging`, ahora se usa la rama base: `GIT_WORKFLOW_BASE`, si no `staging` si existe en `origin`, y si no la rama por defecto del remoto. En el repositorio de origen sigue siendo `staging`. Afecta a `pull-changes`, `create-branch`, `create-pr-base` y al orquestador ([ADR 0002](docs/adr/0002-rama-base-detectada.md)).
- **`create-branch.sh`.** Los argumentos pasan de `BASE NUMERO TIPO DESCRIPCION` a `NUMERO TIPO DESCRIPCION [BASE]`. La rama nueva no sigue a la rama base remota (`--no-track`).
- **Se mantiene la comprobación del tipo.** `staging` la quitó de los scripts de rama. Aquí se mantiene con los siete tipos, `knowledge` incluido, porque la etiqueta se crea con el nombre del tipo: un tipo mal escrito dejaría una etiqueta suelta en el repositorio. `create-issue` también rechaza un tipo que no sea uno de los siete.
- **Etiquetas por tipo.** Nuevo. `create-issue` y `create-pr-base` ponen a la issue y a la pull request una etiqueta con el nombre exacto del tipo, y la crean con `ensure-label.sh` si no existe. Si la cuenta no puede crear etiquetas, siguen sin ella y lo dicen.
- **`create-pr-base.sh`.** Es el `create-pr-base-staging.sh` de `staging` con la base detectada (o la que se le pase), la etiqueta del tipo y la comprobación de una PR abierta de esa rama, que devuelve su URL sin tocarla.
- **Caché de revisores en `.git/`.** `github-cache.mjs` guarda `.git-workflow-cache.json` en la carpeta de git (`git rev-parse --git-common-dir`) en vez de en la raíz del repositorio. En la raíz solo funciona donde `.gitignore` la ignora, como en el repositorio de origen; en `.git/` git nunca la ve. El resto del script no cambia.
- **Revisores desde la issue.** Como en `exercises/ChromaDB`, si la issue nombra revisores (una línea `Revisan:` al final de la parte de arriba), el orquestador los pide al acabar el ciclo. ChromaDB solo los pide si son dos personas; aquí basta con uno. Si la issue no nombra a nadie, la PR sigue en draft hasta «que la revisen», como en la plantilla de git.
- **`launch-push` es una skill.** En `staging` es un subagente que solo lanza su skill. Aquí el orquestador lanza la skill directamente: un push no hace ninguna pregunta, su salida es una línea y un subagente solo añadía una llamada más.
- **Nombre de revisor ambiguo.** En `staging`, `create-pr` pide aclaración. Aquí `create-pr` es un subagente y no puede preguntar: devuelve el nombre y los candidatos al orquestador, que pregunta y lo vuelve a llamar.
- **`check-status.sh`.** Escribe además la rama base, si el `.env` tiene `GITHUB_TOKEN` (sin mostrar su valor), de qué cuenta es el token y la versión de Node. El orquestador para antes de los pasos que los necesitan.
- **Sin MCP de GitHub.** Todo lo que el MCP hacía (crear la issue, asignar, pasar a draft, editar el cuerpo) lo hace `gh` a través de `gh.sh`, que lee el token del `.env` del proyecto ([ADR 0007](docs/adr/0007-el-token-sale-del-env.md)).
- **Forma del título.** Nuevo. `check-title.sh` comprueba el título de la issue y de la pull request antes de crearlas: menos de 72 caracteres, verbo en mayúscula delante, sin tipo delante, sin número de issue y sin punto final. Solo acepta ASCII imprimible, así que no pasan acentos, eñes ni saltos de línea; que esté en inglés lo piden las skills, porque el script no puede comprobarlo. Las issues se crean con `create-issue.sh`, que lo comprueba antes de llamar a `gh`. En una PR que ya existía, `create-pr-base.sh` devuelve su URL sin mirar el título, y rechaza un cuerpo que nombre la issue. Antes la forma solo estaba en un comentario de la plantilla.
- **`create-empty-commit.sh`.** Se niega a hacer el commit vacío en la rama base detectada, además de en `staging` y `main`, y también en `master`.
- **Entrevistas.** Hacen las preguntas en tandas con respuesta recomendada, como en `staging` desde #925, pero esperan las respuestas en la conversación en vez de devolverlas al orquestador ([ADR 0001](docs/adr/0001-orquestador-y-entrevista-como-skills.md)). Se llaman tandas para no confundirlas con las rondas del ciclo. Quitan la línea de instalación de las skills de Matt Pocock y la cambian por un enlace de inspiración.
- **Rutas.** Las skills llaman a sus scripts y plantillas desde la carpeta de la skill (`<carpeta de esta skill>/…`) en vez de `./tools/…` o `exercises/git-workflow-agent-template/tools/…`, y dicen cuál es esa carpeta en cada herramienta: `${CLAUDE_SKILL_DIR}` en Claude Code y `.agents/skills/<skill>` en Cursor y Codex.
- **Scripts con `bash` y `node`.** Las skills lanzan cada script como `bash "<carpeta>/script.sh"` o `node "<carpeta>/script.mjs"`, no por su ruta. La ruta cambia en cada proyecto, así que una regla de permisos por ruta no sirve; `Bash(bash:*)` y `Bash(node:*)` sí.
- **Frontmatter.** Cada skill y cada subagente lleva `name` y `description` en español. Los subagentes precargan sus skills con `skills:`. Codex descarta ese campo al instalar (APM lo avisa), pero sus subagentes heredan las skills igualmente.

## Ciclo de ChromaDB

- **Spec en la issue.** La spec, el plan y las tasks se escriben en la issue, en `## Spec`, `## Plan` y `## Tasks`, debajo de la plantilla del tipo, en vez de en `docs/specs/<cambio>/`. Es un requisito del equipo ([ADR 0005](docs/adr/0005-la-spec-vive-en-la-issue.md)). `issue-spec` lee el cuerpo antes de cada escritura, sustituye solo esas secciones y para si la parte de arriba cambió desde que empezó el ciclo, si el texto parece un secreto o si el cuerpo pasaría de 65 536 caracteres.
- **Plantillas de spec generalizadas.** Sin Python ni ChromaDB: «Traducción a pytest» pasa a «Traducción a tests», con el framework del proyecto; «Capas» y «Estilo» remiten a `docs/ARCHITECTURE.md` y `docs/STYLE.md` si existen; las reglas fijas de estilo de ChromaDB (sin clases, `RuntimeError`) desaparecen. La spec pierde «Contexto y objetivo» y «Fuera de alcance», que ya están arriba en la plantilla del tipo, y gana la línea `Estado · Creada · Aprobada` de las specs de `asistenciapp` y una sección «Huecos».
- **Rondas comentadas.** Cada ronda deja un comentario en la issue con la task, los ficheros y los dos veredictos. El `report.md` de una novena ronda fallida pasa a ser un comentario de informe, y el estado de la spec pasa a Fallida.
- **Otra pasada sin contraseña.** En ChromaDB, otra pasada solo arranca si el mensaje trae una contraseña. Aquí el orquestador es una skill en la conversación: basta con que la persona la confirme en el chat. No hay que manejar ningún secreto.
- **`code-developer` siempre nuevo.** ChromaDB reanuda el mismo `code_developer` en las rondas 2 y 3, 5 y 6, y 8 y 9. Aquí cada ronda abre uno nuevo, porque no está claro que Cursor y Codex puedan reanudar un subagente. Lo que necesita de rondas anteriores está en la issue.
- **Tests.** `code-tester` cubre tests unitarios, de lógica de negocio (los escenarios de la spec), de UI y de punta a punta, los que diga el plan, con los frameworks del proyecto. Si el plan propone uno que el proyecto no tiene, lo añade. En ChromaDB es pytest.
- **Documentos del proyecto.** Los agentes leen los que existan (`README.md`, `AGENTS.md`, `docs/CONSTITUTION.md`, `docs/ARCHITECTURE.md`, `docs/STYLE.md`, `docs/COMMANDS.md`) y no crean los que faltan. Los comandos salen de `docs/COMMANDS.md` o del manifiesto del proyecto. Se quitan `skills/python-docs`, Black, Ruff y el puerto 8000.
- **Secretos.** La «llave» de ChromaDB pasa a una regla general: si un subagente encuentra una credencial en un fichero que toca o necesita una para seguir, el ciclo para sin commit ni revisión y nombra el fichero, no el valor.
- **Al terminar.** «Para lo que hayas arrancado» deja de ser el servidor de Chroma: cualquier servidor, navegador o proceso que el ciclo arrancó se para antes del informe.
- **Cambios pedidos en un comentario.** Si la pull request tiene `CHANGES_REQUESTED`, spec, plan y tasks van en un comentario `<!-- Revisión N -->` con las plantillas de siempre.
- **Huecos.** Como en ChromaDB, `concept-developer` marca como hueco lo que el proyecto no responde y para. Aquí el orquestador pregunta a la persona y lo vuelve a llamar con las respuestas antes de la ronda 1.
- **Sin aprobación humana.** Como en ChromaDB, el ciclo no espera a que nadie apruebe la spec ([ADR 0004](docs/adr/0004-el-ciclo-corre-sin-aprobacion-humana.md)).
- **Commit final.** Como en ChromaDB, un solo commit con los ficheros del ciclo al terminar, con el desglose y el pie de `commit-changes` (`Refs #N`).

## Sin cambios

- Los textos en español de los subagentes y las skills de git, salvo lo descrito arriba.
- `commit-changes.sh`, `launch-push.sh` y `pull-changes.sh`, salvo la ruta y la rama base.
- Las plantillas de issue y de pull request por tipo, copiadas tal cual.
- `github-cache.mjs`, salvo la carpeta del fichero.
