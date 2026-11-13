#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const GH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'github-cache', 'scripts', 'gh.sh');
const CACHE_NAME = '.git-discord-reviewers-cache.json';
const COMMENT_MARKER = '<!-- discord-pr-reviewer-map:v1 -->';
export const RELATION_LIFETIME_MS = 48 * 60 * 60 * 1000;
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

export function parseDiscordIdentity(input) {
  if (/[\r\n\t\u0000-\u001f]/.test(String(input ?? ''))) {
    throw new Error('Indica un nombre de Discord o una mención/ID válidos.');
  }
  const value = String(input ?? '').trim();
  const mention = value.match(/^<@!?(\d{17,20})>$/);
  if (mention) return { type: 'id', value: mention[1] };
  if (/^\d{17,20}$/.test(value)) return { type: 'id', value };
  const name = value.startsWith('@') ? value.slice(1) : value;
  if (!name || name.length > 64 || /[<>\r\n\t\u0000-\u001f]/.test(name) ||
      /^(everyone|here)$/i.test(name)) {
    throw new Error('Indica un nombre de Discord o una mención/ID válidos.');
  }
  return { type: 'name', value: name };
}

function validEntry(entry, now) {
  return entry && Number.isSafeInteger(entry.savedAt) && entry.savedAt <= now &&
    now - entry.savedAt < RELATION_LIFETIME_MS &&
    (entry.identity?.type === 'name' || entry.identity?.type === 'id') &&
    JSON.stringify(parseDiscordIdentity(entry.identity.value)) === JSON.stringify(entry.identity);
}

function activeCache(document, now) {
  if (document?.version !== 1 || !document.contexts || typeof document.contexts !== 'object' ||
      Array.isArray(document.contexts)) return { version: 1, contexts: {} };
  const contexts = {};
  for (const [key, entries] of Object.entries(document.contexts)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    contexts[key] = {};
    for (const [login, entry] of Object.entries(entries)) {
      try {
        if (LOGIN.test(login) && validEntry(entry, now)) contexts[key][login] = entry;
      } catch { /* Una entrada corrupta se descarta sin perder las demás. */ }
    }
  }
  return { version: 1, contexts };
}

