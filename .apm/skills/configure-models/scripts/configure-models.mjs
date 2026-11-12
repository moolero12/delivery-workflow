#!/usr/bin/env node
import { execFile as execFileCb, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const here = dirname(fileURLToPath(import.meta.url));
export const PROFILES_PATH = join(here, "..", "assets", "agent-profiles.json");

export class ConfigureModelsError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function loadProfiles(path = PROFILES_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Un modelo escrito a mano acaba en el frontmatter: nada de espacios, comillas ni saltos de línea.
const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=,]*$/;

export function isModelShape(model) {
  return typeof model === "string" && MODEL_SHAPE.test(model);
}

// "inherit", vacío o null significan lo mismo: el agente no lleva línea `model`.
export function normalizeChoice(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text.toLowerCase() === "inherit") return null;
  if (!isModelShape(text)) throw new ConfigureModelsError(`Modelo no válido: «${text}». Sin espacios ni comillas.`, 2);
  return text;
}

// Primera coincidencia gana. Los modelos se prueban en el orden de la lista del nivel.
export function resolveModel(profiles, tool, tier, models) {
  const patterns = profiles.tools?.[tool]?.patterns?.[tier] ?? [];
  const ids = models.map((m) => (typeof m === "string" ? m : m.id));
  for (const source of patterns) {
    const found = ids.find((id) => new RegExp(source).test(id));
    if (found) return found;
  }
  return null;
}

export function proposeAll(profiles, tool, models) {
  return Object.entries(profiles.agents).map(([agent, { tier, why }]) => ({
    agent,
    tier,
    why,
    model: resolveModel(profiles, tool, tier, models),
  }));
}

// `cursor-agent models` imprime «id - Nombre (current, default)». Si no hay cabecera, no se fía.
export function parseCursorModels(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  if (!lines.some((l) => /^Available models\s*$/.test(l.trim()))) return [];
  const models = [];
  for (const line of lines) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._\-[\]=,]*) - (.+)$/.exec(line.trim());
    if (m) models.push({ id: m[1], name: m[2].replace(/[\u200b-\u200f\ufeff]/g, "").trim() });
  }
  return models;
}

// --- Detección ---

export const COMMAND_TIMEOUT_MS = 10000;

// Lanza un comando externo con límite de tiempo. Nunca rechaza: devuelve el estado.
// Se ejecuta en una carpeta nueva y vacía: un cursor-agent antiguo trata «models» como un prompt.
export function runCommand(command, args, { timeout = COMMAND_TIMEOUT_MS, cwd, env = process.env } = {}) {
  return new Promise((done) => {
    let scratch = null;
    if (!cwd) {
      try {
        scratch = mkdtempSync(join(tmpdir(), "dw-run-"));
        cwd = scratch;
      } catch {
        cwd = tmpdir();
      }
    }
    let out = "";
    let finished = false;
    let child;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      done(result);
    };
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return done({ status: "missing", stdout: "" });
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ status: "timeout", stdout: out });
    }, timeout);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 1_000_000) child.kill("SIGKILL");
    });
    child.on("error", (e) => finish({ status: e.code === "ENOENT" ? "missing" : "error", stdout: out }));
    child.on("close", (code) => finish({ status: code === 0 ? "ok" : "error", stdout: out }));
  });
}

// Primero cursor-agent: «agent» es un nombre genérico que puede ser otro programa.
const CURSOR_ATTEMPTS = [
  ["cursor-agent", ["--list-models"]],
  ["cursor-agent", ["models"]],
];

const REASONS = {
  missing: "no está instalado el comando de Cursor (cursor-agent)",
  timeout: "el comando de Cursor no respondió a tiempo; puede que falte iniciar sesión",
  error: "el comando de Cursor falló; puede que falte iniciar sesión",
  empty: "el comando de Cursor no devolvió una lista de modelos que se entienda",
};

// Devuelve {status: "ok"|"unknown", models, reason}. «unknown» significa que no se sabe, no que no haya.
export async function detectCursor({ run = runCommand } = {}) {
  let reason = REASONS.missing;
  let informative = false; // el primer fallo que no sea «no existe» es el que se cuenta
  const skipped = new Set();
  for (const [command, args] of CURSOR_ATTEMPTS) {
    if (skipped.has(command)) continue;
    const result = await run(command, args);
    if (result.status === "missing" || result.status === "timeout") skipped.add(command);
    let failure = result.status;
    if (result.status === "ok") {
      const models = parseCursorModels(result.stdout);
      if (models.length) return { status: "ok", models, reason: null };
      failure = "empty";
    }
    if (failure !== "missing" && !informative) {
      reason = REASONS[failure] ?? REASONS.error;
      informative = true;
    }
  }
  return { status: "unknown", models: [], reason };
}

