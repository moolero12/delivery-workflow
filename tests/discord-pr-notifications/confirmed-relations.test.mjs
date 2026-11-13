import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMENT_MARKER, latestConfirmedMappings, parseMappingComment, readConfirmedMappings,
  RELATION_LIFETIME_MS,
} from '../../.github/actions/discord-pr-notifications/confirmed-relations.mjs';

const repository = 'owner/repo';
const pr = { number: 40, user: { id: 77 } };
const now = Date.now();

function comment(mappings, options = {}) {
  return {
    id: 1, user: { id: 77 }, author_association: 'CONTRIBUTOR',
    updated_at: new Date(now - 1000).toISOString(),
    body: `${COMMENT_MARKER}\n${JSON.stringify({ version: 1, repository, prNumber: 40, mappings })}`,
    ...options,
  };
}

const mappings = [
  { github: 'alice', discord: { type: 'name', value: 'diego_molero_' } },
  { github: 'bob', discord: { type: 'id', value: '223456789012345678' } },
];

test('lee relaciones recientes confirmadas por el autor de la PR', () => {
  const result = latestConfirmedMappings([comment(mappings)], pr, repository, now);
  assert.deepEqual(result.get('alice').identity, { type: 'name', value: 'diego_molero_' });
  assert.deepEqual(result.get('bob').identity, { type: 'id', value: '223456789012345678' });
});

test('acepta una única relación para avisar después de la PR', () => {
  const result = latestConfirmedMappings([comment([mappings[0]])], pr, repository, now);
  assert.equal(result.size, 1);
  assert.equal(result.get('alice').identity.value, 'diego_molero_');
});

test('ignora comentarios ajenos, caducados y de otra PR', () => {
  const untrusted = comment(mappings, { user: { id: 99 } });
  const expired = comment(mappings, { updated_at: new Date(now - RELATION_LIFETIME_MS).toISOString() });
  const otherPr = comment(mappings, { body: comment(mappings).body.replace('"prNumber":40', '"prNumber":41') });
  assert.equal(parseMappingComment(untrusted, pr, repository, now), null);
  assert.equal(parseMappingComment(comment(mappings, { user: null, author_association: 'OWNER' }), pr, repository, now), null);
  assert.equal(parseMappingComment(expired, pr, repository, now), null);
  assert.equal(parseMappingComment(otherPr, pr, repository, now), null);
  assert.equal(latestConfirmedMappings([untrusted, expired, otherPr], pr, repository, now).size, 0);
});

test('acepta un comentario de mantenedor y usa la corrección más reciente', () => {
  const old = comment(mappings, { updated_at: new Date(now - 2000).toISOString() });
  const corrected = comment([
    { github: 'alice', discord: { type: 'name', value: 'new_name' } }, mappings[1],
  ], { user: { id: 88 }, author_association: 'OWNER' });
  assert.equal(latestConfirmedMappings([old, corrected], pr, repository, now).get('alice').identity.value, 'new_name');
});

test('rechaza mapeos repetidos, IDs malformados y texto no estructurado', () => {
  for (const broken of [
    [mappings[0], mappings[0]],
    [mappings[0], { github: 'bob', discord: { type: 'id', value: '123' } }],
    [mappings[0], { github: 'bob', discord: { type: 'name', value: '@everyone\n' } }],
    [mappings[0], { github: 42, discord: { type: 'name', value: 'valid' } }],
  ]) assert.equal(parseMappingComment(comment(broken), pr, repository, now), null);
  assert.equal(parseMappingComment({ ...comment(mappings), body: `${COMMENT_MARKER}\n{` }, pr, repository, now), null);
});

test('consulta comentarios sin mostrar el token y rechaza fallos de GitHub', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization });
    return new Response(JSON.stringify([comment(mappings)]), { status: 200 });
  });
  const result = await readConfirmedMappings(repository, pr, 'test-token', now);
  assert.equal(result.size, 2);
  assert.equal(requests[0].authorization, 'Bearer test-token');
  assert.match(requests[0].url, /\/issues\/40\/comments\?per_page=100&page=1$/);
});
