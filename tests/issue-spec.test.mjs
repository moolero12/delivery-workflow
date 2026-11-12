import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBody, hashTop, replaceSections, tickTask, setState, findSecret, run, MAX_BODY,
  isRevisionComment, latestRevision, nextRevisionNumber, ensureRevisionHeader, formatReviewNotes,
} from "../.apm/skills/issue-spec/scripts/issue-spec.mjs";

const TOP = "## Qué hay que hacer\n\nAlgo.\n\n## Cómo probarlo\n\n1. Mirar.\n\nRevisan: Ada";
const BODY = `${TOP}\n\n## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-07 · Aprobada: —\n\n### Metadata\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n- [ ] **TASK-10:** Diez\n`;

test("la parte de arriba es lo anterior a las tres secciones", () => {
  const parsed = parseBody(BODY);
  assert.equal(parsed.top, TOP);
  assert.ok(parsed.sections.spec.startsWith("> Estado"));
  assert.equal(parsed.sections.plan, undefined);
});

test("escribir el plan conserva la spec, las tasks y la parte de arriba", () => {
  const next = replaceSections(BODY, { plan: "## Plan\n\n### Diseño técnico\n\nX" }, hashTop(TOP));
  const parsed = parseBody(next);
  assert.equal(parsed.top, TOP);
  assert.equal(parsed.sections.plan, "### Diseño técnico\n\nX");
  assert.ok(parsed.sections.tasks.includes("TASK-10"));
  assert.ok(next.indexOf("## Spec") < next.indexOf("## Plan") && next.indexOf("## Plan") < next.indexOf("## Tasks"));
});

test("si la parte de arriba cambió, no se escribe y sale con 3", () => {
  const edited = BODY.replace("Algo.", "Otra cosa.");
  assert.throws(() => replaceSections(edited, { plan: "X" }, hashTop(TOP)), { code: 3 });
});

test("sin huella no se escribe", () => {
  assert.throws(() => replaceSections(BODY, { plan: "X" }), { code: 1 });
});

test("un secreto bloquea la escritura sin mostrar el valor", () => {
  const token = `ghp_${"a".repeat(36)}`;
  assert.equal(findSecret(`token ${token}`), "token de GitHub");
  assert.throws(() => replaceSections(BODY, { plan: `usa ${token}` }, hashTop(TOP)), (error) => error.code === 4 && !error.message.includes(token));
});

test("un cuerpo de más de 65 536 caracteres sale con 5", () => {
  assert.throws(() => replaceSections(BODY, { plan: "x".repeat(MAX_BODY) }, hashTop(TOP)), { code: 5 });
});

test("tick marca solo la task pedida, no la que empieza igual", () => {
  const next = tickTask(BODY, "TASK-01", hashTop(TOP));
  assert.ok(next.includes("- [x] **TASK-01:**"));
  assert.ok(next.includes("- [ ] **TASK-10:**"));
  assert.equal(tickTask(next, "TASK-01", hashTop(TOP)), null);
  assert.throws(() => tickTask(BODY, "TASK-02", hashTop(TOP)), { code: 1 });
});

test("state cambia la línea Estado con la fecha", () => {
  const next = setState(BODY, "Implementada", "2026-11-08", hashTop(TOP));
  assert.ok(next.includes("> Estado: **Implementada (2026-11-08)** · Creada: 2026-11-07"));
  assert.throws(() => setState(BODY, "Aprobada", "2026-11-08", hashTop(TOP)), { code: 1 });
});

test("run write lee, sustituye y escribe con gh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-test-"));
  const plan = join(dir, "plan.md");
  await writeFile(plan, "## Plan\n\nNuevo");
  const calls = [];
  let written;
  const call = async (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ body: BODY });
    if (args[1] === "edit") {
      const { readFile } = await import("node:fs/promises");
      written = await readFile(args[args.indexOf("--body-file") + 1], "utf8");
    }
    return "";
  };
  const output = await run(["write", "7", "--expect-top", hashTop(TOP), "--plan", plan], { run: call });
  assert.match(output, /plan escritas/);
  assert.deepEqual(calls[0], ["issue", "view", "7", "--json", "body"]);
  assert.equal(parseBody(written).sections.plan, "Nuevo");
  assert.equal(parseBody(written).top, TOP);
});