// Claude Code no tiene comando que liste modelos: se usan sus alias, limitados por `availableModels` si los ajustes lo piden.
const CLAUDE_REASONS = {
  missing: "no está instalado el comando claude",
  timeout: "claude auth status no respondió a tiempo",
  error: "claude auth status falló",
  loggedOut: "no has iniciado sesión en Claude Code (claude auth login)",
  unreadable: "no se entendió la salida de claude auth status",
};

export function parseClaudeAuth(text) {
  try {
    const data = JSON.parse(text);
    if (typeof data?.loggedIn !== "boolean") return null;
    return { loggedIn: data.loggedIn, plan: data.subscriptionType ?? data.planTier ?? null };
  } catch {
    return null;
  }
}

// Los modelos permitidos por los ajustes (proyecto, local y usuario): si hay varios, vale lo que todos permiten.
export function readAvailableModels({ root, home = homedir() }) {
  const lists = [];
  for (const file of [join(root, ".claude", "settings.json"), join(root, ".claude", "settings.local.json"), join(home, ".claude", "settings.json")]) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8")).availableModels;
      if (Array.isArray(value) && value.length) lists.push(value.filter((v) => typeof v === "string"));
    } catch {
      /* sin archivo o ilegible: no limita */
    }
  }
  if (lists.length === 0) return null;
  // Sin lista gestionada (que no se lee), Claude Code junta las listas de usuario, proyecto y local.
  return [...new Set(lists.flat())];
}

export async function detectClaude({ run = runCommand, root, home, profile }) {
  const result = await run("claude", ["auth", "status"]);
  if (result.status !== "ok") return { status: "unknown", models: [], reason: CLAUDE_REASONS[result.status] ?? CLAUDE_REASONS.error };
  const auth = parseClaudeAuth(result.stdout);
  if (!auth) return { status: "unknown", models: [], reason: CLAUDE_REASONS.unreadable };
  if (!auth.loggedIn) return { status: "unknown", models: [], reason: CLAUDE_REASONS.loggedOut };
  const limit = readAvailableModels({ root, home });
  const ids = limit ?? profile.aliases;
  const note = `Plan detectado: ${auth.plan ?? "desconocido"}. Los alias no se filtran por plan: si el tuyo no incluye uno (por ejemplo opus) y el agente falla al llamarlo, cámbialo con --set agente=sonnet.`;
  return { status: "ok", models: ids.map((id) => ({ id, name: id })), reason: null, plan: auth.plan, note };
}

// Codex: `codex debug models` imprime el catálogo; si falla, se lee la caché que guarda el propio Codex.
// El formato está tomado de la documentación, sin probarlo con un Codex real: se acepta una lista o un objeto con `models`.
export function parseCodexModels(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(data) ? data : data?.models ?? data?.data ?? [];
  if (!Array.isArray(items)) return [];
  const models = [];
  for (const item of items) {
    const id = typeof item === "string" ? item : item?.slug ?? item?.id ?? item?.model;
    if (typeof id !== "string" || !isModelShape(id)) continue;
    if (["hide", "hidden", "none"].includes(item?.visibility)) continue;
    models.push({ id, name: item?.display_name ?? id });
  }
  return models;
}

const CODEX_REASONS = {
  missing: "no está instalado el comando codex",
  timeout: "codex debug models no respondió a tiempo; puede que falte iniciar sesión",
  error: "codex debug models falló; puede que falte iniciar sesión",
  empty: "no se encontró una lista de modelos que se entienda",
};

export async function detectCodex({ run = runCommand, home = homedir(), env = process.env } = {}) {
  const result = await run("codex", ["debug", "models"]);
  if (result.status === "ok") {
    const models = parseCodexModels(result.stdout);
    if (models.length) return { status: "ok", models, reason: null };
  }
  const reason = result.status === "ok" ? CODEX_REASONS.empty : CODEX_REASONS[result.status] ?? CODEX_REASONS.error;
  try {
    const cache = join(env.CODEX_HOME ?? join(home, ".codex"), "models_cache.json");
    const models = parseCodexModels(readFileSync(cache, "utf8"));
    if (models.length) return { status: "ok", models, reason: null };
  } catch {
    /* sin caché */
  }
  return { status: "unknown", models: [], reason };
}

