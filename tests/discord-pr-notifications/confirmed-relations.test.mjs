import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestConfirmedMappings, parseMappingComment, readConfirmedMappings, RELATION_LIFETIME_MS,
} from '../../.github/actions/discord-pr-notifications/confirmed-relations.mjs';

const repository = 'owner/repo';
const pr = { number: 40, user: { id: 77 } };
const now = Date.now();
const discordId = '123456789012345678';

function comment(body = `/discord-map alice ${discordId}`, options = {}) {
  return {
    id: 1, user: { id: 77 }, author_association: 'CONTRIBUTOR',
    updated_at: new Date(now - 1000).toISOString(), body, ...options,
  };
}

test('acepta el comando exacto del autor y usa la confirmación reciente', () => {
  const result = latestConfirmedMappings([comment()], pr, repository, now);
  assert.deepEqual(result.get('alice').identity, { type: 'id', value: discordId });
  const corrected = comment('/discord-map alice 223456789012345678', {
    user: { id: 88 }, author_association: 'OWNER', updated_at: new Date(now).toISOString(),
  });
  assert.equal(latestConfirmedMappings([comment(), corrected], pr, repository, now)
    .get('alice').identity.value, '223456789012345678');
});

test('ignora autores ajenos, caducidad y comandos malformados', () => {
  for (const invalid of [
    comment(undefined, { user: { id: 99 } }),
    comment(undefined, { user: null, author_association: 'OWNER' }),
    comment(undefined, { updated_at: new Date(now - RELATION_LIFETIME_MS).toISOString() }),
    comment(`/discord-map alice 123`),
    comment(`/discord-map alice ${discordId}\nextra`),
    comment(`texto /discord-map alice ${discordId}`),
    comment(`<!-- discord-pr-reviewer-map:v1 -->\n{}`),
  ]) assert.equal(parseMappingComment(invalid, pr, repository, now), null);
});

test('consulta los comentarios de la PR sin mostrar el token', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization });
    return new Response(JSON.stringify([comment()]), { status: 200 });
  });
  const result = await readConfirmedMappings(repository, pr, 'test-token', now);
  assert.equal(result.size, 1);
  assert.equal(requests[0].authorization, 'Bearer test-token');
  assert.match(requests[0].url, /\/issues\/40\/comments\?per_page=100&page=1$/);
});
