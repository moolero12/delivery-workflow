import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMessage, notifyReviewers, resolveReviewers } from '../../.github/actions/discord-pr-notifications/notify.mjs';
import { readRelations, writeRelations } from '../../.github/actions/discord-pr-notifications/state.mjs';

const secret = randomBytes(32).toString('base64');
const aliceId = '123456789012345678';
const bobId = '223456789012345678';
const carolId = '323456789012345678';
const reviewers = [{ login: 'alice', id: 101 }, { login: 'bob', id: 202 }];

function mappingComment(login, discordId) {
  return {
    id: 50, user: { id: 77 }, author_association: 'CONTRIBUTOR',
    updated_at: new Date().toISOString(),
    body: `/discord-map ${login} ${discordId}`,
  };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-notify-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const previousRepository = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  t.after(() => {
    if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previousRepository;
  });
  const file = join(directory, 'relations.enc.json');
  writeRelations(file, [], secret);
  const config = {
    repository: 'owner/repo', baseBranch: 'staging', number: 40, githubToken: 'github-token',
    botToken: 'bot-token', cacheKey: secret, guildId: '111111111111111111',
    channelId: '222222222222222222', relationsFile: file,
  };
  const pr = {
    number: 40, state: 'open', draft: false, title: 'Add attendance view',
    user: { id: 77 },
    body: 'A brief description of the change.', requested_reviewers: reviewers,
    base: { ref: 'staging', repo: { full_name: 'owner/repo' } },
  };
  return { config, file, pr };
}

test('consulta primero la caché y busca solo las identidades ausentes', async () => {
  const now = Date.now();
  const relations = [{ login: 'alice', discordId: aliceId, savedAt: now }];
  const searched = [];
  const result = await resolveReviewers(reviewers, relations, async (login) => {
    searched.push(login);
    return login === 'alice' ? [{ user: { username: 'alice', id: aliceId } }] :
      [{ user: { username: 'bob', id: bobId } }];
  }, now);
  assert.deepEqual(searched, ['bob']);
  assert.deepEqual(result.ids, [aliceId, bobId]);
  assert.deepEqual(result.problems, []);
});

test('rechaza coincidencias parciales, ambiguas y dos logins con el mismo ID', async () => {
  const partial = await resolveReviewers(reviewers, [], async (login) =>
    login === 'alice' ? [{ user: { username: 'alice2', id: aliceId } }] :
      [{ user: { username: 'bob', id: bobId } }]);
  assert.ok(partial.problems.some((item) => item.includes('alice')));
  const ambiguous = await resolveReviewers(reviewers, [], async (login) =>
    login === 'alice' ? [
      { user: { username: 'alice', id: aliceId } },
      { user: { username: 'alice', id: bobId } },
    ] : [{ user: { username: 'bob', id: bobId } }]);
  assert.ok(ambiguous.problems.some((item) => item.includes('unique')));
  const same = await resolveReviewers(reviewers, [], async (login) =>
    [{ user: { username: login, id: aliceId } }]);
  assert.ok(same.problems.some((item) => item.includes('same Discord user')));
});

test('comprueba que el ID confirmado pertenece al servidor y no acepta apodos ambiguos', async () => {
  const now = Date.now();
  const confirmations = new Map([
    ['alice', { identity: { type: 'id', value: aliceId }, confirmedAt: now }],
    ['bob', { identity: { type: 'name', value: 'Bob del servidor' }, confirmedAt: now }],
  ]);
  const found = await resolveReviewers(reviewers, [], async () => [
    { nick: 'Bob del servidor', user: { username: 'first', id: bobId } },
    { nick: 'Bob del servidor', user: { username: 'second', id: carolId } },
  ], now, confirmations, async (id) => ({ user: { id } }));
  assert.deepEqual(found.resolvedReviewers.map((reviewer) => reviewer.login), ['alice']);
  assert.ok(found.problems.some((problem) => problem.includes('bob')));

  const absent = await resolveReviewers(reviewers, [], async () => [], now, confirmations,
    async () => null);
  assert.equal(absent.resolvedReviewers.length, 0);
});

