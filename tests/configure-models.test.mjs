import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadProfiles,
  resolveModel,
  proposeAll,
  parseCursorModels,
  normalizeChoice,
  isModelShape,
} from "../.apm/skills/configure-models/scripts/configure-models.mjs";

const FIXTURES = new URL("./fixtures/configure-models/", import.meta.url).pathname;
const AGENTS = new URL("../.apm/agents/", import.meta.url).pathname;
const profiles = loadProfiles();
const cursorOutput = readFileSync(join(FIXTURES, "cursor-agent-models.txt"), "utf8");

test("los agentes del catálogo son exactamente los archivos de .apm/agents", () => {
  const files = readdirSync(AGENTS)
    .filter((f) => f.endsWith(".agent.md"))
    .map((f) => f.replace(/\.agent\.md$/, ""))
    .sort();
  assert.deepEqual(Object.keys(profiles.agents).sort(), files);
});

test("cada agente tiene un nivel que existe y una explicación", () => {
  for (const [name, { tier, why }] of Object.entries(profiles.agents)) {
    assert.ok(profiles.tiers[tier], `${name}: nivel desconocido ${tier}`);
    assert.ok(why.length > 5, `${name}: falta el motivo`);
  }
});

test("los fixtures no llevan correos ni datos de la cuenta", () => {
  for (const file of readdirSync(FIXTURES)) {
    const text = readFileSync(join(FIXTURES, file), "utf8");
    assert.ok(!text.includes("@"), `${file} contiene una @`);
    assert.ok(!text.includes(process.env.HOME ?? "\0"), `${file} contiene la ruta personal`);
  }
});

test("el parser de Cursor lee la salida real de cursor-agent models", () => {
  const models = parseCursorModels(cursorOutput);
  const ids = models.map((m) => m.id);
  assert.ok(ids.includes("composer-2.5"));
  assert.ok(ids.includes("grok-4.7-medium"));
  assert.ok(ids.includes("cursor-grok-4.6-medium"));
  assert.ok(ids.every((id) => !/\s/.test(id) && !id.includes("[")), "ids sin variantes entre corchetes");
  assert.ok(!ids.includes("Tip:"));
});

test("sin la cabecera «Available models» el parser no inventa modelos", () => {
  assert.deepEqual(parseCursorModels(""), []);
  assert.deepEqual(parseCursorModels("Starting login process...\nfoo - bar"), []);
});

test("cada nivel elige el primer patrón que coincide", () => {
  const models = parseCursorModels(cursorOutput);
  assert.equal(resolveModel(profiles, "cursor", "heavy", models), "composer-2.5");
  assert.equal(resolveModel(profiles, "cursor", "light", models), "composer-2.5");
  const withOpus = [{ id: "claude-opus-4-8" }, ...models];
  assert.equal(resolveModel(profiles, "cursor", "heavy", withOpus), "claude-opus-4-8");
});

test("sin modelos detectados no se propone ninguno y todos heredan", () => {
  const proposal = proposeAll(profiles, "cursor", []);
  assert.equal(proposal.length, 8);
  assert.ok(proposal.every((p) => p.model === null));
});

test("la propuesta lleva nivel y motivo por agente", () => {
  const proposal = proposeAll(profiles, "cursor", parseCursorModels(cursorOutput));
  const cd = proposal.find((p) => p.agent === "concept-developer");
  assert.equal(cd.tier, "heavy");
  assert.match(cd.why, /spec/);
});

test("un modelo a mano se valida y «inherit» o vacío significan heredar", () => {
  assert.equal(normalizeChoice("grok-4.7-medium"), "grok-4.7-medium");
  assert.equal(normalizeChoice("claude-opus-4-8[effort=high]"), "claude-opus-4-8[effort=high]");
  assert.equal(normalizeChoice(""), null);
  assert.equal(normalizeChoice("INHERIT"), null);
  assert.equal(normalizeChoice(undefined), null);
  assert.throws(() => normalizeChoice("a b"), /no válido/);
  assert.throws(() => normalizeChoice('x"\nname: y'), /no válido/);
  assert.equal(isModelShape("-x"), false);
});

// --- Detección ---

import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectCursor, detect, runCommand, toolsPresent } from "../.apm/skills/configure-models/scripts/configure-models.mjs";

const fake = (table) => async (command, args) => table[`${command} ${args.join(" ")}`] ?? { status: "missing", stdout: "" };

