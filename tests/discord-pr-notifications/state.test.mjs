import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activeRelations,
  decryptState,
  encryptState,
  listRelationsArtifacts,
  mergeRelations,
  markNotified,
  notificationKey,
  readRelations,
  RELATION_LIFETIME_MS,
  saveRelation,
  wasNotified,
  writeRelations,
} from '../../.github/actions/discord-pr-notifications/state.mjs';

const secret = randomBytes(32).toString('base64');
const otherSecret = randomBytes(32).toString('base64');
const repository = 'owner/repository';
const reviewerIds = [101, 202];
const discordId = '123456789012345678';

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-state-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('el fichero cifra las relaciones y autentica su contenido', (t) => {
  const file = join(temporaryDirectory(t), 'nested', 'relations.enc.json');
  const relation = { login: 'reviewer', discordId, savedAt: 1000 };
  writeRelations(file, [relation], secret, 1000);
  const encrypted = readFileSync(file, 'utf8');

  assert.doesNotMatch(encrypted, /reviewer|123456789012345678/);
  assert.ok(!encrypted.includes(secret));
  assert.deepEqual(readRelations(file, secret, 1000), [relation]);
  assert.throws(() => readRelations(file, otherSecret));

  const document = JSON.parse(encrypted);
  const bytes = Buffer.from(document.ciphertext, 'base64');
  bytes[0] ^= 1;
  document.ciphertext = bytes.toString('base64');
  writeFileSync(file, JSON.stringify(document), 'utf8');
  assert.throws(() => readRelations(file, secret));
});

test('rechaza claves y formatos corruptos sin devolver identidades', () => {
  assert.throws(() => encryptState({ version: 1 }, 'not-a-key'), /DISCORD_CACHE_KEY/);
  assert.throws(() => decryptState('{', secret), SyntaxError);
  assert.throws(() => decryptState(JSON.stringify({ version: 2 }), secret), /unknown format/);
  assert.throws(() => decryptState(JSON.stringify({ version: 1, iv: '', tag: '', ciphertext: '' }), secret), /invalid cipher header/);
  const wrongRelation = encryptState({ version: 1, relations: [{ login: 'reviewer', discordId: 'invalid', savedAt: 1 }] }, secret);
  const file = join(tmpdir(), `invalid-relations-${randomBytes(8).toString('hex')}.json`);
  try {
    writeFileSync(file, wrongRelation, 'utf8');
    assert.throws(() => readRelations(file, secret), /invalid format/);
  } finally {
    rmSync(file, { force: true });
  }
});

test('cada relación caduca exactamente a las 48 horas', () => {
  const now = RELATION_LIFETIME_MS + 1000;
  const fresh = { login: 'fresh', discordId, savedAt: 1001 };
  const boundary = { login: 'boundary', discordId, savedAt: 1000 };
  const future = { login: 'future', discordId, savedAt: now + 1 };
  assert.deepEqual(activeRelations([fresh, boundary, future], now), [fresh]);
  assert.deepEqual(saveRelation([boundary], 'boundary', discordId, now), [
    { login: 'boundary', discordId, savedAt: now },
  ]);
});

test('enumera todos los artefactos vigentes', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/repos\/owner\/repository\/actions\/artifacts\?name=discord-pr-relations&per_page=100&page=1$/);
    assert.equal(options.headers.authorization, 'Bearer test-token');
    return jsonResponse({ artifacts: [
      { id: 7, expired: false },
      { id: 9, expired: true },
      { id: 8, expired: false },
    ] });
  });
  assert.deepEqual((await listRelationsArtifacts(repository, 'test-token')).map((item) => item.id), [7, 8]);
});

test('fusiona artefactos de PR simultáneas en cualquier orden y aísla conflictos', () => {
  const first = { login: 'first', discordId, savedAt: 1000 };
  const second = { login: 'second', discordId: '223456789012345678', savedAt: 1001 };
  for (const groups of [[[first], [second]], [[second], [first]]]) {
    assert.deepEqual(mergeRelations(groups, 1002).relations.map((item) => item.login).sort(), ['first', 'second']);
  }
  const conflict = { ...first, discordId: '323456789012345678' };
  assert.deepEqual(mergeRelations([[first], [second, conflict]], 1002), {
    relations: [second], conflicts: ['first'],
  });
});

