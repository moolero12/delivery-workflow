export const COMMENT_MARKER = '<!-- discord-pr-reviewer-map:v1 -->';
export const RELATION_LIFETIME_MS = 48 * 60 * 60 * 1000;

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const DISCORD_ID = /^\d{17,20}$/;
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function validDiscordIdentity(identity) {
  if (identity?.type === 'id') return DISCORD_ID.test(identity.value ?? '');
  return identity?.type === 'name' && typeof identity.value === 'string' &&
    identity.value.length > 0 && identity.value.length <= 64 &&
    !/[<>\r\n\t\u0000-\u001f]/.test(identity.value);
}

export function parseMappingComment(comment, pr, repository, now = Date.now()) {
  const isAuthor = Number.isSafeInteger(pr.user?.id) && comment.user?.id === pr.user.id;
  if (!Number.isSafeInteger(comment?.user?.id) ||
      !comment?.body?.startsWith(`${COMMENT_MARKER}\n`) || comment.body.length > 16384 ||
      !(isAuthor || TRUSTED_ASSOCIATIONS.has(comment.author_association))) return null;
  const confirmedAt = Date.parse(comment.updated_at ?? comment.created_at);
  if (!Number.isFinite(confirmedAt) || confirmedAt > now || now - confirmedAt >= RELATION_LIFETIME_MS) return null;
  let document;
  try { document = JSON.parse(comment.body.slice(COMMENT_MARKER.length).trim()); }
  catch { return null; }
  if (document?.version !== 1 || document.repository !== repository ||
      document.prNumber !== pr.number || !Array.isArray(document.mappings) ||
      document.mappings.length < 1 || document.mappings.length > 100) return null;
  const seen = new Set();
  for (const mapping of document.mappings) {
    const login = typeof mapping?.github === 'string' ? mapping.github.toLowerCase() : '';
    if (!LOGIN.test(login ?? '') || seen.has(login) || !validDiscordIdentity(mapping.discord)) return null;
    seen.add(login);
  }
  return { confirmedAt, mappings: document.mappings };
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