test("detecta los modelos con cursor-agent --list-models", async () => {
  const d = await detectCursor({ run: fake({ "cursor-agent --list-models": { status: "ok", stdout: cursorOutput } }) });
  assert.equal(d.status, "ok");
  assert.ok(d.models.some((m) => m.id === "composer-2.5"));
});

test("prueba --list-models antes que «models» y nunca lanza el binario genérico agent", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(`${command} ${args[0]}`);
    return { status: "ok", stdout: "" };
  };
  await detectCursor({ run });
  assert.deepEqual(calls, ["cursor-agent --list-models", "cursor-agent models"]);
});

test("si --list-models no existe en un cursor-agent viejo, usa «models»", async () => {
  const d = await detectCursor({ run: fake({ "cursor-agent --list-models": { status: "error", stdout: "" }, "cursor-agent models": { status: "ok", stdout: cursorOutput } }) });
  assert.equal(d.status, "ok");
});

test("sin ningún comando el estado es desconocido y lo dice", async () => {
  const d = await detectCursor({ run: fake({}) });
  assert.equal(d.status, "unknown");
  assert.deepEqual(d.models, []);
  assert.match(d.reason, /no está instalado/);
});

test("un tiempo agotado es desconocido y no se reintenta con el mismo comando", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(`${command} ${args[0]}`);
    return { status: "timeout", stdout: "" };
  };
  const d = await detectCursor({ run });
  assert.equal(d.status, "unknown");
  assert.match(d.reason, /iniciar sesión/);
  assert.deepEqual(calls, ["cursor-agent --list-models"]);
});

test("una salida que no es una lista de modelos es desconocido", async () => {
  const d = await detectCursor({ run: fake({ "cursor-agent --list-models": { status: "ok", stdout: "Starting login process...\n" } }) });
  assert.equal(d.status, "unknown");
  assert.match(d.reason, /no devolvió una lista/);
});

test("runCommand corta un comando que no responde", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-"));
  const bin = join(dir, "colgado");
  writeFileSync(bin, "#!/bin/sh\nsleep 30\n");
  chmodSync(bin, 0o755);
  const started = Date.now();
  const result = await runCommand(bin, [], { timeout: 300 });
  assert.equal(result.status, "timeout");
  assert.ok(Date.now() - started < 5000);
});

test("runCommand distingue comando ausente, error y éxito", async () => {
  assert.equal((await runCommand("no-existe-este-comando-xyz", [])).status, "missing");
  assert.equal((await runCommand("sh", ["-c", "exit 3"])).status, "error");
  const ok = await runCommand("sh", ["-c", "echo hola"]);
  assert.equal(ok.status, "ok");
  assert.equal(ok.stdout.trim(), "hola");
});

test("solo se detectan las herramientas con carpeta de agentes", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-"));
  assert.deepEqual(toolsPresent(profiles, root), []);
  mkdirSync(join(root, ".cursor", "agents"), { recursive: true });
  assert.deepEqual(toolsPresent(profiles, root), ["cursor"]);
});

test("detect junta modelos y propuesta por herramienta", async () => {
  const [r] = await detect({ tools: ["cursor"], run: fake({ "cursor-agent --list-models": { status: "ok", stdout: cursorOutput } }) });
  assert.equal(r.tool, "cursor");
  assert.equal(r.proposal.length, 8);
  assert.equal(r.proposal.find((p) => p.agent === "create-branch").model, "composer-2.5");
});

test("sin modelos detectados ninguna propuesta lleva modelo", async () => {
  const [r] = await detect({ tools: ["cursor"], run: fake({}) });
  assert.ok(r.proposal.every((p) => p.model === null));
});

// --- Escribir y deshacer ---

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, statSync } from "node:fs";
import {
  setModelMd,
  getModelMd,
  planChoices,
  run,
  statusLine,
  STATE_FILE,
} from "../.apm/skills/configure-models/scripts/configure-models.mjs";

const AGENT = `---\nname: create-branch\ndescription: "Abre la rama."\nskills:\n  - create-branch\n---\n# Cuerpo\nmodel: no es del frontmatter\n`;

test("setModelMd añade la línea tras name y no toca el cuerpo", () => {
  const out = setModelMd(AGENT, "composer-2.5");
  assert.equal(out, AGENT.replace("name: create-branch\n", "name: create-branch\nmodel: composer-2.5\n"));
  assert.equal(getModelMd(out), "composer-2.5");
});