test('la relación confirmada caduca desde el comentario y no desde cada ejecución', async () => {
  const now = Date.now();
  const confirmedAt = now - 60_000;
  const confirmations = new Map([['alice', {
    identity: { type: 'id', value: aliceId }, confirmedAt,
  }]]);
  const result = await resolveReviewers([reviewers[0]], [], async () => [], now,
    confirmations, async (id) => ({ user: { id } }));
  assert.equal(result.relations[0].savedAt, confirmedAt);
});

test('no elige entre un usuario y el apodo exacto de otra persona', async () => {
  const confirmations = new Map([['alice', {
    identity: { type: 'name', value: 'diego' }, confirmedAt: Date.now(),
  }]]);
  const result = await resolveReviewers([reviewers[0]], [], async () => [
    { user: { username: 'diego', id: aliceId } },
    { nick: 'diego', user: { username: 'other', id: bobId } },
  ], Date.now(), confirmations);
  assert.equal(result.resolvedReviewers.length, 0);
  assert.match(result.problems[0], /not a unique/);
});

test('el mensaje contiene resumen y enlace sin menciones suministradas por la PR', () => {
  const message = buildMessage('owner/repo', {
    number: 40, title: '@everyone **New**', body: 'Please <@999999999999999999> review',
  }, [{ login: 'alice', discordId: aliceId }, { login: 'bob', discordId: bobId }]);
  assert.match(message, /^\*\*Repositorio: owner\/repo\*\*\n/);
  assert.match(message, /New/);
  assert.match(message, /https:\/\/github\.com\/owner\/repo\/pull\/40/);
  assert.match(message, new RegExp(`<@${aliceId}>.*<@${bobId}>`));
  assert.doesNotMatch(message, /@everyone|<@999999999999999999>/);
});

test('la cabecera muestra el repositorio verificado y todos los revisores', () => {
  const pr = { number: 42, title: 'Review this', body: 'Brief summary' };
  const message = buildMessage('venturars/delivery-workflow', pr, [
    { login: 'alice', discordId: aliceId }, { login: 'bob', discordId: bobId },
    { login: 'carol', discordId: carolId },
  ]);
  assert.match(message, /^\*\*Repositorio: venturars\/delivery-workflow\*\*/);
  assert.match(message, new RegExp(`<@${aliceId}>.*<@${bobId}>.*<@${carolId}>`));
});

test('publica para tres revisores y no duplica el mismo conjunto reordenado', async (t) => {
  const { config, pr } = setup(t);
  pr.requested_reviewers = [...reviewers, { login: 'carol', id: 303 }];
  const comments = [];
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      const id = { alice: aliceId, bob: bobId, carol: carolId }[login];
      return response([{ user: { username: login, id } }]);
    }
    if (url.endsWith('/channels/222222222222222222/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments[0], 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  pr.requested_reviewers = [pr.requested_reviewers[2], ...reviewers];
  assert.equal(await notifyReviewers(config), 'already-notified');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].allowed_mentions, { parse: [], users: [aliceId, bobId, carolId] });
  assert.deepEqual(readRelations(config.relationsFile, secret).map((item) => item.login), ['alice', 'bob', 'carol']);
});