export const DETECTORS = {
  cursor: (args) => detectCursor(args),
  claude: (args) => detectClaude(args),
  codex: (args) => detectCodex(args),
};

// Solo las herramientas cuya carpeta de agentes existe en el proyecto.
export function toolsPresent(profiles, root, exists = existsSync) {
  return Object.entries(profiles.tools)
    .filter(([, t]) => exists(join(root, t.agentsDir)))
    .map(([tool]) => tool);
}

export async function detect({ profiles = loadProfiles(), root, tools, run, home } = {}) {
  const present = tools ?? toolsPresent(profiles, root);
  const result = [];
  for (const tool of present) {
    let detection = await DETECTORS[tool]({ run, root, home, profile: profiles.tools[tool] });
    // Una lista vacía no es «no hay modelos»: es que no se pudo saber. Así no se guardan nulos por error.
    if (detection.status === "ok" && detection.models.length === 0) {
      detection = { ...detection, status: "unknown", reason: "la herramienta devolvió una lista de modelos vacía" };
    }
    result.push({
      tool,
      name: profiles.tools[tool].name,
      ...detection,
      proposal: proposeAll(profiles, tool, detection.models),
    });
  }
  return result;
}

// --- Escribir la línea `model` ---

function frontmatterBounds(lines) {
  if (lines[0] !== "---") throw new ConfigureModelsError("El agente no tiene frontmatter.", 3);
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new ConfigureModelsError("El frontmatter del agente no se cierra.", 3);
  return end;
}

const MODEL_LINE = /^model:(?:\s|$)/;