test("setModelMd es idempotente y null devuelve el original", () => {
  const once = setModelMd(AGENT, "composer-2.5");
  assert.equal(setModelMd(once, "composer-2.5"), once);
  assert.equal(setModelMd(once, null), AGENT);
  assert.equal(setModelMd(AGENT, null), AGENT);
});

test("setModelMd reemplaza una línea model que ya existe", () => {
  const edited = setModelMd(AGENT, "viejo");
  const out = setModelMd(edited, "nuevo");
  assert.equal(getModelMd(out), "nuevo");
  assert.equal(out.split("\n---\n")[0].match(/^model:/gm).length, 1);
});

test("setModelMd respeta los saltos de línea CRLF", () => {
  const crlf = AGENT.replace(/\n/g, "\r\n");
  const out = setModelMd(crlf, "composer-2.5");
  assert.ok(out.includes("name: create-branch\r\nmodel: composer-2.5\r\n"));
  assert.equal(setModelMd(out, null), crlf);
});

test("un archivo sin frontmatter da un error claro", () => {
  assert.throws(() => setModelMd("hola", "x"), /frontmatter/);
});

const SAVED_DETECTION = (status, ids) => ({ status, models: ids.map((id) => ({ id })), reason: "no está instalado" });

test("lo guardado sigue valiendo si está en la lista", () => {
  const { choices, source } = planChoices({
    profiles, tool: "cursor", detection: SAVED_DETECTION("ok", ["composer-2.5", "grok-4.7-medium"]),
    saved: { "create-branch": "grok-4.7-medium" },
  });
  assert.equal(choices["create-branch"], "grok-4.7-medium");
  assert.equal(source["create-branch"], "guardado");
});

test("lo guardado que ya no está en la lista se sustituye por la propuesta", () => {
  const { choices, notes } = planChoices({
    profiles, tool: "cursor", detection: SAVED_DETECTION("ok", ["composer-2.5"]),
    saved: { "create-branch": "grok-4.7-medium" },
  });
  assert.equal(choices["create-branch"], "composer-2.5");
  assert.ok(notes.some((n) => n.includes("ya no está en la lista")));
});

test("si no se pudo detectar, lo guardado se respeta aunque sea a mano", () => {
  const { choices, notes } = planChoices({
    profiles, tool: "cursor", detection: SAVED_DETECTION("unknown", []),
    saved: { "create-branch": "modelo-a-mano" },
  });
  assert.equal(choices["create-branch"], "modelo-a-mano");
  assert.equal(choices["code-developer"], null);
  assert.match(notes[0], /No se pudo leer la lista/);
  assert.ok(notes.some((n) => n.includes("Ningún agente lleva modelo")) === false);
});

test("--set pisa lo guardado, avisa si no está en la lista y rechaza agentes desconocidos", () => {
  const detection = SAVED_DETECTION("ok", ["composer-2.5"]);
  const { choices, notes } = planChoices({ profiles, tool: "cursor", detection, saved: null, overrides: { "create-pr": "otro-modelo", "code-tester": "inherit" } });
  assert.equal(choices["create-pr"], "otro-modelo");
  assert.equal(choices["code-tester"], null);
  assert.ok(notes.some((n) => n.includes("otro-modelo") && n.includes("sin avisar")));
  assert.throws(() => planChoices({ profiles, tool: "cursor", detection, saved: null, overrides: { fantasma: "x" } }), /desconocido/);
});

