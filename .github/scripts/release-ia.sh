#!/usr/bin/env bash
# Pregunta a la IA de GitHub Models qué ha cambiado desde la última etiqueta vX.Y.Z.
# Deja estos archivos en la carpeta actual:
#   ia-ultima.txt   la última versión publicada (X.Y.Z), vacío si no hay ninguna
#   ia-tipo.txt     major, minor o patch
#   ia-motivo.txt   una frase con el motivo
#   ia-resumen.md   de 2 a 5 viñetas en Markdown
#   ia-version.txt  la siguiente versión (X.Y.Z)
# Si la IA falla o responde algo no válido, el tipo es patch y el resumen queda vacío.
# La usa el workflow de release. Necesita GITHUB_TOKEN con el permiso models: read.

set -uo pipefail

modelo="${MODELO_IA:-openai/gpt-4.1}"

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

: > ia-decision.json
if curl -sS --fail-with-body "https://models.github.ai/inference/chat/completions" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d @ia-peticion.json -o ia-respuesta.json; then
  jq -r '.choices[0].message.content' ia-respuesta.json | sed '/^```/d' > ia-decision.json
else
  echo "La IA no ha respondido:" >&2
  cat ia-respuesta.json >&2 2>/dev/null || true
fi

# Solo se acepta major, minor o patch. Cualquier otra cosa pasa a patch.
tipo=$(jq -r '.tipo // empty' ia-decision.json 2>/dev/null)
case "$tipo" in
  major|minor|patch) ;;
  *) echo "Respuesta de la IA no válida, se usa patch." >&2; tipo="patch" ;;
esac
printf '%s\n' "$tipo" > ia-tipo.txt
jq -r '.motivo // ""' ia-decision.json > ia-motivo.txt 2>/dev/null || : > ia-motivo.txt
jq -r '.resumen // ""' ia-decision.json > ia-resumen.md 2>/dev/null || : > ia-resumen.md

# La siguiente versión sale de la última etiqueta y del tipo de cambio.
IFS=. read -r mayor menor parche <<< "${ultima:-0.0.0}"
case "$tipo" in
  major) mayor=$((mayor + 1)); menor=0; parche=0 ;;
  minor) menor=$((menor + 1)); parche=0 ;;
  patch) parche=$((parche + 1)) ;;
esac
siguiente="${mayor}.${menor}.${parche}"
printf '%s\n' "$siguiente" > ia-version.txt

echo "Última versión: ${ultima:-ninguna} | tipo: ${tipo} | siguiente: ${siguiente}"
echo "Motivo: $(cat ia-motivo.txt)"
