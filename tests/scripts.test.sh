#!/usr/bin/env bash
# Prueba los scripts del paquete contra un remoto falso y un gh falso.
# Uso: bash tests/scripts.test.sh

set -uo pipefail

package=$(cd "$(dirname "$0")/.." && pwd)
skills="${package}/.apm/skills"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok    ${name}"
  else
    echo "FALLA ${name}"
    failures=$((failures + 1))
  fi
}

# gh falso: anota cada llamada y responde lo justo.
mkdir -p "${work}/bin"
cat >"${work}/bin/gh" <<'GH'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_GH_LOG"
echo "${GH_TOKEN:-}" >"$FAKE_GH_TOKEN"
case "$1 $2" in
  "label list") [[ -n "${FAKE_GH_LABELS:-}" ]] && echo "$FAKE_GH_LABELS"; exit 0 ;;
  "label create") [[ "${FAKE_GH_LABEL_DENIED:-}" == 1 ]] && exit 1; exit 0 ;;
  "pr list") [[ -n "${FAKE_GH_PR_URL:-}" ]] && echo "$FAKE_GH_PR_URL"; exit 0 ;;
  "pr view") echo '{"number":9,"reviewDecision":"CHANGES_REQUESTED","body":"Closes #1"}'; exit 0 ;;
  "issue create") echo "https://github.com/owner/repo/issues/7"; exit 0 ;;
  "issue view") echo '{"body":"hola"}'; exit 0 ;;
  "pr create") echo "https://github.com/owner/repo/pull/9"; exit 0 ;;
  "api user") [[ "$*" == *--include* ]] && printf 'HTTP/2.0 200 OK\netag: "u"\n\n{"login":"ada"}\n' || echo ada; exit 0 ;;
  "api repos/owner/repo/collaborators?per_page=100&page=1") printf 'HTTP/2.0 200 OK\netag: "c"\n\n[{"login":"ada"}]\n'; exit 0 ;;
esac
exit 0
GH
chmod +x "${work}/bin/gh"
export PATH="${work}/bin:${PATH}"
export FAKE_GH_LOG="${work}/gh.log"
export FAKE_GH_TOKEN="${work}/gh.token"
unset GIT_WORKFLOW_BASE

git init -q --bare -b main "${work}/origin.git"
git clone -q "${work}/origin.git" "${work}/repo" 2>/dev/null
cd "${work}/repo"
git config user.email test@example.com
git config user.name Test
echo .env >.gitignore
git add .gitignore
git commit -q -m init
echo "GITHUB_TOKEN=token-del-env" >.env
git push -q origin HEAD:main HEAD:staging
git fetch -q origin