// Un proyecto desechable con git y los 8 agentes copiados como los despliega apm.
function project({ commit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cm-proj-"));
  const sh = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  sh("init", "-q");
  sh("config", "user.email", "t@example.invalid");
  sh("config", "user.name", "t");
  mkdirSync(join(root, ".cursor", "agents"), { recursive: true });
  for (const f of readdirSync(AGENTS)) {
    copyFileSync(join(AGENTS, f), join(root, ".cursor", "agents", f.replace(".agent.md", ".md")));
  }
  if (commit) {
    sh("add", "-A");
    sh("commit", "-q", "-m", "x");
  }
  return root;
}

const snapshot = (root) =>
  Object.fromEntries(readdirSync(join(root, ".cursor", "agents")).map((f) => [f, readFileSync(join(root, ".cursor", "agents", f), "utf8")]));
const withModels = fake({ "cursor-agent --list-models": { status: "ok", stdout: cursorOutput } });
const exec = async (root, args, runner = withModels) => JSON.parse(await run([...args, "--root", root], { run: runner }));

test("apply escribe el modelo en los 8 agentes y dos veces da los mismos archivos", async () => {
  const root = project();
  const [r1] = await exec(root, ["apply"]);
  assert.equal(r1.agents.length, 8);
  const first = snapshot(root);
  assert.equal(getModelMd(first["concept-developer.md"]), "composer-2.5");
  assert.equal(getModelMd(first["create-branch.md"]), "composer-2.5");
  const [r2] = await exec(root, ["apply"]);
  assert.ok(r2.agents.every((a) => a.result === "igual"));
  assert.deepEqual(snapshot(root), first);
});

test("reset deja los archivos como estaban y borra lo guardado", async () => {
  const root = project();
  const original = snapshot(root);
  await exec(root, ["apply"]);
  const state = join(root, ".git", STATE_FILE);
  assert.ok(existsSync(state));
  assert.equal(statSync(state).mode & 0o777, 0o600);
  await exec(root, ["reset"]);
  assert.deepEqual(snapshot(root), original);
  assert.ok(!existsSync(state));
});

test("sin modelos detectados los agentes quedan sin model y la salida lo dice", async () => {
  const root = project();
  const original = snapshot(root);
  const [r] = await exec(root, ["apply"], fake({}));
  assert.deepEqual(snapshot(root), original);
  assert.ok(r.agents.every((a) => a.model === null));
  assert.ok(r.notes.some((n) => n.includes("Ningún agente lleva modelo")));
  assert.ok(r.notes.some((n) => n.includes("No se pudo leer la lista")));
});

test("apply sin argumentos tras apm install vuelve a poner lo guardado, sin preguntar", async () => {
  const root = project();
  await exec(root, ["apply", "--set", "create-branch=modelo-a-mano", "--set", "code-tester=inherit"], fake({}));
  const configured = snapshot(root);
  for (const f of Object.keys(configured)) copyFileSync(join(AGENTS, f.replace(".md", ".agent.md")), join(root, ".cursor", "agents", f)); // apm install borra las líneas
  assert.notDeepEqual(snapshot(root), configured);
  await exec(root, ["apply"], fake({}));
  assert.deepEqual(snapshot(root), configured);
});

test("--set escribe el modelo a mano y inherit lo quita", async () => {
  const root = project();
  const [r] = await exec(root, ["apply", "--set", "create-pr=grok-4.7-medium", "--set", "create-branch=inherit"]);
  const files = snapshot(root);
  assert.equal(getModelMd(files["create-pr.md"]), "grok-4.7-medium");
  assert.equal(getModelMd(files["create-branch.md"]), null);
  assert.equal(r.agents.find((a) => a.agent === "create-pr").source, "manual");
});

test("--set con un modelo de forma rara se rechaza y no escribe nada", async () => {
  const root = project();
  const original = snapshot(root);
  await assert.rejects(exec(root, ["apply", "--set", "create-pr=a b"]), /no válido/);
  assert.deepEqual(snapshot(root), original);
});

test("sin carpeta de agentes apply explica qué hacer", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-vacio-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await assert.rejects(run(["apply", "--root", root], { run: withModels }), /apm install/);
});

test("status: sin configurar, configurado y desincronizado", async () => {
  const root = project();
  assert.match(statusLine({ profiles, root }), /^sin configurar/);
  await exec(root, ["apply"]);
  assert.equal(statusLine({ profiles, root }), "configurado (cursor 8/8)");
  copyFileSync(join(AGENTS, "create-pr.agent.md"), join(root, ".cursor", "agents", "create-pr.md"));
  assert.match(statusLine({ profiles, root }), /^desincronizado \(cursor 7\/8\)/);
  await exec(root, ["apply"]);
  assert.equal(statusLine({ profiles, root }), "configurado (cursor 8/8)");
});

test("status no falla sin repo, sin carpeta de agentes ni fichero de elecciones", () => {
  const sinGit = mkdtempSync(join(tmpdir(), "cm-sg-"));
  assert.match(statusLine({ profiles, root: sinGit }), /^sin configurar/);
  mkdirSync(join(sinGit, ".cursor", "agents"), { recursive: true });
  assert.match(statusLine({ profiles, root: sinGit }), /no es un repositorio git/);
});

test("detect por la CLI devuelve la propuesta en JSON", async () => {
  const [r] = await exec(project(), ["detect"]);
  assert.equal(r.tool, "cursor");
  assert.equal(r.status, "ok");
  assert.equal(r.proposal.length, 8);
});

