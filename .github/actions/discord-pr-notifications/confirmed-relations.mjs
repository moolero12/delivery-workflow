export const COMMENT_MARKER = '/discord-map ';
export const RELATION_LIFETIME_MS = 48 * 60 * 60 * 1000;

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const COMMAND = /^\/discord-map ([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?) (\d{17,20})$/i;
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function parseMappingComment(comment, pr, repository, now = Date.now()) {
  const isAuthor = Number.isSafeInteger(pr.user?.id) && comment.user?.id === pr.user.id;
  if (!Number.isSafeInteger(comment?.user?.id) || typeof comment.body !== 'string' ||
      !(isAuthor || TRUSTED_ASSOCIATIONS.has(comment.author_association))) return null;
  const match = comment.body.trimEnd().match(COMMAND);
  if (!match || !LOGIN.test(match[1])) return null;
  const confirmedAt = Date.parse(comment.updated_at ?? comment.created_at);
  if (!Number.isFinite(confirmedAt) || confirmedAt > now || now - confirmedAt >= RELATION_LIFETIME_MS) return null;
  // El comando solo acepta un login y un ID; la pertenencia al servidor se valida después.
  return { confirmedAt, mappings: [{ github: match[1], discord: { type: 'id', value: match[2] } }] };
}

export function latestConfirmedMappings(comments, pr, repository, now = Date.now()) {
  const latest = new Map();
  for (const comment of comments) {
    const parsed = parseMappingComment(comment, pr, repository, now);
    if (!parsed) continue;
    for (const mapping of parsed.mappings) {
      const login = mapping.github.toLowerCase();
      const previous = latest.get(login);
      if (!previous || previous.confirmedAt <= parsed.confirmedAt) {
        latest.set(login, { identity: mapping.discord, confirmedAt: parsed.confirmedAt });
      }
    }
  }
  return latest;
}

export async function readConfirmedMappings(repository, pr, githubToken, now = Date.now()) {
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${pr.number}/comments?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${githubToken}`, accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`Reviewer confirmation request failed (HTTP ${response.status}).`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Reviewer confirmations have an invalid format.');
    comments.push(...batch);
    if (batch.length < 100) return latestConfirmedMappings(comments, pr, repository, now);
  }
  throw new Error('Too many PR comments to read reviewer confirmations safely.');
}