# gh.sh: gh con el token del .env, nunca con el del entorno ni la sesión de gh.
ghsh="${skills}/create-issue/scripts/gh.sh"
check "gh.sh lanza gh" env GH_TOKEN=token-de-la-sesion GITHUB_TOKEN=token-de-la-sesion bash "$ghsh" repo view
check "gh.sh pasa el token del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
printf '# comentario\nexport GITHUB_TOKEN = "token con comillas"\r\n' >.env
check "gh.sh rechaza un token con espacios" bash -c "! bash '$ghsh' repo view 2>/dev/null"
printf '# comentario\nexport GITHUB_TOKEN="token-entre-comillas"\r\n' >.env
bash "$ghsh" repo view >/dev/null 2>&1
check "gh.sh quita export, comillas y retorno de carro" test "$(cat "$FAKE_GH_TOKEN")" = token-entre-comillas
mv .env env.bak
: >"$FAKE_GH_LOG"
check "sin .env, gh.sh falla" bash -c "! bash '$ghsh' repo view 2>/dev/null"
check "sin .env, no se llama a gh" test ! -s "$FAKE_GH_LOG"
check "sin .env, ensure-label sale con 3" bash -c "bash '${skills}/create-issue/scripts/ensure-label.sh' feat 2>/dev/null; test \$? -eq 3"
mv env.bak .env
git rm -q --cached .gitignore && mv .gitignore gitignore.bak
check "con el .env fuera de .gitignore, gh.sh falla" bash -c "! bash '$ghsh' repo view 2>/dev/null"
mv gitignore.bak .gitignore && git add .gitignore
printf 'GITHUB_TOKEN=token-con-comentario  # mi token\n' >.env
bash "$ghsh" repo view >/dev/null 2>&1
check "gh.sh quita un comentario detrás del token" test "$(cat "$FAKE_GH_TOKEN")" = token-con-comentario
printf 'GITHUB_TOKEN="token-entre-comillas" # mi token\n' >.env
bash "$ghsh" repo view >/dev/null 2>&1
check "gh.sh quita un comentario detrás de las comillas" test "$(cat "$FAKE_GH_TOKEN")" = token-entre-comillas
echo "GITHUB_TOKEN=token-del-env" >.env
check "gh.sh deja el token para GitHub Enterprise" test "$(bash -c "source '$ghsh'; load_github_token; echo \$GH_ENTERPRISE_TOKEN")" = token-del-env
git worktree add -q "${work}/worktree" -b worktree-test 2>/dev/null
check "en un worktree, gh.sh usa el .env de la copia principal" bash -c "cd '${work}/worktree' && bash '$ghsh' repo view"
check "en un worktree, el token es el del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
git worktree remove --force "${work}/worktree"
git branch -q -D worktree-test
for copy in "${skills}"/*/scripts/gh.sh; do
  check "gh.sh es igual en $(basename "$(dirname "$(dirname "$copy")")")" cmp -s "$ghsh" "$copy"
done

# create-branch: siete tipos, knowledge incluido; los demás se rechazan.
check "create-branch acepta knowledge" "${skills}/create-branch/scripts/create-branch.sh" 5 knowledge add-notes
check "la rama sale de staging sin seguirla" test -z "$(git config branch.5-knowledge-add-notes.merge)"
check "create-branch rechaza un tipo mal escrito" bash -c "! '${skills}/create-branch/scripts/create-branch.sh' 6 feta x 2>/dev/null"

# create-empty-commit: abre la rama y se niega en la rama base.
check "create-empty-commit en la rama de trabajo" "${skills}/create-empty-commit/scripts/create-empty-commit.sh" 5
check "el commit vacío es chore: open #5" test "$(git log -1 --format=%s)" = "chore: open #5"
git switch -q -c staging origin/staging 2>/dev/null
check "create-empty-commit se niega en staging" bash -c "! '${skills}/create-empty-commit/scripts/create-empty-commit.sh' 5 2>/dev/null"
git switch -q 5-knowledge-add-notes

# ensure-label: existe, se crea, o no hay permiso (2), o el tipo no vale (1).
label="${skills}/create-issue/scripts/ensure-label.sh"
FAKE_GH_LABELS=feat check "ensure-label con la etiqueta ya creada" "$label" feat
check "ensure-label crea la que falta" "$label" knowledge
check "ensure-label creó knowledge" grep -q "label create knowledge" "$FAKE_GH_LOG"
FAKE_GH_LABELS=Knowledge FAKE_GH_LABEL_DENIED=1 check "ensure-label acepta la etiqueta con otras mayúsculas" "$label" knowledge
FAKE_GH_LABEL_DENIED=1 "$label" fix >/dev/null 2>&1
check "ensure-label sin permiso sale con 2" test $? -eq 2
"$label" feta >/dev/null 2>&1
check "ensure-label rechaza un tipo mal escrito" test $? -eq 1
check "ensure-label es igual en create-issue y create-pr-base" cmp -s "$label" "${skills}/create-pr-base/scripts/ensure-label.sh"

# check-title: inglés con verbo delante, sin tipo, sin número y con menos de 72 caracteres.
title="${skills}/create-issue/scripts/check-title.sh"
check "check-title acepta un título bien formado" bash "$title" "Add a delivery-workflow test note"
check "check-title rechaza el tipo delante" bash -c "! bash '$title' 'docs: add a test note' 2>/dev/null"
check "check-title rechaza el tipo con ámbito delante" bash -c "! bash '$title' 'feat(login): add the form' 2>/dev/null"
check "check-title rechaza el número de la issue" bash -c "! bash '$title' 'Add the note for #50' 2>/dev/null"
check "check-title rechaza la minúscula inicial" bash -c "! bash '$title' 'add a test note' 2>/dev/null"
check "check-title rechaza el punto final" bash -c "! bash '$title' 'Add a test note.' 2>/dev/null"
check "check-title rechaza 72 caracteres o más" bash -c "! bash '$title' 'Add $(printf 'x%.0s' {1..68})' 2>/dev/null"
check "check-title rechaza acentos y eñes" bash -c "! bash '$title' 'Añadir nota de prueba' 2>/dev/null"
check "check-title rechaza un salto de línea" bash -c "! bash '$title' \$'Add a note\\nSecond line' 2>/dev/null"
check "check-title rechaza el tipo con barra delante" bash -c "bash '$title' 'docs/ui: add a note' 2>&1 | grep -q 'no lleva el tipo'"
check "check-title rechaza el tipo con espacio antes de los dos puntos" bash -c "bash '$title' 'docs : add a note' 2>&1 | grep -q 'no lleva el tipo'"
check "check-title rechaza el tipo en mayúsculas" bash -c "bash '$title' 'Docs(ui)!: add a note' 2>&1 | grep -q 'no lleva el tipo'"
check "check-title acepta dos puntos que no son un tipo" bash "$title" "Note: update the readme"
check "check-title acepta una palabra que empieza como un tipo" bash "$title" "Fixtures: add the login cases"
check "check-title cuenta igual en cualquier locale" bash -c "LC_ALL=en_US.UTF-8 bash '$title' 'Add $(printf 'x%.0s' {1..67})' && ! LC_ALL=en_US.UTF-8 bash '$title' 'Add $(printf 'x%.0s' {1..68})' 2>/dev/null"
check "check-title es igual en create-issue y create-pr-base" cmp -s "$title" "${skills}/create-pr-base/scripts/check-title.sh"

# create-pr-base: base detectada, draft, asignada y con etiqueta.
echo "cuerpo" >"${work}/body.md"
: >"$FAKE_GH_LOG"
check "create-pr-base abre la PR" "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" knowledge
check "la PR va contra staging, en draft, asignada y con etiqueta" grep -q -- "pr create --base staging --head 5-knowledge-add-notes --title Add notes --body-file ${work}/body.md --draft --assignee @me --label knowledge" "$FAKE_GH_LOG"
: >"$FAKE_GH_LOG"
FAKE_GH_LABEL_DENIED=1 "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" fix >/dev/null 2>&1
check "sin permiso de etiquetas, la PR sale sin etiqueta" bash -c "grep -q 'pr create' '$FAKE_GH_LOG' && ! grep -q -- '--label' <(grep 'pr create' '$FAKE_GH_LOG')"
: >"$FAKE_GH_LOG"
check "create-pr-base no abre la PR con el tipo en el título" bash -c "
  out=\$('${skills}/create-pr-base/scripts/create-pr-base.sh' 5-knowledge-add-notes 'docs: add notes' '${work}/body.md' knowledge 2>&1)
  [[ \$? -ne 0 && \$out == *'no lleva el tipo'* ]] && ! grep -q 'pr create' '$FAKE_GH_LOG'"
: >"$FAKE_GH_LOG"
existing=$(FAKE_GH_PR_URL=https://github.com/owner/repo/pull/3 "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "docs: añadir notas" "${work}/body.md" knowledge 2>&1)
check "con la PR ya abierta, create-pr-base devuelve su URL sin mirar el título" grep -q "ya existía: https://github.com/owner/repo/pull/3" <<<"$existing"
printf 'Closes #\n\nComo pide la issue #12.\n' >"${work}/body-con-numero.md"
check "con la PR ya abierta, create-pr-base tampoco mira el cuerpo" bash -c "FAKE_GH_PR_URL=https://github.com/owner/repo/pull/3 '${skills}/create-pr-base/scripts/create-pr-base.sh' 5-knowledge-add-notes 'Add notes' '${work}/body-con-numero.md' knowledge | grep -q 'ya existía'"
check "con la PR ya abierta, no se crea otra" bash -c "! grep -q 'pr create' '$FAKE_GH_LOG'"

: >"$FAKE_GH_LOG"
check "create-pr-base rechaza un cuerpo que nombra la issue" bash -c "
  out=\$('${skills}/create-pr-base/scripts/create-pr-base.sh' 5-knowledge-add-notes 'Add notes' '${work}/body-con-numero.md' knowledge 2>&1)
  [[ \$? -ne 0 && \$out == *'no nombra la issue'* ]] && ! grep -q 'pr create' '$FAKE_GH_LOG'"
GIT_WORKFLOW_BASE=main "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" feat >/dev/null 2>&1
check "GIT_WORKFLOW_BASE cambia la base" grep -q -- "pr create --base main" "$FAKE_GH_LOG"

# create-issue: comprueba el título antes de llamar a gh, con etiqueta y asignada.
: >"$FAKE_GH_LOG"
check "create-issue crea la issue" "${skills}/create-issue/scripts/create-issue.sh" "Add notes" "${work}/body.md" knowledge
check "la issue va asignada y con etiqueta" grep -q -- "issue create --title Add notes --body-file ${work}/body.md --assignee @me --label knowledge" "$FAKE_GH_LOG"
: >"$FAKE_GH_LOG"
check "create-issue no crea la issue con el tipo en el título" bash -c "
  out=\$('${skills}/create-issue/scripts/create-issue.sh' 'docs: add notes' '${work}/body.md' knowledge 2>&1)
  [[ \$? -ne 0 && \$out == *'no lleva el tipo'* ]] && test ! -s '$FAKE_GH_LOG'"
: >"$FAKE_GH_LOG"
FAKE_GH_LABEL_DENIED=1 "${skills}/create-issue/scripts/create-issue.sh" "Add notes" "${work}/body.md" fix >/dev/null 2>&1
check "sin permiso de etiquetas, la issue sale sin etiqueta" bash -c "grep -q 'issue create' '$FAKE_GH_LOG' && ! grep -q -- '--label' <(grep 'issue create' '$FAKE_GH_LOG')"

# github-cache: el fichero vive en .git/ y no aparece como cambio.
node "${skills}/github-cache/scripts/github-cache.mjs" directory owner/repo >/dev/null
check "la caché se guarda en .git/" test -f .git/.git-workflow-cache.json
check "la caché no se guarda en la raíz" test ! -e .git-workflow-cache.json
check "la caché usa el token del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
check "git no ve la caché" test -z "$(git status --porcelain)"

# issue-spec: lee la issue con el token del .env.
check "issue-spec lee la issue" test "$(node "${skills}/issue-spec/scripts/issue-spec.mjs" read 1)" = hola
check "issue-spec usa el token del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
check "ISSUE_SPEC_GH no salta gh.sh" test "$(ISSUE_SPEC_GH=/usr/bin/false node "${skills}/issue-spec/scripts/issue-spec.mjs" read 1)" = hola

# check-status: informa del token del .env, de su cuenta y de Node.
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status lee el token del .env" grep -q "^Token de GitHub: GITHUB_TOKEN en .env" <<<"$status"
check "check-status dice la cuenta del token" grep -q "^GitHub CLI: cuenta ada" <<<"$status"
check "check-status informa de Node" grep -q "^Node:" <<<"$status"
check "check-status informa de la pull request" grep -q "^Pull request: #9 CHANGES_REQUESTED issue #1" <<<"$status"

# check-status: la línea de modelos nunca para el script y pasa por sus tres estados.
check "check-status avisa de que no hay agentes de Cursor" grep -q "^Modelos: sin configurar" <<<"$status"
mkdir -p .cursor/agents
for agent in "${package}"/.apm/agents/*.agent.md; do
  cp "$agent" ".cursor/agents/$(basename "${agent%.agent.md}").md"
done
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status dice sin configurar con agentes y sin elecciones" grep -q "^Modelos: sin configurar" <<<"$status"
# cursor-agent falso con la lista del fixture: la prueba no depende de lo instalado ni de ninguna cuenta.
cat >"${work}/bin/cursor-agent" <<CA
#!/usr/bin/env bash
cat "${package}/tests/fixtures/configure-models/cursor-agent-models.txt"
CA
chmod +x "${work}/bin/cursor-agent"
check "apply funciona con un cursor-agent falso" node "${skills}/configure-models/scripts/configure-models.mjs" apply --set create-branch=composer-2.5
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status dice configurado" grep -q "^Modelos: configurado (cursor 8/8)" <<<"$status"
cp "${package}/.apm/agents/create-pr.agent.md" .cursor/agents/create-pr.md
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status dice desincronizado" grep -q "^Modelos: desincronizado (cursor 7/8)" <<<"$status"
check "check-status sigue entero tras la línea de modelos" grep -q "^Último commit:" <<<"$status"
mkdir -p "${work}/solo/check-status/scripts"
cp "${skills}/check-status/scripts/"*.sh "${work}/solo/check-status/scripts/"
status=$("${work}/solo/check-status/scripts/check-status.sh")
check "check-status sin la skill configure-models sigue y lo dice" grep -q "^Modelos: no se pudo comprobar" <<<"$status"
check "check-status sin la skill configure-models llega al final" grep -q "^Sin seguimiento:" <<<"$status"
rm -rf .cursor

# Las skills lanzan sus scripts con bash o node: así una regla de permisos vale para todos.
commands=$(grep -rhoE '`[^`]*<carpeta de esta skill>/scripts/[^`]*`' "${skills}")
check "las skills nombran sus scripts" test -n "$commands"
check "las skills lanzan sus scripts con bash o node" bash -c '! grep -vE "^\`(bash|node) " <<<"$1"' _ "$commands"

# release-version: la versión de apm.yml, sin etiqueta y mayor que la última.
release="${package}/.github/scripts/release-version.sh"
git init -q "${work}/release"
cd "${work}/release"
git config user.email test@example.com
git config user.name Test
echo 'version: "0.1.0"' >apm.yml
git add apm.yml
git commit -q -m init
check "release-version sin etiquetas escribe la versión" test "$(bash "$release")" = 0.1.0
git tag v0.1.0
check "release-version falla si la etiqueta ya existe" bash -c "! bash '$release' 2>/dev/null"
echo 'version: "0.1.1"' >apm.yml
check "release-version acepta la versión siguiente" test "$(bash "$release")" = 0.1.1
git tag v0.10.0
check "release-version falla con una versión menor que la última" bash -c "! bash '$release' 2>/dev/null"
echo 'version: 0.11.0' >apm.yml
check "release-version compara por números y acepta sin comillas" test "$(bash "$release")" = 0.11.0
echo "version: '0.11.1'" >apm.yml
check "release-version acepta comillas simples" test "$(bash "$release")" = 0.11.1
echo "version: '0.11.1\"" >apm.yml
check "release-version falla con comillas que no cierran" bash -c "! bash '$release' 2>/dev/null"
printf 'version: "0.11.2"\nversion: "0.11.3"\n' >apm.yml
check "release-version usa solo la primera línea version" test "$(bash "$release")" = 0.11.2
git tag v0.12.0-rc1
echo 'version: "0.11.2"' >apm.yml
check "release-version no cuenta una etiqueta con sufijo" test "$(bash "$release")" = 0.11.2
echo 'version: "1.0"' >apm.yml
check "release-version falla sin X.Y.Z" bash -c "! bash '$release' 2>/dev/null"
check "el workflow usa release-version" grep -q "bash .github/scripts/release-version.sh" "${package}/.github/workflows/release.yml"

# say-it-straight: skill de prosa sin scripts.
check "say-it-straight existe" test -f "${skills}/say-it-straight/SKILL.md"
check "say-it-straight declara su name" grep -q "^name: say-it-straight" "${skills}/say-it-straight/SKILL.md"
check "say-it-straight deja los commits en inglés fuera de alcance" grep -q "commit-changes" "${skills}/say-it-straight/SKILL.md"
for agent in concept-developer concept-tester create-issue create-pr; do
  check "${agent} precarga say-it-straight" grep -q -- "- say-it-straight" "${package}/.apm/agents/${agent}.agent.md"
done

echo
if [[ $failures -eq 0 ]]; then
  echo "Todo bien."
else
  echo "${failures} comprobaciones fallidas."
  exit 1
fi
