import { readRelations, saveRelation, writeRelations, wasNotified, markNotified, notificationKey } from './state.mjs';
import { hasDistinctReviewers } from './reviewers.mjs';
import { fileURLToPath } from 'node:url';

const DISCORD_API = 'https://discord.com/api/v10';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}).`);
  return response.json();
}

async function searchDiscordMembers(guildId, login, botToken) {
  const url = `${DISCORD_API}/guilds/${guildId}/members/search?query=${encodeURIComponent(login)}&limit=1000`;
  const members = await requestJson(url, { headers: { authorization: `Bot ${botToken}` } });
  if (!Array.isArray(members) || members.length >= 1000) {
    throw new Error(`Discord search for ${login} was incomplete.`);
  }
  return members.filter((member) => member.user?.username === login);
}

// Ante cualquier ausencia se comprueban ambos nombres; solo se guardan coincidencias exactas y únicas.
export async function resolveReviewers(reviewers, relations, search, now = Date.now()) {
  let updated = relations;
  const missing = reviewers.some(({ login }) => !updated.some((item) => item.login === login));
  const problems = [];
  if (missing) {
    for (const { login } of reviewers) {
      const matches = (await search(login)).filter((member) => member.user?.username === login);
      if (matches.length === 1 && /^[0-9]{17,20}$/.test(matches[0].user?.id ?? '')) {
        updated = saveRelation(updated, login, matches[0].user.id, now);
      } else {
        problems.push(`${login}: ${matches.length === 0 ? 'no exact match' : 'ambiguous match'}`);
      }
    }
  }
  const ids = reviewers.map(({ login }) => updated.find((item) => item.login === login)?.discordId);
  const resolvedIds = ids.filter(Boolean);
  if (new Set(resolvedIds).size !== resolvedIds.length) {
    problems.push('multiple reviewers resolve to the same Discord user');
  }
  return { relations: updated, ids, problems };
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

export function buildMessage(repository, pr, discordIds) {
  const title = plainText(pr.title, 120);
  const description = plainText(pr.body, 180);
  const link = `https://github.com/${repository}/pull/${pr.number}`;
  // El repositorio validado identifica el origen de los avisos del mismo canal.
  return `**Repositorio: ${repository}**\n**PR para revisar:** ${title || `#${pr.number}`}\n` +
    (description ? `${description}\n` : '') +
    `Revisores: ${discordIds.map((id) => `<@${id}>`).join(' ')}\n${link}`;
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
  const reviewerIds = reviewers.map((reviewer) => reviewer.id);
  if (reviewerIds.length > 100) {
    throw new Error(`PR #${number} exceeds Discord's 100-user mention limit.`);
  }
  if (await wasNotified(repository, number, reviewerIds, githubToken, cacheKey)) {
    console.log(`PR #${number} and its reviewer set were already notified.`);
    return 'already-notified';
  }
  const relations = readRelations(relationsFile, cacheKey);
  const result = await resolveReviewers(reviewers, relations,
    (login) => searchDiscordMembers(guildId, login, botToken));
  writeRelations(relationsFile, result.relations, cacheKey);
  if (result.problems.length || result.ids.some((id) => !id)) {
    throw new Error(`Reviewers unresolved: ${result.problems.join('; ') || 'a relation is missing'}.`);
  }

  const content = buildMessage(repository, pr, result.ids);
  if (content.length > 2000) {
    throw new Error(`PR #${number} exceeds Discord's 2000-character message limit.`);
  }
  // allowed_mentions limita las etiquetas a todas las identidades verificadas.
  await requestJson(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users: result.ids },
      nonce: notificationKey(repository, number, reviewerIds),
      enforce_nonce: true,
    }),
  });
  try {
    await markNotified(repository, number, reviewerIds, githubToken, cacheKey);
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