test("detect parte de lo guardado: tras guardar, la propuesta es lo guardado", async () => {
  const root = project();
  await exec(root, ["apply", "--set", "create-pr=grok-4.7-medium"]);
  const [r] = await exec(root, ["detect"]);
  assert.equal(r.saved, true);
  const pr = r.proposal.find((p) => p.agent === "create-pr");
  assert.equal(pr.model, "grok-4.7-medium");
  assert.equal(pr.source, "guardado");
});

test("detect sin nada guardado marca la propuesta como tal", async () => {
  const [r] = await exec(project(), ["detect"]);
  assert.equal(r.saved, false);
  assert.ok(r.proposal.every((p) => p.source === "propuesta"));
});

// --- Claude Code y Codex ---

import {
  parseClaudeAuth,
  readAvailableModels,
  detectClaude,
  parseCodexModels,
  detectCodex,
  setModelToml,
  getModelToml,
} from "../.apm/skills/configure-models/scripts/configure-models.mjs";

const claudeAuth = readFileSync(join(FIXTURES, "claude-auth-status.json"), "utf8");
// Hecho a mano: no había Codex para capturar la salida real de `codex debug models`.
const codexSample = readFileSync(join(FIXTURES, "codex-models.hecho-a-mano.json"), "utf8");
const emptyHome = () => mkdtempSync(join(tmpdir(), "cm-home-"));

test("el parser de Claude lee la salida real de claude auth status", () => {
  assert.deepEqual(parseClaudeAuth(claudeAuth), { loggedIn: true, plan: "pro" });
  assert.equal(parseClaudeAuth("no es json"), null);
  assert.equal(parseClaudeAuth("{}"), null);
});

test("Claude propone sus alias con el plan cuando hay sesión", async () => {
  const d = await detectClaude({ run: fake({ "claude auth status": { status: "ok", stdout: claudeAuth } }), root: emptyHome(), home: emptyHome(), profile: profiles.tools.claude });
  assert.equal(d.status, "ok");
  assert.deepEqual(d.models.map((m) => m.id), ["opus", "sonnet", "haiku"]);
  assert.equal(d.plan, "pro");
});

test("availableModels limita los alias; con varios archivos se juntan (unión, como hace Claude Code)", () => {
  const root = emptyHome();
  const home = emptyHome();
  mkdirSync(join(root, ".claude"));
  mkdirSync(join(home, ".claude"));
  assert.equal(readAvailableModels({ root, home }), null);
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "sonnet", availableModels: ["sonnet", "haiku"] }));
  assert.deepEqual(readAvailableModels({ root, home }), ["sonnet", "haiku"]);
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ availableModels: ["haiku", "opus"] }));
  assert.deepEqual(readAvailableModels({ root, home }), ["haiku", "opus", "sonnet"]);
});

test("Claude con availableModels solo ofrece esos modelos", async () => {
  const root = emptyHome();
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ availableModels: ["sonnet", "haiku"] }));
  const d = await detectClaude({ run: fake({ "claude auth status": { status: "ok", stdout: claudeAuth } }), root, home: emptyHome(), profile: profiles.tools.claude });
  assert.deepEqual(d.models.map((m) => m.id), ["sonnet", "haiku"]);
  assert.equal(resolveModel(profiles, "claude", "heavy", d.models), "sonnet");
});

test("Claude sin sesión, sin comando, con fallo o con salida rara es desconocido y lo dice", async () => {
  const base = { root: emptyHome(), home: emptyHome(), profile: profiles.tools.claude };
  const out = async (table) => detectClaude({ ...base, run: fake(table) });
  assert.match((await out({ "claude auth status": { status: "ok", stdout: '{"loggedIn": false}' } })).reason, /iniciado sesión/);
  assert.match((await out({})).reason, /no está instalado/);
  assert.match((await out({ "claude auth status": { status: "timeout", stdout: "" } })).reason, /a tiempo/);
  assert.match((await out({ "claude auth status": { status: "ok", stdout: "hola" } })).reason, /no se entendió/);
  assert.deepEqual((await out({})).models, []);
});

test("cada nivel de Claude elige su alias", () => {
  const models = ["opus", "sonnet", "haiku"].map((id) => ({ id }));
  assert.equal(resolveModel(profiles, "claude", "heavy", models), "opus");
  assert.equal(resolveModel(profiles, "claude", "standard", models), "sonnet");
  assert.equal(resolveModel(profiles, "claude", "light", models), "haiku");
});

const TOML = `name = "create-branch"\ndescription = "Abre la rama."\ndeveloper_instructions = "# Subagente\\n\\nHaz esto."\n`;