test("run read --section devuelve una sección", async () => {
  const call = async () => JSON.stringify({ body: BODY });
  assert.equal(await run(["read", "7", "--section", "top"], { run: call }), TOP);
  assert.equal(await run(["top-hash", "7"], { run: call }), hashTop(TOP));
});

const REV_TOP = "<!-- Revisión 1 -->";
const REV_BODY = `${REV_TOP}\n\n## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-11 · Aprobada: —\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n`;

test("un comentario de revisión se reconoce por la primera línea", () => {
  assert.equal(isRevisionComment(REV_BODY), true);
  assert.equal(isRevisionComment(BODY), false);
  assert.equal(nextRevisionNumber([{ body: REV_BODY }]), 2);
  assert.equal(latestRevision([{ body: BODY }, { body: REV_BODY, id: 9 }]).id, 9);
});

test("ensureRevisionHeader no duplica la marca", () => {
  assert.match(ensureRevisionHeader("## Spec\n\nHola", 1), /^<!-- Revisión 1 -->/);
  assert.equal(ensureRevisionHeader(REV_BODY, 9).startsWith(REV_TOP), true);
});

test("tick en un comentario de revisión no usa el cuerpo de la issue", () => {
  const next = tickTask(REV_BODY, "TASK-01", hashTop(REV_TOP));
  assert.ok(next.includes("- [x] **TASK-01:**"));
  assert.ok(next.startsWith(REV_TOP));
  assert.throws(() => tickTask(REV_BODY, "TASK-01", hashTop(TOP)), { code: 3 });
});

test("formatReviewNotes junta reviews y comentarios de línea", () => {
  const text = formatReviewNotes({
    reviewDecision: "CHANGES_REQUESTED",
    reviews: [{ author: { login: "ada" }, state: "CHANGES_REQUESTED", body: "Cambia el nombre." }],
    lineComments: [{ user: { login: "ada" }, path: "src/a.js", line: 3, body: "aquí" }],
  });
  assert.match(text, /CHANGES_REQUESTED/);
  assert.match(text, /Cambia el nombre/);
  assert.match(text, /src\/a.js:3/);
});

test("run write --revision parchea el comentario y no el cuerpo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-rev-"));
  const plan = join(dir, "plan.md");
  await writeFile(plan, "## Plan\n\nNuevo");
  const calls = [];
  let patched;
  const call = async (args) => {
    calls.push(args);
    if (args[0] === "api" && String(args[1]).includes("/comments") && !String(args[1]).includes("/comments/")) {
      return JSON.stringify([{ id: 44, body: REV_BODY }]);
    }
    if (args[0] === "api" && args.includes("PATCH")) {
      const { readFile } = await import("node:fs/promises");
      patched = JSON.parse(await readFile(args[args.indexOf("--input") + 1], "utf8")).body;
      return "{}";
    }
    return "";
  };
  const output = await run(
    ["write", "7", "--expect-top", hashTop(REV_TOP), "--revision", "--plan", plan],
    { run: call },
  );
  assert.match(output, /plan escritas/);
  assert.equal(parseBody(patched).sections.plan, "Nuevo");
  assert.equal(parseBody(patched).top, REV_TOP);
  assert.ok(!calls.some((args) => args[1] === "edit"));
});

test("run revision publica el comentario con la marca", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-rev2-"));
  const file = join(dir, "rev.md");
  await writeFile(file, "## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-11 · Aprobada: —\n");
  let posted;
  const call = async (args) => {
    if (args[0] === "api") return "[]";
    if (args[1] === "comment") {
      const { readFile } = await import("node:fs/promises");
      posted = await readFile(args[args.indexOf("--body-file") + 1], "utf8");
      return "";
    }
    return "";
  };
  const output = await run(["revision", "7", file], { run: call });
  assert.match(output, /revisión 1 publicada/);
  assert.match(output, /Huella:/);
  assert.ok(posted.startsWith("<!-- Revisión 1 -->"));
});