test('la clave de aviso usa el conjunto de revisores sin depender del orden', () => {
  const key = notificationKey(repository, 40, reviewerIds);
  assert.match(key, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(notificationKey(repository, 40, [...reviewerIds].reverse()), key);
  assert.notEqual(notificationKey(repository, 41, reviewerIds), key);
  assert.notEqual(notificationKey('other/repository', 40, reviewerIds), key);
  assert.notEqual(notificationKey(repository, 40, [101, 303]), key);
  const threeReviewers = notificationKey(repository, 40, [101, 202, 303]);
  assert.equal(notificationKey(repository, 40, [303, 101, 202]), threeReviewers);
  assert.notEqual(threeReviewers, key);
  assert.throws(() => notificationKey(repository, 40, [101, 101]), /invalid/);
  assert.throws(() => notificationKey(repository, 40, [101, 202, 101]), /invalid/);
});

test('el registro cifrado por PR sobrevive a eventos repetidos', async (t) => {
  const comments = [];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET' });
    if (url.endsWith('/issues/40/comments?per_page=100&page=1')) return jsonResponse(comments);
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      const comment = { id: 77, body: JSON.parse(options.body).body };
      comments.push(comment);
      return jsonResponse(comment, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  assert.equal(await wasNotified(repository, 40, reviewerIds, 'test-token', secret), false);
  await markNotified(repository, 40, reviewerIds, 'test-token', secret);
  assert.equal(await wasNotified(repository, 40, [...reviewerIds].reverse(), 'test-token', secret), true);
  await markNotified(repository, 40, reviewerIds, 'test-token', secret);
  assert.equal(requests.filter((request) => request.method === 'POST').length, 1);
  assert.doesNotMatch(comments[0].body, /owner\/repository|101|202/);
});

test('el registro de una PR no marca otra y detecta contenido manipulado', async (t) => {
  const comments = new Map();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const match = url.match(/\/issues\/(40|41)\/comments\?per_page=100&page=1$/);
    if (match) return jsonResponse(comments.get(Number(match[1])) ?? []);
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.set(40, [{ id: 77, body: JSON.parse(options.body).body }]);
      return jsonResponse({ id: 77 }, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  await markNotified(repository, 40, reviewerIds, 'test-token', secret);
  assert.equal(await wasNotified(repository, 41, reviewerIds, 'test-token', secret), false);
  comments.get(40)[0].body += 'tampered';
  await assert.rejects(wasNotified(repository, 40, reviewerIds, 'test-token', secret));
});

test('actualiza un registro existente sin perder la primera pareja', async (t) => {
  const comments = [];
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    methods.push(options.method ?? 'GET');
    if (url.endsWith('/issues/40/comments?per_page=100&page=1')) return jsonResponse(comments);
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return jsonResponse({ id: 77 }, 201);
    }
    if (url.endsWith('/issues/comments/77') && options.method === 'PATCH') {
      comments[0].body = JSON.parse(options.body).body;
      return jsonResponse({ id: 77 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  await markNotified(repository, 40, [101, 202], 'test-token', secret);
  await markNotified(repository, 40, [101, 303], 'test-token', secret);
  assert.equal(await wasNotified(repository, 40, [101, 202], 'test-token', secret), true);
  assert.equal(await wasNotified(repository, 40, [101, 303], 'test-token', secret), true);
  assert.deepEqual(methods.filter((method) => method !== 'GET'), ['POST', 'PATCH']);
});

test('un fallo al escribir el registro no se interpreta como aviso registrado', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/issues/40/comments?per_page=100&page=1')) return jsonResponse([]);
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      return jsonResponse({ error: 'unavailable' }, 503);
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  await assert.rejects(markNotified(repository, 40, reviewerIds, 'test-token', secret), /HTTP 503/);
  assert.equal(await wasNotified(repository, 40, reviewerIds, 'test-token', secret), false);
});