async function withLock(cachePath, work) {
  const lockPath = `${cachePath}.lock`;
  let lock;
  const deadline = Date.now() + 2000;
  while (!lock && Date.now() < deadline) {
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await delay(40);
    }
  }
  if (!lock) throw new Error('La caché de Discord está ocupada. Repite el comando.');
  try { return await work(); }
  finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function saveCache(cachePath, cache) {
  const temporary = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, cachePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function buildMappingComment(repository, prNumber, mappings) {
  if (!REPOSITORY.test(repository) || !Number.isSafeInteger(prNumber) || prNumber < 1 ||
      !Array.isArray(mappings) || mappings.length < 2 ||
      new Set(mappings.map((mapping) => mapping.github?.toLowerCase())).size !== mappings.length ||
      mappings.some((mapping) => !mapping || !LOGIN.test(mapping.github) || !mapping.discord ||
        JSON.stringify(parseDiscordIdentity(mapping.discord.value)) !== JSON.stringify(mapping.discord))) {
    throw new Error('Las relaciones para la PR no son válidas.');
  }
  // El comentario lleva nombres o IDs confirmados, nunca el token ni la clave cifrada.
  return `${COMMENT_MARKER}\n${JSON.stringify({ version: 1, repository, prNumber, mappings })}`;
}

export async function runCommand(args, { cachePath, host, account, now = Date.now(), githubApi }) {
  const [command, repositoryInput, ...input] = args;
  const repository = repositoryInput?.toLowerCase();
  if (!REPOSITORY.test(repository ?? '') || !LOGIN.test(account ?? '') ||
      !/^[a-z\d.-]+$/i.test(host ?? '')) throw new Error('Indica servidor, cuenta y OWNER/REPO válidos.');
  if (!['get', 'set', 'remove', 'publish'].includes(command)) throw new Error('Comando de Discord desconocido.');
  return withLock(cachePath, async () => {
    let stored;
    try { stored = JSON.parse(await readFile(cachePath, 'utf8')); } catch { stored = null; }
    const cache = activeCache(stored, now);
    const contextKey = JSON.stringify([host.toLowerCase(), account.toLowerCase(), repository]);
    const entries = cache.contexts[contextKey] ?? {};
    cache.contexts[contextKey] = entries;
    let result;
    if (command === 'get') {
      if (!input.length || input.some((login) => !LOGIN.test(login))) throw new Error('Indica al menos un login de GitHub.');
      result = { relations: input.map((login) => ({ github: login, discord: entries[login.toLowerCase()]?.identity ?? null })) };
    } else if (command === 'set') {
      const [login, discord, replace] = input;
      if (!LOGIN.test(login ?? '') || !discord || (replace && replace !== '--replace') || input.length > 3) {
        throw new Error('Uso: set OWNER/REPO LOGIN IDENTIDAD [--replace].');
      }
      const key = login.toLowerCase();
      const identity = parseDiscordIdentity(discord);
      if (entries[key] && JSON.stringify(entries[key].identity) !== JSON.stringify(identity) && replace !== '--replace') {
        throw new Error('Usa --replace para corregir una relación vigente.');
      }
      entries[key] = { identity, savedAt: now };
      result = { github: key, discord: identity };
    } else if (command === 'remove') {
      if (input.length !== 1 || !LOGIN.test(input[0])) throw new Error('Uso: remove OWNER/REPO LOGIN.');
      const key = input[0].toLowerCase();
      result = { github: key, removed: Boolean(entries[key]) };
      delete entries[key];
    } else {
      const [prText, ...logins] = input;
      const prNumber = Number(prText);
      if (!/^[1-9]\d{0,9}$/.test(prText ?? '') || !logins.length || logins.some((login) => !LOGIN.test(login))) {
        throw new Error('Uso: publish OWNER/REPO NUMERO_PR LOGIN...');
      }
      const mappings = [...new Set(logins.map((login) => login.toLowerCase()))]
        .filter((login) => entries[login])
        .map((github) => ({ github, discord: entries[github].identity }));
      if (mappings.length < 2) throw new Error('Confirma al menos dos identidades antes de pedir revisión.');
      const pr = await githubApi('GET', `repos/${repository}/pulls/${prNumber}`);
      if (pr?.number !== prNumber || pr.state !== 'open') throw new Error('La PR no está abierta.');
      const body = buildMappingComment(repository, prNumber, mappings);
      const comments = [];
      for (let page = 1; page <= 20; page += 1) {
        const batch = await githubApi('GET', `repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw new Error('No se pudieron leer los comentarios de la PR.');
        comments.push(...batch);
        if (batch.length < 100) break;
        if (page === 20) throw new Error('La PR tiene demasiados comentarios para actualizar la confirmación con seguridad.');
      }
      const existing = comments.reverse().find((comment) => comment.user?.login?.toLowerCase() === account.toLowerCase() &&
        comment.body?.startsWith(COMMENT_MARKER));
      const endpoint = existing ? `repos/${repository}/issues/comments/${existing.id}` :
        `repos/${repository}/issues/${prNumber}/comments`;
      await githubApi(existing ? 'PATCH' : 'POST', endpoint, { body });
      result = { prNumber, published: mappings.length, updated: Boolean(existing) };
    }
    await saveCache(cachePath, cache);
    return result;
  });
}

async function main() {
  const { stdout } = await exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const githubApi = async (method, endpoint, body) => {
    const args = [GH, 'api', endpoint, '--hostname', process.env.GH_HOST || 'github.com', '--method', method];
    if (body) args.push('--field', `body=${body.body}`);
    const response = await exec('bash', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(response.stdout);
  };
  const user = await githubApi('GET', 'user');
  const result = await runCommand(process.argv.slice(2), {
    cachePath: join(stdout.trim(), CACHE_NAME), host: process.env.GH_HOST || 'github.com',
    account: user.login, githubApi,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message || 'No se pudo gestionar la caché de Discord.');
    process.exitCode = 1;
  });
}
