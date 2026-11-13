import { readRelations, saveRelation, writeRelations, notificationStatus, markNotified, messageNonce } from './state.mjs';
import { hasDistinctReviewers } from './reviewers.mjs';
import { readConfirmedMappings } from './confirmed-relations.mjs';
import { fileURLToPath } from 'node:url';

const DISCORD_API = 'https://discord.com/api/v10';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}).`);
  return response.json();
}

async function searchDiscordMembers(guildId, query, botToken) {
  const url = `${DISCORD_API}/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=1000`;
  const members = await requestJson(url, { headers: { authorization: `Bot ${botToken}` } });
  if (!Array.isArray(members) || members.length >= 1000) {
    throw new Error('Discord member search was incomplete.');
  }
  return members;
}

async function getDiscordMember(guildId, id, botToken) {
  const response = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${id}`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Discord member request failed (HTTP ${response.status}).`);
  return response.json();
}

async function confirmedMember(identity, search, getMember) {
  if (identity.type === 'id') {
    const member = await getMember(identity.value);
    return member?.user?.id === identity.value ? member : null;
  }
  const members = await search(identity.value);
  const matches = members.filter((member) =>
    member.user?.username === identity.value || member.nick === identity.value);
  return matches.length === 1 ? matches[0] : null;
}

// Las confirmaciones recientes corrigen la caché; las identidades dudosas quedan pendientes.
export async function resolveReviewers(reviewers, relations, search, now = Date.now(),
  confirmations = new Map(), getMember = async () => null) {
  let updated = relations;
  const problems = [];
  for (const { login } of reviewers) {
    const cached = updated.find((item) => item.login === login);
    const confirmed = confirmations.get(login.toLowerCase());
    if (confirmed && (!cached || confirmed.confirmedAt >= Math.floor(cached.savedAt / 1000) * 1000)) {
      const member = await confirmedMember(confirmed.identity, search, getMember);
      updated = updated.filter((item) => item.login !== login);
      if (member && /^[0-9]{17,20}$/.test(member.user?.id ?? '')) {
        updated = saveRelation(updated, login, member.user.id, confirmed.confirmedAt);
      } else problems.push(`${login}: confirmation is not a unique guild member`);
    } else if (!cached) {
      const matches = (await search(login)).filter((member) => member.user?.username === login);
      if (matches.length === 1 && /^[0-9]{17,20}$/.test(matches[0].user?.id ?? '')) {
        updated = saveRelation(updated, login, matches[0].user.id, now);
      } else problems.push(`${login}: no unique exact match`);
    }
  }
  const ids = reviewers.map(({ login }) => updated.find((item) => item.login === login)?.discordId);
  const counts = new Map();
  for (const id of ids.filter(Boolean)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const resolvedReviewers = reviewers.flatMap((reviewer, index) => {
    const discordId = ids[index];
    return discordId && counts.get(discordId) === 1 ? [{ ...reviewer, discordId }] : [];
  });
  if ([...counts.values()].some((count) => count > 1)) {
    problems.push('multiple reviewers resolve to the same Discord user');
  }
  return { relations: updated, ids, resolvedReviewers, problems };
}

function plainText(value, limit) {
  return String(value ?? '')
    .replace(/<@!?\d+>|<@&\d+>|@everyone|@here/g, '[mention]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[*_`~|>\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function buildMessage(repository, pr, reviewers, update = false) {
  const title = plainText(pr.title, 120);
  const description = plainText(pr.body, 180);
  const link = `https://github.com/${repository}/pull/${pr.number}`;
  const names = reviewers.map(({ login, discordId }) =>
    `${discordId ? `<@${discordId}>` : plainText(login, 39)} ` +
    `(${discordId ? `GitHub: ${plainText(login, 39)}` : 'sin mención de Discord'})`).join(', ');
  const label = update ? 'Nuevos revisores o menciones' : 'Revisores';
  // El repositorio validado identifica el origen de los avisos del mismo canal.
  return `**Repositorio: ${repository}**\n**PR para revisar:** ${title || `#${pr.number}`}\n` +
    (description ? `${description}\n` : '') +
    `**${label}:** ${names}\n${link}`;
}