export function getModelMd(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const end = frontmatterBounds(lines);
  const line = lines.slice(1, end).find((l) => MODEL_LINE.test(l));
  if (line === undefined) return null;
  return line.replace(/^model:\s*/, "").replace(/^(["'])(.*)\1$/, "$2").trim() || null;
}

// Pone, cambia o quita (model = null) la línea `model` del frontmatter. Aplicarlo dos veces no cambia nada.
export function setModelMd(text, model) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const end = frontmatterBounds(lines);
  const body = lines.slice(1, end).filter((l) => !MODEL_LINE.test(l));
  if (model !== null) {
    const afterName = body.findIndex((l) => /^name:/.test(l)) + 1;
    body.splice(afterName, 0, `model: ${model}`);
  }
  return [lines[0], ...body, ...lines.slice(end)].join(eol);
}

// En TOML la línea `model = "x"` es una clave de primer nivel: antes de la primera tabla, fuera de las
// cadenas multilínea y fuera de los arrays o tablas en línea que siguen en varias líneas.
// Recorre el texto carácter a carácter (cadenas, comentarios y corchetes) y marca las líneas de primer nivel.
function topLevelLines(lines) {
  const top = new Set();
  let multi = null; // triple comilla doble o simple abierta
  let depth = 0; // [ y { abiertos fuera de cadenas
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const atStart = multi === null && depth === 0;
    if (atStart && /^\s*\[/.test(line)) break;
    if (atStart) top.add(i);
    let j = 0;
    while (j < line.length) {
      if (multi !== null) {
        const end = line.indexOf(multi, j);
        if (end === -1) break;
        let slashes = 0; // en las dobles, una barra escapa la comilla
        while (multi[0] === '"' && line[end - 1 - slashes] === "\\") slashes++;
        if (slashes % 2 === 1) {
          j = end + 1;
          continue;
        }
        multi = null;
        j = end + 3;
        continue;
      }
      const c = line[j];
      if (c === "#") break;
      if (line.startsWith('"'.repeat(3), j) || line.startsWith("'".repeat(3), j)) {
        multi = line.slice(j, j + 3);
        j += 3;
      } else if (c === '"' || c === "'") {
        j++;
        while (j < line.length && line[j] !== c) j += c === '"' && line[j] === "\\" ? 2 : 1;
        j++;
      } else {
        if (c === "[" || c === "{") depth++;
        else if ((c === "]" || c === "}") && depth > 0) depth--;
        j++;
      }
    }
  }
  return top;
}

const TOML_MODEL = /^model\s*=/;

export function getModelToml(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const top = topLevelLines(lines);
  const i = lines.findIndex((l, n) => top.has(n) && TOML_MODEL.test(l));
  if (i === -1) return null;
  return lines[i].replace(/^model\s*=\s*/, "").replace(/^(["'])(.*)\1\s*$/, "$2").trim() || null;
}

export function setModelToml(text, model) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const top = topLevelLines(lines);
  const kept = lines.filter((l, n) => !(top.has(n) && TOML_MODEL.test(l)));
  if (model !== null) {
    const keptTop = topLevelLines(kept);
    const nameAt = kept.findIndex((l, n) => keptTop.has(n) && /^name\s*=/.test(l));
    kept.splice(nameAt + 1, 0, `model = "${model}"`);
  }
  // Red de seguridad: un TOML con dos `model` no lo carga Codex. Mejor un error que escribirlo.
  const finalTop = topLevelLines(kept);
  const count = kept.filter((l, n) => finalTop.has(n) && TOML_MODEL.test(l)).length;
  if (count !== (model === null ? 0 : 1)) {
    throw new ConfigureModelsError("No se pudo escribir el modelo en el TOML sin dejarlo inválido; no se ha cambiado el archivo.", 3);
  }
  return kept.join(eol);
}

export const getModel = (text, extension) => (extension === "toml" ? getModelToml(text) : getModelMd(text));
export const setModel = (text, model, extension) => (extension === "toml" ? setModelToml(text, model) : setModelMd(text, model));

// --- Elecciones guardadas (personales: dentro de .git, git no las ve) ---

export const STATE_FILE = "delivery-workflow-models.json";

async function git(root, args) {
  try {
    const { stdout } = await execFile("git", args, { cwd: root });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function gitDir(root) {
  const dir = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!dir) throw new ConfigureModelsError("Esto no es un repositorio git: no hay dónde guardar las elecciones.", 4);
  return dir;
}

export function readState(dir) {
  try {
    const state = JSON.parse(readFileSync(join(dir, STATE_FILE), "utf8"));
    return state && typeof state === "object" && state.tools ? state : { version: 1, tools: {} };
  } catch {
    return { version: 1, tools: {} };
  }
}

export function writeState(dir, state) {
  const path = join(dir, STATE_FILE);
  if (Object.keys(state.tools).length === 0) {
    rmSync(path, { force: true });
    return;
  }
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

// --- Qué se aplica ---

// Guardado válido: sigue en la lista actual. Si no se pudo detectar, se confía: pudo escribirse a mano.
export function planChoices({ profiles, tool, detection, saved, manual = [], overrides = {} }) {
  const ids = new Set(detection.models.map((m) => m.id));
  const known = detection.status === "ok";
  const notes = [];
  const proposal = Object.fromEntries(proposeAll(profiles, tool, detection.models).map((p) => [p.agent, p.model]));
  const choices = {};
  const source = {};
  for (const agent of Object.keys(profiles.agents)) {
    if (saved && agent in saved) {
      const keep = saved[agent];
      if (keep !== null && known && !ids.has(keep) && manual.includes(agent)) {
        choices[agent] = keep;
        source[agent] = "guardado";
        notes.push(`«${keep}» (${agent}) está escrito a mano y no sale en la lista de ${profiles.tools[tool].name}: se mantiene. Si no lo reconoce, se usará el modelo del chat.`);
      } else if (keep !== null && known && !ids.has(keep)) {
        choices[agent] = proposal[agent];
        source[agent] = "reemplazado";
        notes.push(`«${keep}» (${agent}) ya no está en la lista de modelos: se usa ${proposal[agent] ?? "el del chat"}.`);
      } else {
        choices[agent] = keep;
        source[agent] = "guardado";
      }
    } else {
      choices[agent] = proposal[agent];
      source[agent] = "propuesta";
    }
  }
  for (const [agent, raw] of Object.entries(overrides)) {
    if (!(agent in profiles.agents)) throw new ConfigureModelsError(`Agente desconocido: «${agent}».`, 2);
    const model = normalizeChoice(raw);
    choices[agent] = model;
    source[agent] = "manual";
    if (model !== null && known && !ids.has(model)) {
      notes.push(`«${model}» (${agent}) no está en la lista de ${profiles.tools[tool].name}: si no lo reconoce, usará el modelo del chat sin avisar.`);
    }
  }
  if (detection.note) notes.push(detection.note);
  if (!known) {
    notes.unshift(`No se pudo leer la lista de modelos: ${detection.reason}. Se usan los modelos guardados o, si no hay, los agentes heredan el del chat.`);
  }
  if (Object.values(choices).every((m) => m === null)) {
    notes.push("Ningún agente lleva modelo: todos usan el del chat.");
  }
  return { choices, source, notes };
}

export function agentPath(profiles, root, tool, agent) {
  const t = profiles.tools[tool];
  return join(root, t.agentsDir, `${agent}.${t.extension}`);
}

// Escribe las elecciones en los archivos. Un agente que falta se salta y se dice.
export function applyToFiles({ profiles, root, tool, choices }) {
  return Object.entries(choices).map(([agent, model]) => {
    const file = agentPath(profiles, root, tool, agent);
    if (!existsSync(file)) return { agent, model, file, result: "ausente" };
    const before = readFileSync(file, "utf8");
    const after = setModel(before, model, profiles.tools[tool].extension);
    if (after === before) return { agent, model, file, result: "igual" };
    writeFileSync(file, after);
    return { agent, model, file, result: "cambiado" };
  });
}

// --- Órdenes ---

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, yes: false, target: null, root: null, set: {} };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--target") opts.target = rest[++i];
    else if (a === "--root") opts.root = rest[++i];
    else if (a === "--set") {
      const [agent, ...model] = String(rest[++i] ?? "").split("=");
      if (!agent) throw new ConfigureModelsError("--set espera agente=modelo.", 2);
      opts.set[agent] = model.join("=");
    } else throw new ConfigureModelsError(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

export const USAGE = [
  "Uso: configure-models.mjs <detect|apply|reset|status> [opciones]",
  "  detect                 Muestra los modelos detectados y la propuesta por agente (JSON).",
  "  apply                  Escribe el modelo en cada agente. Sin --set usa lo guardado o la propuesta.",
  "  reset                  Quita la línea model de los agentes y borra lo guardado.",
  "  status                 Una línea para check-status.",
  "Opciones: --yes|-y  --target cursor|claude|codex  --set agente=modelo (inherit = sin modelo)  --root RUTA",
].join("\n");

async function resolveRoot(opts) {
  if (opts.root) return resolve(opts.root);
  return (await git(process.cwd(), ["rev-parse", "--show-toplevel"])) ?? process.cwd();
}

function selectTools(opts, profiles, root) {
  const present = toolsPresent(profiles, root);
  if (!opts.target) return present;
  if (!profiles.tools[opts.target]) throw new ConfigureModelsError(`Herramienta desconocida: «${opts.target}».`, 2);
  if (!present.includes(opts.target)) {
    throw new ConfigureModelsError(`No hay carpeta de agentes de ${opts.target} en este proyecto. ¿Has ejecutado apm install?`, 3);
  }
  return [opts.target];
}

export async function run(argv, { run: runner, profiles = loadProfiles() } = {}) {
  const opts = parseArgs(argv);
  const root = await resolveRoot(opts);
  if (opts.command === "status") return statusLine({ profiles, root });
  if (!["detect", "apply", "reset"].includes(opts.command)) throw new ConfigureModelsError(USAGE, 2);
  const tools = selectTools(opts, profiles, root);
  if (tools.length === 0) {
    throw new ConfigureModelsError("No hay carpetas de agentes en este proyecto (.cursor/agents, .claude/agents, .codex/agents). Ejecuta apm install antes.", 3);
  }
  if (opts.command === "apply" && Object.keys(opts.set).length > 0 && tools.length > 1) {
    throw new ConfigureModelsError("--set vale para una sola herramienta: cada una nombra sus modelos a su manera. Añade --target cursor|claude|codex.", 2);
  }
  if (opts.command === "detect") {
    return JSON.stringify(await detectWithSaved({ profiles, root, tools, runner }), null, 2);
  }
  const dir = await gitDir(root);
  const state = readState(dir);
  const results = [];
  for (const tool of tools) {
    results.push(opts.command === "reset" ? await resetOne({ profiles, root, tool, state }) : await applyOne({ profiles, root, tool, state, opts, runner }));
  }
  writeState(dir, state);
  return JSON.stringify(results, null, 2);
}

// La propuesta parte de lo guardado (si sigue valiendo) y, si no hay nada guardado, del nivel de cada agente.
export async function detectWithSaved({ profiles, root, tools, runner }) {
  let state = { tools: {} };
  try {
    state = readState(await gitDir(root));
  } catch {
    /* sin repositorio git no hay elecciones guardadas */
  }
  const detections = await detect({ profiles, root, tools, run: runner });
  return detections.map((d) => {
    const saved = state.tools[d.tool]?.agents ?? null;
    const manual = state.tools[d.tool]?.manual ?? [];
    const { choices, source, notes } = planChoices({ profiles, tool: d.tool, detection: d, saved, manual });
    return {
      ...d,
      saved: saved !== null && Object.keys(saved).length > 0,
      notes,
      proposal: d.proposal.map((p) => ({ ...p, model: choices[p.agent], source: source[p.agent] })),
    };
  });
}

async function applyOne({ profiles, root, tool, state, opts, runner }) {
  const [detection] = await detect({ profiles, root, tools: [tool], run: runner });
  const saved = state.tools[tool]?.agents ?? null;
  const wasManual = state.tools[tool]?.manual ?? [];
  const { choices, source, notes } = planChoices({ profiles, tool, detection, saved, manual: wasManual, overrides: opts.set });
  const files = applyToFiles({ profiles, root, tool, choices });
  // Sin modelo propuesto no se guarda nada: «no había qué proponer» no es «elegí heredar» (eso es --set x=inherit).
  const keep = Object.keys(choices).filter((a) => choices[a] !== null || !["propuesta", "reemplazado"].includes(source[a]));
  if (keep.length === 0) delete state.tools[tool];
  else {
    state.tools[tool] = {
      agents: Object.fromEntries(keep.map((a) => [a, choices[a]])),
      manual: keep.filter((a) => choices[a] !== null && (source[a] === "manual" || (source[a] === "guardado" && wasManual.includes(a)))),
    };
  }
  for (const f of files) if (f.result === "ausente") notes.push(`Falta el archivo de ${f.agent}: ejecuta apm install.`);
  return {
    tool,
    name: profiles.tools[tool].name,
    detection: { status: detection.status, reason: detection.reason },
    agents: files.map((f) => ({
      agent: f.agent,
      model: f.model,
      tier: profiles.agents[f.agent].tier,
      why: profiles.agents[f.agent].why,
      source: source[f.agent],
      result: f.result,
    })),
    notes,
  };
}

async function resetOne({ profiles, root, tool, state }) {
  const choices = Object.fromEntries(Object.keys(profiles.agents).map((a) => [a, null]));
  const files = applyToFiles({ profiles, root, tool, choices });
  delete state.tools[tool];
  return {
    tool,
    name: profiles.tools[tool].name,
    agents: files.map((f) => ({ agent: f.agent, result: f.result })),
    notes: ["Los agentes vuelven a heredar el modelo del chat."],
  };
}

// Una línea para check-status: sin configurar, configurado o desincronizado.
export function statusLine({ profiles, root }) {
  const tools = toolsPresent(profiles, root);
  if (tools.length === 0) return "sin configurar (no hay carpeta de agentes en este proyecto; ejecuta apm install)";
  let dir;
  try {
    dir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "sin configurar (no es un repositorio git)";
  }
  const state = readState(dir);
  const parts = [];
  let allOk = true;
  let any = false;
  let withModel = 0;
  for (const tool of tools) {
    const saved = state.tools[tool]?.agents;
    if (!saved) {
      parts.push(`${tool} sin configurar`);
      continue;
    }
    any = true;
    const names = Object.keys(profiles.agents);
    let match = 0;
    for (const agent of names) {
      const file = agentPath(profiles, root, tool, agent);
      try {
        if ((getModel(readFileSync(file, "utf8"), profiles.tools[tool].extension) ?? null) === (saved[agent] ?? null)) match++;
      } catch {
        /* archivo ausente o ilegible: no coincide */
      }
    }
    if (match !== names.length) allOk = false;
    withModel += names.filter((a) => (saved[a] ?? null) !== null).length;
    parts.push(`${tool} ${match}/${names.length}`);
  }
  if (!any) return "sin configurar (ejecuta /configure-models)";
  const list = parts.join(", ");
  if (allOk && !withModel) return `configurado, pero ningún agente lleva modelo (${list}): heredan el del chat`;
  return allOk && parts.every((p) => /\d+\/\d+$/.test(p))
    ? `configurado (${list})`
    : `desincronizado (${list}): ejecuta /configure-models para volver a aplicarlo`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = typeof e.code === "number" ? e.code : 1;
    });
}
