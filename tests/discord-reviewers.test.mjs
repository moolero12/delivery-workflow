import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildMappingComment, parseDiscordIdentity, RELATION_LIFETIME_MS, runCommand,
} from '../.apm/skills/discord-reviewers/scripts/discord-reviewers.mjs';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-reviewers-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  let comments = [];
  const githubApi = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    if (endpoint.endsWith('/pulls/40')) return { number: 40, state: 'open' };
    if (endpoint.includes('/comments?')) return comments;
    if (method === 'POST') {
      comments = [...comments, { id: 3, user: { login: 'tester' }, body: body.body }];
      return comments.at(-1);
    }
    if (method === 'PATCH') {
      comments[0].body = body.body;
      return comments[0];
    }
    throw new Error(`Unexpected request ${endpoint}`);
  };
  const cachePath = join(directory, '.git-discord-reviewers-cache.json');
  const run = (args, options = {}) => runCommand(args, {
    cachePath, host: 'github.com', account: options.account ?? 'tester',
    now: options.now ?? 1000, githubApi,
  });
  return { run, calls, cachePath, getComments: () => comments };
}

test('acepta un usuario, una mención o un ID de Discord', () => {
  assert.deepEqual(parseDiscordIdentity('Diego_Molero_'), { type: 'name', value: 'Diego_Molero_' });
  assert.deepEqual(parseDiscordIdentity('<@!123456789012345678>'), { type: 'id', value: '123456789012345678' });
  assert.throws(() => parseDiscordIdentity('@everyone\n'), /válidos/);
});

test('la caché local aísla cuentas y caduca a las 48 horas', async (t) => {
  const { run, cachePath } = setup(t);
  await run(['set', 'owner/repo', 'Alice', 'Diego_Molero_']);
  assert.equal((await run(['get', 'owner/repo', 'alice'])).relations[0].discord.value, 'Diego_Molero_');
  assert.equal((await run(['get', 'owner/repo', 'alice'], { account: 'other' })).relations[0].discord, null);
  assert.equal((await run(['get', 'owner/other', 'alice'])).relations[0].discord, null);
  assert.equal((await run(['get', 'owner/repo', 'alice'], { now: 1000 + RELATION_LIFETIME_MS })).relations[0].discord, null);
  assert.doesNotMatch(readFileSync(cachePath, 'utf8'), /GITHUB_TOKEN|DISCORD_BOT_TOKEN/);
});

test('no sobrescribe una relación sin corrección explícita', async (t) => {
  const { run } = setup(t);
  await run(['set', 'owner/repo', 'alice', 'Diego_Molero_']);
  await assert.rejects(run(['set', 'owner/repo', 'alice', 'other']), /--replace/);
  await run(['set', 'owner/repo', 'alice', 'other', '--replace']);
  assert.equal((await run(['get', 'owner/repo', 'alice'])).relations[0].discord.value, 'other');
});

test('publica el comentario técnico antes de pedir revisión y lo actualiza sin duplicarlo', async (t) => {
  const { run, calls, getComments } = setup(t);
  await run(['set', 'owner/repo', 'alice', 'Diego_Molero_']);
  await assert.rejects(run(['publish', 'owner/repo', '40', 'alice']), /al menos dos/);
  await run(['set', 'owner/repo', 'bob', '<@223456789012345678>']);
  assert.deepEqual(await run(['publish', 'owner/repo', '40', 'alice', 'bob']), {
    prNumber: 40, published: 2, updated: false,
  });
  assert.equal(getComments().length, 1);
  assert.equal(JSON.parse(getComments()[0].body.split('\n')[1]).mappings[0].discord.value, 'Diego_Molero_');
  assert.equal((await run(['publish', 'owner/repo', '40', 'alice', 'bob'])).updated, true);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
});

test('el comentario solo contiene las relaciones confirmadas', () => {
  const body = buildMappingComment('owner/repo', 40, [
    { github: 'alice', discord: { type: 'name', value: 'Diego_Molero_' } },
    { github: 'bob', discord: { type: 'id', value: '223456789012345678' } },
  ]);
  assert.match(body, /^<!-- discord-pr-reviewer-map:v1 -->/);
  assert.doesNotMatch(body, /bot-token|cache-key/);
  assert.throws(() => buildMappingComment('owner/repo', 40, [
    { github: 'alice', discord: { type: 'name', value: 'first' } },
    { github: 'Alice', discord: { type: 'name', value: 'second' } },
  ]), /no son válidas/);
});
