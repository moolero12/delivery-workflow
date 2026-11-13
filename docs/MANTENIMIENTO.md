# Mantenimiento

Para quien cambia o publica el paquete.

## Tests del paquete

Desde la raíz del repositorio:

```bash
node --test tests/*.mjs
node --test tests/discord-pr-notifications/*.test.mjs
bash tests/scripts.test.sh
apm audit --ci
```

El audit comprueba la integridad de los archivos del paquete.

El aviso de PR de este repositorio y su acción compuesta se describen en [DISCORD-PR-NOTIFICATIONS.md](DISCORD-PR-NOTIFICATIONS.md). APM no instala workflows de GitHub en los proyectos.

## Probar el paquete

Una prueba de unos veinte minutos en un repositorio desechable, para comprobar el paquete en tu herramienta antes de usarlo en un proyecto de verdad. Está pensada sobre todo para Cursor y Codex, que no se han probado de punta a punta.

1. Crea un repositorio de prueba con algo que probar y entra en él:

   ```bash
   gh repo create delivery-test --private --add-readme --clone
   cd delivery-test
   npm init -y && npm pkg set scripts.test="node --test"
   git add package.json && git commit -m "chore: add package.json" && git push
   ```

2. Instala el paquete y crea el `.env` con tu token (ver [El token de GitHub](../README.md#el-token-de-github)):

   ```bash
   apm install venturars/delivery-workflow#staging --target cursor
   echo .env >> .gitignore && git add .gitignore && git commit -m "chore: ignore .env" && git push
   ```

   Después, añade `GITHUB_TOKEN=tu_token` al `.env` con tu editor.

   Para Codex, `--target codex`. Para probar una copia local del paquete, pasa su ruta en vez de `venturars/…#staging`.

3. Comprueba que están las piezas:
   - **Cursor:** `ls .agents/skills .cursor/agents` (20 skills y 8 subagentes).
   - **Codex:** `ls .agents/skills .codex/agents` (20 skills y 8 subagentes `.toml`).

4. Abre la herramienta, mejor desde el escritorio que desde la terminal: así se comprueba que no depende de las variables de la terminal. En Codex, acepta la confianza en el proyecto.

5. En el chat del agente, sigue estos pasos y comprueba el resultado de cada uno. Acepta los permisos que pida la herramienta. En Codex, llama a las skills con `$` en vez de `/`.

   | Escribe | Tiene que pasar |
   |---|---|
   | `/check-status` | `Rama base: main`, `Token de GitHub: GITHUB_TOKEN en .env`, `GitHub CLI: cuenta TU_LOGIN` y `Node: 20` o más. |
   | `/configure-models` | Una tabla con agente, modelo y motivo, y la pregunta de aceptación. Tras aceptar: 8 archivos con `model` (`grep -l "^model" .cursor/agents/* .claude/agents/* .codex/agents/*`, según la herramienta), y `/check-status` con `Modelos: configurado (cursor 8/8)`. Tras otro `apm install` indica `desincronizado`, y `/configure-models` con Enter lo restaura. Sin la CLI de la herramienta no propone ningún modelo y permite indicar uno a mano. En Codex, `codex debug models` no está verificado con un Codex real: conviene revisar la propuesta. |
   | `/delivery-workflow` «Crea la issue y hazla: una función `sum(a, b)` en `sum.js` que suma dos números, con su test» | Issue #1 con la etiqueta `feat`. Rama `1-feat-…`, commit `chore: open #1`, pull request en draft con `Closes #1` y la etiqueta. Después, en la issue, `## Spec`, `## Plan` y `## Tasks` y un comentario por ronda. Al final, un commit con `sum.js` y su test, subido. |
   | Edita la parte de arriba de la issue en GitHub mientras corren las rondas | La escritura siguiente en la issue para y el agente te pregunta. |
   | «Que la revise TU_NOMBRE» | Te contesta que el autor no puede revisar su propia pull request y no pide nada. |
   | Con la PR en `CHANGES_REQUESTED`, «la PR pide cambios» | Un comentario `<!-- Revisión 1 -->` con spec, plan y tasks en la misma issue y se repite el ciclo. |

   Compruébalo también fuera del chat: `git log --oneline`, `gh issue view 1 --comments` y `gh pr view --web`.

6. Anota lo que falle: la herramienta, el paso, lo que escribiste y el error. Ábrelo como issue en [este repositorio](https://github.com/venturars/delivery-workflow/issues) con el tipo `fix`.

7. Borra el repositorio de prueba: `gh auth refresh -s delete_repo` y después `gh repo delete delivery-test --yes`.

## Publicar una versión

Los cambios entran en `staging` por pull request desde su rama de trabajo. Para publicar:

1. En `staging`, sube `version` en `apm.yml` con un commit `chore: release X.Y.Z`, por pull request como cualquier otro cambio. Quien prepara la versión elige el número.
2. Abre la pull request de `staging` a `main`. La comprobación *Comprobar la versión* falla si `vX.Y.Z` ya existe o es menor que la última etiqueta.
3. Al hacer merge, el workflow `.github/workflows/release.yml` crea la etiqueta `vX.Y.Z` en ese commit de `main` y la release con las notas que genera GitHub. No hace falta etiquetar a mano.

Para ver qué versión saldría: `bash .github/scripts/release-version.sh`.

Los proyectos instalan desde la etiqueta, así que `staging` puede cambiar sin afectarles ([ADR 0006](adr/0006-el-paquete-vive-en-su-propio-repositorio.md), [ADR 0008](adr/0008-la-version-de-apm-yml-crea-la-etiqueta.md)).
