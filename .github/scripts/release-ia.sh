#!/usr/bin/env bash
# Decide si los cambios desde la última etiqueta vX.Y.Z son major, minor o patch.
# Primero pregunta a la IA de Groq. Si no hay clave, falla o responde algo no válido,
# deciden las reglas de los commits (Conventional Commits):
#   "!" o "BREAKING CHANGE" -> major, algún "feat" -> minor, el resto -> patch.
# Deja estos archivos en la carpeta actual:
#   ia-ultima.txt   la última versión publicada (X.Y.Z), vacío si no hay ninguna
#   ia-quien.txt    quién ha decidido: "la IA" o "las reglas de los commits"
#   ia-tipo.txt     major, minor o patch
#   ia-motivo.txt   una frase con el motivo
#   ia-resumen.md   viñetas en Markdown con los cambios
#   ia-version.txt  la siguiente versión (X.Y.Z)
# La usa el workflow de release. Necesita GROQ_API_KEY (si no está, usa solo las reglas).

set -uo pipefail

modelo="${MODELO_IA:-openai/gpt-oss-120b}"

# Última versión publicada: solo etiquetas vX.Y.Z exactas, como en release-version.sh.
ultima=$(git tag -l 'v*' | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
printf '%s\n' "$ultima" > ia-ultima.txt

if [[ -n "$ultima" ]]; then
  rango="v${ultima}..HEAD"
  desde="v${ultima}"
else
  rango="HEAD"
  desde=$(git hash-object -t tree /dev/null)
fi

# Commits desde la última versión, sin los commits de versión del bot.
git log "$rango" --format='%s' | { grep -v '^chore: release ' || true; } > ia-asuntos.txt

# ---------- 1. La IA de Groq ----------
tipo=""
: > ia-decision.json
if [[ -n "${GROQ_API_KEY:-}" ]]; then
  # Lo que ve la IA: los commits y los archivos cambiados desde la última versión.
  {
    echo "## Commits"
    git log "$rango" --format='- %s%n%b' | grep -v '^[[:space:]]*$'
    echo
    echo "## Archivos cambiados"
    git diff --stat "$desde" HEAD | tail -n 60
  } | head -n 300 > ia-cambios.txt

  instrucciones='Eres quien decide las versiones de delivery-workflow, un paquete APM con agentes y skills de IA (para Claude Code, Cursor y Codex) que otros proyectos instalan por versión. Sigue el versionado semántico.
Decide el tipo de cambio a partir de los commits y los archivos:
- "major": rompe algo a los proyectos que ya lo usan: se quita o se renombra una skill o un agente, cambian los argumentos de un script, o un commit lleva "!" o "BREAKING CHANGE".
- "minor": añade algo nuevo sin romper nada: skills, agentes u opciones nuevas (normalmente commits "feat").
- "patch": correcciones, documentación, tests o mantenimiento (fix, docs, chore, refactor, test, knowledge).
Escribe también un resumen en español de 2 a 5 viñetas en Markdown para quien usa el paquete.
Responde solo con este JSON, sin texto alrededor:
{"tipo": "major|minor|patch", "motivo": "una frase", "resumen": "viñetas en Markdown"}'

  jq -n --arg modelo "$modelo" --arg instrucciones "$instrucciones" --rawfile cambios ia-cambios.txt \
    '{model: $modelo, temperature: 0, messages: [{role: "system", content: $instrucciones}, {role: "user", content: $cambios}]}' \
    > ia-peticion.json

  if curl -sS --fail-with-body --max-time 60 "https://api.groq.com/openai/v1/chat/completions" \
      -H "Authorization: Bearer ${GROQ_API_KEY}" \
      -H "Content-Type: application/json" \
      -d @ia-peticion.json -o ia-respuesta.json; then
    jq -r '.choices[0].message.content // empty' ia-respuesta.json | sed '/^```/d' > ia-decision.json
  else
    echo "La IA no ha respondido:" >&2
    cat ia-respuesta.json >&2 2>/dev/null || true
  fi

  tipo=$(jq -r '.tipo // empty' ia-decision.json 2>/dev/null)
else
  echo "No hay GROQ_API_KEY: se usan las reglas de los commits." >&2
fi

case "$tipo" in
  major|minor|patch)
    quien="la IA"
    jq -r '.motivo // ""' ia-decision.json > ia-motivo.txt 2>/dev/null || : > ia-motivo.txt
    jq -r '.resumen // ""' ia-decision.json > ia-resumen.md 2>/dev/null || : > ia-resumen.md
    ;;
  *)
    # ---------- 2. Las reglas de los commits ----------
    [[ -n "${GROQ_API_KEY:-}" ]] && echo "Respuesta de la IA no válida: se usan las reglas de los commits." >&2
    quien="las reglas de los commits"
    if grep -qE '^[a-z]+(\([^)]*\))?!:' ia-asuntos.txt || git log "$rango" --format='%b' | grep -q 'BREAKING CHANGE'; then
      tipo="major"; motivo="Hay commits con \"!\" o \"BREAKING CHANGE\": cambios que rompen la compatibilidad."
    elif grep -qE '^feat(\([^)]*\))?:' ia-asuntos.txt; then
      tipo="minor"; motivo="Hay commits \"feat\": funcionalidades nuevas."
    else
      tipo="patch"; motivo="Solo hay correcciones, documentación o mantenimiento."
    fi
    printf '%s\n' "$motivo" > ia-motivo.txt

    # Resumen: los commits agrupados por tipo.
    {
      novedades=$(grep -E '^feat(\([^)]*\))?!?:' ia-asuntos.txt | sed -E 's/^[a-z]+(\([^)]*\))?!?: */- /')
      correcciones=$(grep -E '^fix(\([^)]*\))?!?:' ia-asuntos.txt | sed -E 's/^[a-z]+(\([^)]*\))?!?: */- /')
      otros=$(grep -vE '^(feat|fix)(\([^)]*\))?!?:' ia-asuntos.txt | grep -vE '^chore: open #' | sed -E 's/^[a-z]+(\([^)]*\))?!?: */- /; t; s/^/- /')
      [[ -n "$novedades" ]] && printf '### Novedades\n%s\n\n' "$novedades"
      [[ -n "$correcciones" ]] && printf '### Correcciones\n%s\n\n' "$correcciones"
      [[ -n "$otros" ]] && printf '### Otros cambios\n%s\n\n' "$otros"
    } > ia-resumen.md
    ;;
esac
printf '%s\n' "$quien" > ia-quien.txt
printf '%s\n' "$tipo" > ia-tipo.txt

# La siguiente versión sale de la última etiqueta y del tipo de cambio.
IFS=. read -r mayor menor parche <<< "${ultima:-0.0.0}"
case "$tipo" in
  major) mayor=$((mayor + 1)); menor=0; parche=0 ;;
  minor) menor=$((menor + 1)); parche=0 ;;
  patch) parche=$((parche + 1)) ;;
esac
siguiente="${mayor}.${menor}.${parche}"
printf '%s\n' "$siguiente" > ia-version.txt

echo "Última versión: ${ultima:-ninguna} | decide: ${quien} | tipo: ${tipo} | siguiente: ${siguiente}"
echo "Motivo: $(cat ia-motivo.txt)"
