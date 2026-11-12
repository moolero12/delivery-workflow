#!/usr/bin/env bash
# Lanza gh con el token de GITHUB_TOKEN del .env de la raíz del proyecto, nunca con la sesión de gh.
# Lanzado: bash gh.sh ARGUMENTOS... ejecuta gh con esos argumentos.
# Cargado con source: deja GH_TOKEN exportado para los gh que vengan después.
# El .env se lee línea a línea y no se ejecuta.
# En un worktree, si su raíz no tiene .env, se usa el de la copia principal del repositorio.

load_github_token() {
  local root common line value
  root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "No es un repositorio git." >&2
    return 1
  }
  if [[ ! -f "${root}/.env" ]]; then
    common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
    if [[ "$(basename "$common")" == .git && -f "$(dirname "$common")/.env" ]]; then
      root=$(dirname "$common")
    fi
  fi
  if [[ ! -f "${root}/.env" ]]; then
    echo "Falta el fichero .env en la raíz del proyecto con GITHUB_TOKEN=tu_token." >&2
    return 1
  fi
  if ! git -C "$root" check-ignore -q .env; then
    echo "El .env no está en .gitignore. Añádelo antes de seguir: el token no puede subirse." >&2
    return 1
  fi
  line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?GITHUB_TOKEN[[:space:]]*=' "${root}/.env" | tail -n 1) || true
  value=${line#*=}
  value=${value%$'\r'}
  value=$(sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' <<<"$value")
  # Entre comillas, el valor es lo de dentro. Sin comillas, un « # » empieza un comentario.
  if [[ "$value" =~ ^\"([^\"]*)\"([[:space:]]+#.*)?$ || "$value" =~ ^\'([^\']*)\'([[:space:]]+#.*)?$ ]]; then
    value=${BASH_REMATCH[1]}
  else
    value=$(sed -E 's/[[:space:]]+#.*$//' <<<"$value")
  fi
  if [[ -z "$value" || "$value" =~ [[:space:]] ]]; then
    echo "El .env no tiene un GITHUB_TOKEN válido." >&2
    return 1
  fi
  # gh solo usa GH_ENTERPRISE_TOKEN cuando GH_HOST no es github.com.
  export GH_TOKEN=$value
  export GITHUB_TOKEN=$value
  export GH_ENTERPRISE_TOKEN=$value
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  load_github_token || exit 1
  exec gh "$@"
fi