test('publica con dos identidades verificadas aunque un tercer revisor siga pendiente', async (t) => {
  const { config, pr } = setup(t);
  pr.requested_reviewers = [...reviewers, { login: 'carol', id: 303 }];
  const posts = [];
  const comments = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      const id = { alice: aliceId, bob: bobId }[login];
      return response(id ? [{ user: { username: login, id } }] : []);
    }
    if (url.includes('/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments[0], 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].allowed_mentions.users, [aliceId, bobId]);
  assert.match(posts[0].content, /carol \(sin mención de Discord\)/);
});

test('acepta comandos con IDs distintos y avisa después solo al tercero nuevo', async (t) => {
  const { config, pr } = setup(t);
  pr.requested_reviewers = [...reviewers, { login: 'carol', id: 303 }];
  const comments = [mappingComment('alice', aliceId), mappingComment('bob', bobId)];
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.includes('/guilds/111111111111111111/members/') && !url.includes('/search?')) {
      const id = url.split('/').at(-1);
      return response({ user: { id } });
    }
    if (url.includes('/members/search?')) {
      const query = new URL(url).searchParams.get('query');
      const id = { diego_molero_: aliceId, bob_discord: bobId, carol_discord: carolId }[query];
      return response(id ? [{ user: { username: query, id } }] : []);
    }
    if (url.endsWith('/channels/222222222222222222/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments.at(-1), 201);
    }
    if (url.endsWith('/issues/comments/77') && options.method === 'PATCH') {
      comments.at(-1).body = JSON.parse(options.body).body;
      return response(comments.at(-1));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  assert.deepEqual(posts[0].allowed_mentions.users, [aliceId, bobId]);
  comments.unshift(mappingComment('carol', carolId));
  assert.equal(await notifyReviewers(config), 'notified');
  assert.deepEqual(posts[1].allowed_mentions.users, [carolId]);
  assert.match(posts[1].content, /Nuevos revisores o menciones:\*\* <@323456789012345678>/);
  assert.equal(await notifyReviewers(config), 'already-notified');
  assert.equal(posts.length, 2);
});

test('publica una vez con las dos menciones y registra el aviso tras Discord', async (t) => {
  const { config, pr } = setup(t);
  const comments = [];
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      return response([{ user: { username: login, id: login === 'alice' ? aliceId : bobId } }]);
    }
    if (url.endsWith('/channels/222222222222222222/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' }, 200);
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments[0], 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  assert.equal(await notifyReviewers(config), 'already-notified');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].allowed_mentions, { parse: [], users: [aliceId, bobId] });
  assert.deepEqual(readRelations(config.relationsFile, secret).map((item) => item.login), ['alice', 'bob']);
});