test("setModelToml añade la clave tras name, es idempotente y null devuelve el original", () => {
  const once = setModelToml(TOML, "gpt-5.1-codex");
  assert.equal(once, TOML.replace('name = "create-branch"\n', 'name = "create-branch"\nmodel = "gpt-5.1-codex"\n'));
  assert.equal(getModelToml(once), "gpt-5.1-codex");
  assert.equal(setModelToml(once, "gpt-5.1-codex"), once);
  assert.equal(setModelToml(once, null), TOML);
  assert.equal(getModelToml(TOML), null);
});

test("setModelToml reemplaza la clave y no toca model dentro de tablas ni de cadenas multilínea", () => {
  const complex = `name = "a"\ndeveloper_instructions = """\nmodel = "no soy yo"\n"""\n\n[mcp_servers.x]\nmodel = "tampoco"\n`;
  const out = setModelToml(complex, "uno");
  assert.ok(out.includes('model = "no soy yo"') && out.includes('model = "tampoco"'));
  assert.equal(getModelToml(out), "uno");
  assert.equal(getModelToml(setModelToml(out, "dos")), "dos");
  assert.equal(setModelToml(out, null), complex);
});

test("setModelToml respeta CRLF", () => {
  const crlf = TOML.replace(/\n/g, "\r\n");
  assert.equal(setModelToml(setModelToml(crlf, "x"), null), crlf);
});

test("el parser de Codex acepta un objeto con models o una lista y salta los ocultos", () => {
  const ids = parseCodexModels(codexSample).map((m) => m.id);
  assert.deepEqual(ids, ["gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5.1"]);
  assert.deepEqual(parseCodexModels('["gpt-a","gpt-b"]').map((m) => m.id), ["gpt-a", "gpt-b"]);
  assert.deepEqual(parseCodexModels("no es json"), []);
  assert.deepEqual(parseCodexModels('{"models": 3}'), []);
});

test("cada nivel de Codex elige su modelo", () => {
  const models = parseCodexModels(codexSample);
  assert.equal(resolveModel(profiles, "codex", "heavy", models), "gpt-5.1-codex");
  assert.equal(resolveModel(profiles, "codex", "light", models), "gpt-5.1-codex-mini");
});

test("Codex lee codex debug models y, si falla, la caché de ~/.codex", async () => {
  const ok = await detectCodex({ run: fake({ "codex debug models": { status: "ok", stdout: codexSample } }), home: emptyHome(), env: {} });
  assert.equal(ok.status, "ok");
  const home = emptyHome();
  mkdirSync(join(home, ".codex"));
  writeFileSync(join(home, ".codex", "models_cache.json"), codexSample);
  const cached = await detectCodex({ run: fake({}), home, env: {} });
  assert.equal(cached.status, "ok");
  assert.equal(cached.models.length, 3);
});

test("Codex sin comando ni caché es desconocido y dice por qué", async () => {
  const d = await detectCodex({ run: fake({}), home: emptyHome(), env: {} });
  assert.equal(d.status, "unknown");
  assert.match(d.reason, /no está instalado el comando codex/);
  const t = await detectCodex({ run: fake({ "codex debug models": { status: "timeout", stdout: "" } }), home: emptyHome(), env: {} });
  assert.match(t.reason, /iniciar sesión/);
});

