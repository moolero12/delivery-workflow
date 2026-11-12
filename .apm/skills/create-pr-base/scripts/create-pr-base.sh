#!/usr/bin/env bash
# Crea una PR contra la rama base, en draft, asignada al usuario autenticado y con la etiqueta del tipo.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

# Rama base: GIT_WORKFLOW_BASE, staging si existe en origin, o la rama por defecto de origin.
detect_base() {
  local head candidate
  if [[ -n "${GIT_WORKFLOW_BASE:-}" ]]; then
    if [[ ! "$GIT_WORKFLOW_BASE" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      echo "GIT_WORKFLOW_BASE tiene que ser el nombre de una rama." >&2
      return 1
    fi
    echo "${GIT_WORKFLOW_BASE#origin/}"
    return
  fi
  if git show-ref --verify --quiet refs/remotes/origin/staging; then
    echo "staging"
    return
  fi
  if head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
    echo "${head#origin/}"
    return
  fi
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/${candidate}"; then
      echo "$candidate"
      return
    fi
  done
  echo "No se pudo detectar la rama base. Defínela con GIT_WORKFLOW_BASE." >&2
  return 1
}

if [[ $# -lt 4 || $# -gt 5 || -z "$1" || -z "$2" || -z "$3" || -z "$4" ]]; then
  echo "Uso: create-pr-base.sh RAMA TITULO CUERPO TIPO [BASE]" >&2
  exit 1
fi

branch=$1
title=$2
body=$3
type=$4

if [[ ! -f "$body" || ! -r "$body" ]]; then
  echo "El fichero del cuerpo debe existir y ser legible." >&2
  exit 1
fi

if [[ $# -eq 5 ]]; then
  base=$5
  if [[ ! "$base" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo "La base tiene que ser el nombre de una rama." >&2
    exit 1
  fi
  base=${base#origin/}
else
  base=$(detect_base)
fi

source "${here}/gh.sh"
load_github_token

existing=$(gh pr list --head "$branch" --base "$base" --state open --json url --jq '.[0].url // empty')
if [[ -n "$existing" ]]; then
  echo "La pull request de ${branch} hacia ${base} ya existía: ${existing}"
  echo "No se ha tocado su cuerpo."
  exit 0
fi

# El título y el cuerpo se comprueban después de buscar la PR: una PR abierta antes de estas reglas se sigue encontrando.
bash "${here}/check-title.sh" "$title" >/dev/null || exit 1

if grep -Eq '#[0-9]' "$body"; then
  echo "El cuerpo no nombra la issue: deja «Closes #» sin número, lo completa link-pr-to-issue." >&2
  exit 1
fi

label_args=()
if bash "${here}/ensure-label.sh" "$type"; then
  label_args=(--label "$type")
else
  status=$?
  [[ $status -eq 2 ]] || exit "$status"
fi

gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$body" --draft --assignee "@me" "${label_args[@]+"${label_args[@]}"}"
echo "Base: ${base}"