test('si falta una identidad conserva la otra y publica sin mencionar la ausente', async (t) => {
  const { config, pr } = setup(t);
  const comments = [];
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      return response(login === 'alice' ? [{ user: { username: 'alice', id: aliceId } }] : []);
    }
    if (url.includes('/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments[0], 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  assert.equal(await notifyReviewers(config), 'already-notified');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].allowed_mentions.users, [aliceId]);
  assert.match(posts[0].content, /bob \(sin mención de Discord\)/);
  assert.deepEqual(readRelations(config.relationsFile, secret).map((item) => item.login), ['alice']);
});

test('publica sin menciones y avisa a un revisor confirmado más tarde', async (t) => {
  const { config, pr } = setup(t);
  const comments = [];
  const posts = [];
  let relationAvailable = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.endsWith(`/guilds/111111111111111111/members/${aliceId}`)) {
      return relationAvailable ? response({ user: { id: aliceId } }) : response({}, 404);
    }
    if (url.includes('/members/search?')) {
      const query = new URL(url).searchParams.get('query');
      return response(relationAvailable && query === 'diego_molero_' ?
        [{ user: { username: query, id: aliceId } }] : []);
    }
    if (url.includes('/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments.at(-1), 201);
    }
    if (url.endsWith('/issues/comments/77') && options.method === 'PATCH') {
      comments.at(-1).body = JSON.parse(options.body).body;
      return response(comments.at(-1));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  assert.deepEqual(posts[0].allowed_mentions.users, []);
  assert.match(posts[0].content, /alice \(sin mención de Discord\).*bob \(sin mención de Discord\)/);
  assert.equal(await notifyReviewers(config), 'already-notified');
  comments.unshift(mappingComment('outsider', aliceId));
  assert.equal(await notifyReviewers(config), 'already-notified');
  comments.unshift(mappingComment('alice', aliceId));
  assert.equal(await notifyReviewers(config), 'already-notified');
  relationAvailable = true;
  assert.equal(await notifyReviewers(config), 'notified');
  assert.deepEqual(posts[1].allowed_mentions.users, [aliceId]);
  assert.notEqual(posts[0].nonce, posts[1].nonce);
  assert.equal(await notifyReviewers(config), 'already-notified');
  assert.equal(posts.length, 2);
});

test('muestra un nuevo revisor sin Discord y luego le menciona al confirmarlo', async (t) => {
  const { config, pr } = setup(t);
  const comments = [];
  const posts = [];
  let confirmed = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response(comments);
    if (url.endsWith(`/guilds/111111111111111111/members/${carolId}`)) {
      return confirmed ? response({ user: { id: carolId } }) : response({}, 404);
    }
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      const id = { alice: aliceId, bob: bobId, carol_discord: carolId }[login];
      return response(id && (login !== 'carol_discord' || confirmed) ?
        [{ user: { username: login, id } }] : []);
    }
    if (url.includes('/messages')) {
      posts.push(JSON.parse(options.body));
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      comments.push({ id: 77, body: JSON.parse(options.body).body });
      return response(comments.at(-1), 201);
    }
    if (url.endsWith('/issues/comments/77') && options.method === 'PATCH') {
      comments.at(-1).body = JSON.parse(options.body).body;
      return response(comments.at(-1));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.equal(await notifyReviewers(config), 'notified');
  pr.requested_reviewers = [...reviewers, { login: 'carol', id: 303 }];
  assert.equal(await notifyReviewers(config), 'notified');
  assert.deepEqual(posts[1].allowed_mentions.users, []);
  assert.match(posts[1].content, /carol \(sin mención de Discord\)/);
  comments.unshift(mappingComment('carol', carolId));
  confirmed = true;
  assert.equal(await notifyReviewers(config), 'notified');
  assert.deepEqual(posts[2].allowed_mentions.users, [carolId]);
  assert.notEqual(posts[1].nonce, posts[2].nonce);
  assert.equal(await notifyReviewers(config), 'already-notified');
});

test('un error de Discord no registra el aviso y permite otro intento', async (t) => {
  const { config, pr } = setup(t);
  let commentsWritten = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response([]);
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      return response([{ user: { username: login, id: login === 'alice' ? aliceId : bobId } }]);
    }
    if (url.includes('/messages')) return response({ error: 'unavailable' }, 503);
    if (options?.method === 'POST') commentsWritten += 1;
    throw new Error(`Unexpected request: ${url}`);
  });
  await assert.rejects(notifyReviewers(config), /HTTP 503/);
  assert.equal(commentsWritten, 0);
  assert.deepEqual(readRelations(config.relationsFile, secret).map((item) => item.login), ['alice', 'bob']);
});

test('avisa del estado incierto si Discord acepta pero falla el registro', async (t) => {
  const { config, pr } = setup(t);
  let messages = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/pulls/40')) return response(pr);
    if (url.includes('/issues/40/comments?')) return response([]);
    if (url.includes('/members/search?')) {
      const login = new URL(url).searchParams.get('query');
      return response([{ user: { username: login, id: login === 'alice' ? aliceId : bobId } }]);
    }
    if (url.includes('/messages')) {
      messages += 1;
      return response({ id: '999999999999999999' });
    }
    if (url.endsWith('/issues/40/comments') && options.method === 'POST') {
      return response({ error: 'unavailable' }, 503);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  await assert.rejects(notifyReviewers(config), /notification record is uncertain/);
  assert.equal(messages, 1);
});

test('rechaza configuración incompleta antes de consultar GitHub o Discord', async (t) => {
  const { config } = setup(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; throw new Error('unexpected'); });
  for (const change of [
    { botToken: '' }, { cacheKey: '' }, { baseBranch: '' },
    { guildId: '' }, { channelId: '' }, { relationsFile: '' },
  ]) {
    await assert.rejects(notifyReviewers({ ...config, ...change }), /configuration is incomplete/);
  }
  assert.equal(requests, 0);
});