// Un proyecto con los agentes de una herramienta, con el nombre y la extensión que deja apm.
function projectFor(tool) {
  const root = mkdtempSync(join(tmpdir(), "cm-proj-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const { agentsDir, extension } = profiles.tools[tool];
  mkdirSync(join(root, agentsDir), { recursive: true });
  for (const name of Object.keys(profiles.agents)) {
    const body = extension === "toml" ? `name = "${name}"\ndescription = "d"\ndeveloper_instructions = "x"\n` : `---\nname: ${name}\ndescription: "d"\n---\ncuerpo\n`;
    writeFileSync(join(root, agentsDir, `${name}.${extension}`), body);
  }
  return root;
}
const allRuns = fake({
  "cursor-agent --list-models": { status: "ok", stdout: cursorOutput },
  "claude auth status": { status: "ok", stdout: claudeAuth },
  "codex debug models": { status: "ok", stdout: codexSample },
});

test("apply en Claude Code escribe alias en .claude/agents", async () => {
  const root = projectFor("claude");
  const [r] = await exec(root, ["apply"], allRuns);
  assert.equal(r.tool, "claude");
  const text = (a) => readFileSync(join(root, ".claude", "agents", `${a}.md`), "utf8");
  assert.equal(getModelMd(text("concept-developer")), "opus");
  assert.equal(getModelMd(text("code-developer")), "sonnet");
  assert.equal(getModelMd(text("create-branch")), "haiku");
});

test("apply en Codex escribe model en los .toml, es idempotente y reset lo deshace", async () => {
  const root = projectFor("codex");
  const file = (a) => join(root, ".codex", "agents", `${a}.toml`);
  const original = readFileSync(file("create-pr"), "utf8");
  await exec(root, ["apply"], allRuns);
  const first = readFileSync(file("create-pr"), "utf8");
  assert.equal(getModelToml(first), "gpt-5.1-codex-mini");
  await exec(root, ["apply"], allRuns);
  assert.equal(readFileSync(file("create-pr"), "utf8"), first);
  await exec(root, ["reset"], allRuns);
  assert.equal(readFileSync(file("create-pr"), "utf8"), original);
});

test("con las tres herramientas, apply y status las cubren a todas", async () => {
  const root = projectFor("cursor");
  for (const tool of ["claude", "codex"]) {
    const { agentsDir, extension } = profiles.tools[tool];
    mkdirSync(join(root, agentsDir), { recursive: true });
    const other = projectFor(tool);
    for (const f of readdirSync(join(other, agentsDir))) copyFileSync(join(other, agentsDir, f), join(root, agentsDir, f));
    assert.ok(extension);
  }
  // projectFor("cursor") escribió el frontmatter md; las tres carpetas existen
  assert.deepEqual(toolsPresent(profiles, root), ["cursor", "claude", "codex"]);
  const results = await exec(root, ["apply"], allRuns);
  assert.deepEqual(results.map((r) => r.tool), ["cursor", "claude", "codex"]);
  assert.equal(statusLine({ profiles, root }), "configurado (cursor 8/8, claude 8/8, codex 8/8)");
  const only = await exec(root, ["apply", "--target", "claude"], allRuns);
  assert.equal(only.length, 1);
  await assert.rejects(exec(project(), ["apply", "--target", "codex"], allRuns), /codex/);
});

test("--target rechaza una herramienta que no existe", async () => {
  await assert.rejects(exec(project(), ["apply", "--target", "vim"]), /Herramienta desconocida/);
});

test("--set sin --target con varias herramientas se rechaza y no escribe nada", async () => {
  const root = projectFor("cursor");
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  await assert.rejects(exec(root, ["apply", "--set", "create-pr=composer-2.5"], allRuns), /--target/);
  const ok = await exec(root, ["apply", "--target", "cursor", "--set", "create-pr=composer-2.5"], allRuns);
  assert.equal(ok.length, 1);
});

test("mini no coincide con gemini: un Gemini Pro no cae en el nivel ligero", () => {
  const models = ["gemini-3-pro", "gpt-5.1-codex-mini", "o4-mini"];
  assert.equal(resolveModel(profiles, "codex", "light", models), "gpt-5.1-codex-mini");
  assert.equal(resolveModel(profiles, "cursor", "light", ["gemini-3-pro"]), null);
  assert.equal(resolveModel(profiles, "cursor", "light", ["gemini-3-pro", "gpt-5-mini"]), "gpt-5-mini");
});

test("status: si ningún agente lleva modelo no dice «configurado» a secas", async () => {
  const root = project();
  await exec(root, ["apply", "--set", "code-developer=inherit"], fake({}));
  assert.match(statusLine({ profiles, root }), /^configurado, pero ningún agente lleva modelo \(cursor 8\/8\)/);
});

test("Claude: la nota enseña el plan y cómo cambiar un alias", async () => {
  const d = await detectClaude({ run: fake({ "claude auth status": { status: "ok", stdout: readFileSync(join(FIXTURES, "claude-auth-status.json"), "utf8") } }), root: tmpdir(), home: tmpdir(), profile: profiles.tools.claude });
  assert.match(d.note, /Plan detectado: .*--set agente=sonnet/);
});

const TOML_ARRAY = [
  'name = "a"',
  "tools = [",
  '  ["x", "y"],',
  '  ["z"], # otro [',
  "]",
  'description = "d" # nota con [corchete',
  'inline = { k = ["v"] }',
  'developer_instructions = "texto con [ y ] dentro"',
  "",
  "[mcp_servers.x]",
  'model = "tampoco"',
  "",
].join("\n");

function tomlModelCount(text) {
  return text.split("\n").filter((l, n, all) => /^model\s*=/.test(l) && n < all.indexOf("[mcp_servers.x]")).length;
}

test("setModelToml no se confunde con arrays de varias líneas, comentarios con [ ni corchetes en cadenas", () => {
  const once = setModelToml(TOML_ARRAY, "uno");
  assert.equal(tomlModelCount(once), 1);
  assert.equal(getModelToml(once), "uno");
  assert.ok(once.includes('model = "tampoco"'));
  const twice = setModelToml(once, "dos");
  assert.equal(tomlModelCount(twice), 1);
  assert.equal(getModelToml(twice), "dos");
  assert.equal(setModelToml(twice, null), TOML_ARRAY);
});

test("setModelToml con un model puesto tras un array de varias líneas lo reemplaza, no lo duplica", () => {
  const text = 'name = "a"\ntools = [\n  ["x"],\n]\nmodel = "viejo"\n';
  const out = setModelToml(text, "nuevo");
  assert.equal(out.split("\n").filter((l) => /^model\s*=/.test(l)).length, 1);
  assert.equal(getModelToml(out), "nuevo");
});

test("setModelToml deja una sola clave model aunque el archivo ya tuviera dos", () => {
  const out = setModelToml('name = "a"\nmodel = "uno"\nmodel = "dos"\n', "tres");
  assert.equal(out.split("\n").filter((l) => /^model\s*=/.test(l)).length, 1);
  assert.equal(getModelToml(out), "tres");
});

// --- Lo guardado: nulos, modelos a mano y listas vacías ---

const codexDown = fake({});
const codexUp = fake({ "codex debug models": { status: "ok", stdout: codexSample } });

test("una detección fallida no guarda nulos: el siguiente apply ya propone", async () => {
  const root = projectFor("codex");
  await exec(root, ["apply"], codexDown);
  const [second] = await exec(root, ["apply"], codexUp);
  assert.equal(second.agents.find((a) => a.agent === "concept-developer").model, "gpt-5.1-codex");
  assert.equal(second.agents.find((a) => a.agent === "concept-developer").source, "propuesta");
});

test("--set x=inherit sí se guarda y se respeta", async () => {
  const root = projectFor("codex");
  await exec(root, ["apply", "--set", "create-pr=inherit"], codexUp);
  const [again] = await exec(root, ["apply"], codexUp);
  const pr = again.agents.find((a) => a.agent === "create-pr");
  assert.equal(pr.model, null);
  assert.equal(pr.source, "guardado");
});

test("tras un primer apply fallido no queda nada guardado: status dice sin configurar y detect no dice «guardado»", async () => {
  const root = projectFor("codex");
  await exec(root, ["apply"], codexDown);
  assert.match(statusLine({ profiles, root }), /^sin configurar/);
  const [d] = JSON.parse(await run(["detect", "--root", root], { run: codexDown }));
  assert.equal(d.saved, false);
});

test("status con solo algunos agentes guardados no se rompe", async () => {
  const root = projectFor("codex");
  await exec(root, ["apply", "--set", "create-pr=gpt-5.1-codex-mini"], codexDown);
  assert.match(statusLine({ profiles, root }), /^desincronizado|^configurado/);
});

test("un modelo escrito a mano que no está en la lista se mantiene en el siguiente apply", async () => {
  const root = projectFor("claude");
  await exec(root, ["apply", "--set", "concept-developer=claude-opus-4-1"], allRuns);
  const [again] = await exec(root, ["apply"], allRuns);
  const a = again.agents.find((x) => x.agent === "concept-developer");
  assert.equal(a.model, "claude-opus-4-1");
  assert.ok(again.notes.some((n) => n.includes("escrito a mano")));
  assert.equal(getModelMd(readFileSync(join(root, ".claude", "agents", "concept-developer.md"), "utf8")), "claude-opus-4-1");
});

test("un modelo propuesto que desaparece de la lista sigue reemplazándose", async () => {
  const root = projectFor("cursor");
  await exec(root, ["apply"], withModels);
  const reducido = fake({ "cursor-agent --list-models": { status: "ok", stdout: "Available models\n\ncomposer-2.5 - Composer 2.5\n" } });
  const [again] = await exec(root, ["apply"], reducido);
  assert.ok(again.agents.every((a) => a.model === null || a.model === "composer-2.5"));
});

test("una lista vacía es desconocido, no «sin modelos»", async () => {
  const [d] = await detect({ tools: ["cursor"], run: fake({ "cursor-agent --list-models": { status: "ok", stdout: "Available models\n\n" } }) });
  assert.equal(d.status, "unknown");
});