async function currentPullRequest(repository, baseBranch, number, token) {
  const pr = await requestJson(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  const reviewers = pr.requested_reviewers;
  if (pr.number !== number || pr.state !== 'open' || pr.draft ||
      pr.base?.ref !== baseBranch || pr.base?.repo?.full_name !== repository ||
      !hasDistinctReviewers(reviewers)) {
    throw new Error(`PR #${number} is no longer ready with distinct reviewers.`);
  }
  return pr;
}

export async function notifyReviewers(config) {
  const { repository, baseBranch, number, githubToken, botToken, cacheKey, guildId, channelId, relationsFile } = config;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !/^[A-Za-z0-9_.-]+$/.test(baseBranch ?? '') ||
      (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repository) ||
      !Number.isSafeInteger(number) || number < 1 || !githubToken || !botToken ||
      !cacheKey || !relationsFile ||
      !/^[0-9]{17,20}$/.test(guildId ?? '') || !/^[0-9]{17,20}$/.test(channelId ?? '')) {
    throw new Error('Notification configuration is incomplete.');
  }
  const pr = await currentPullRequest(repository, baseBranch, number, githubToken);
  const reviewers = pr.requested_reviewers;
  const relations = readRelations(relationsFile, cacheKey);
  const confirmations = await readConfirmedMappings(repository, pr, githubToken);
  const result = await resolveReviewers(reviewers, relations,
    (query) => searchDiscordMembers(guildId, query, botToken), Date.now(), confirmations,
    (id) => getDiscordMember(guildId, id, botToken));
  writeRelations(relationsFile, result.relations, cacheKey);
  const requestedIds = reviewers.map((reviewer) => reviewer.id);
  const resolvedIds = result.resolvedReviewers.map((reviewer) => reviewer.id);
  // El primer aviso sale con cero menciones si hace falta; las confirmaciones posteriores son actualizaciones.
  const status = await notificationStatus(repository, number, requestedIds, resolvedIds, githubToken, cacheKey);
  const affectedIds = new Set([...status.newRequestedIds, ...status.newMentionIds]);
  if (status.announced && affectedIds.size === 0) {
    console.log(`PR #${number} and its reviewers were already notified.`);
    return 'already-notified';
  }
  const mentionedIds = status.announced ? status.newMentionIds : resolvedIds;
  const mentionsById = new Map(result.resolvedReviewers
    .filter((reviewer) => mentionedIds.includes(reviewer.id))
    .map((reviewer) => [reviewer.id, reviewer.discordId]));
  const messageReviewers = reviewers.filter((reviewer) => !status.announced || affectedIds.has(reviewer.id))
    .map((reviewer) => ({ ...reviewer, discordId: mentionsById.get(reviewer.id) }));
  const discordIds = messageReviewers.map((reviewer) => reviewer.discordId).filter(Boolean);
  if (discordIds.length > 100) throw new Error(`PR #${number} exceeds Discord's 100-user mention limit.`);

  const content = buildMessage(repository, pr, messageReviewers, status.announced);
  if (content.length > 2000) {
    throw new Error(`PR #${number} exceeds Discord's 2000-character message limit.`);
  }
  // allowed_mentions limita las etiquetas a los revisores nuevos ya verificados.
  await requestJson(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users: discordIds },
      nonce: messageNonce(repository, number,
        status.announced ? (mentionedIds.length ? 'update-mention' : 'update-plain') : 'initial',
        status.announced ? [...affectedIds] : []),
      enforce_nonce: true,
    }),
  });
  try {
    await markNotified(repository, number, requestedIds, githubToken, cacheKey, mentionedIds);
  } catch {
    throw new Error(`Discord accepted PR #${number}, but its notification record is uncertain. Check #git before retrying.`);
  }
  console.log(`PR #${number} notified in Discord.`);
  return 'notified';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  notifyReviewers({
    repository: process.env.EXPECTED_REPOSITORY,
    baseBranch: process.env.PR_BASE_BRANCH,
    number: Number(process.env.PR_NUMBER),
    githubToken: process.env.GITHUB_TOKEN,
    botToken: process.env.DISCORD_BOT_TOKEN,
    cacheKey: process.env.DISCORD_CACHE_KEY,
    guildId: process.env.DISCORD_GUILD_ID,
    channelId: process.env.DISCORD_GIT_CHANNEL_ID,
    relationsFile: process.env.RELATIONS_FILE,
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
