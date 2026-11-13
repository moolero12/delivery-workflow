import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RELATION_LIFETIME_MS = 48 * 60 * 60 * 1000;
export const RELATIONS_ARTIFACT_NAME = 'discord-pr-relations';

const LEDGER_MARKER = '<!-- discord-pr-notifications-ledger:v1 -->';
const API_URL = 'https://api.github.com';

function encryptionKey(secret) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) {
    throw new Error('DISCORD_CACHE_KEY must be a base64-encoded 32-byte key.');
  }
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32 || key.toString('base64') !== secret) {
    throw new Error('DISCORD_CACHE_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

// Cifra el contenido completo: los logins y los IDs no quedan visibles en Actions.
export function encryptState(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

export function decryptState(text, secret) {
  const document = JSON.parse(text);
  if (document?.version !== 1 ||
      typeof document.iv !== 'string' ||
      typeof document.tag !== 'string' ||
      typeof document.ciphertext !== 'string') {
    throw new Error('The encrypted state has an unknown format.');
  }
  const iv = Buffer.from(document.iv, 'base64');
  const tag = Buffer.from(document.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('The encrypted state has an invalid cipher header.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(document.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(cleartext.toString('utf8'));
}

function validRelation(relation) {
  return typeof relation?.login === 'string' && relation.login.length > 0 &&
    typeof relation.discordId === 'string' && /^[0-9]{17,20}$/.test(relation.discordId) &&
    Number.isSafeInteger(relation.savedAt) && relation.savedAt >= 0;
}

export function activeRelations(relations, now = Date.now()) {
  if (!Array.isArray(relations) || !relations.every(validRelation)) {
    throw new Error('The relations cache has an invalid format.');
  }
  // La caducidad se comprueba por entrada, no por la fecha del artefacto.
  return relations.filter((relation) =>
    relation.savedAt <= now && now - relation.savedAt < RELATION_LIFETIME_MS);
}

export function readRelations(filePath, secret, now = Date.now()) {
  const state = decryptState(readFileSync(filePath, 'utf8'), secret);
  if (state?.version !== 1) {
    throw new Error('The relations cache has an unknown format.');
  }
  return activeRelations(state.relations, now);
}

export function writeRelations(filePath, relations, secret, now = Date.now()) {
  const current = activeRelations(relations, now);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, encryptState({ version: 1, relations: current }, secret), 'utf8');
}

export function saveRelation(relations, login, discordId, now = Date.now()) {
  const relation = { login, discordId, savedAt: now };
  if (!validRelation(relation)) {
    throw new Error('The reviewer relation is invalid.');
  }
  return [...activeRelations(relations, now).filter((item) => item.login !== login), relation];
}

export function notificationKey(repository, prNumber, reviewerIds) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !Number.isSafeInteger(prNumber) || prNumber < 1 ||
      !Array.isArray(reviewerIds) || reviewerIds.length < 2 ||
      !reviewerIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
      new Set(reviewerIds).size !== reviewerIds.length) {
    throw new Error('The notification identity is invalid.');
  }
  const reviewerSet = [...reviewerIds].sort((a, b) => a - b);
  // 144 bits permiten reutilizar esta clave como nonce estable de Discord.
  return createHash('sha256')
    .update(JSON.stringify([repository, prNumber, reviewerSet]))
    .digest('base64url')
    .slice(0, 24);
}

export function messageNonce(repository, prNumber, phase, reviewerIds) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !Number.isSafeInteger(prNumber) || prNumber < 1 ||
      !['initial', 'update-plain', 'update-mention'].includes(phase) || !Array.isArray(reviewerIds) ||
      !reviewerIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
      new Set(reviewerIds).size !== reviewerIds.length) {
    throw new Error('The notification nonce is invalid.');
  }
  return createHash('sha256')
    .update(JSON.stringify([repository, prNumber, phase, [...reviewerIds].sort((a, b) => a - b)]))
    .digest('base64url')
    .slice(0, 24);
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub state request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

export async function listRelationsArtifacts(repository, token) {
  const name = encodeURIComponent(RELATIONS_ARTIFACT_NAME);
  const artifacts = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await githubRequest(
      `/repos/${repository}/actions/artifacts?name=${name}&per_page=100&page=${page}`, token);
    const batch = response.artifacts ?? [];
    artifacts.push(...batch.filter((artifact) => !artifact.expired && Number.isSafeInteger(artifact.id)));
    if (batch.length < 100) return artifacts;
  }
  throw new Error('Too many relations artifacts to read safely.');
}

// Reúne todas las relaciones vigentes y obliga a resolver de nuevo los IDs en conflicto.
export function mergeRelations(groups, now = Date.now()) {
  const byLogin = new Map();
  const conflicts = new Set();
  for (const relations of groups) {
    for (const relation of activeRelations(relations, now)) {
      const previous = byLogin.get(relation.login);
      if (previous && previous.discordId !== relation.discordId) conflicts.add(relation.login);
      if (!previous || previous.savedAt < relation.savedAt) byLogin.set(relation.login, relation);
    }
  }
  return {
    relations: [...byLogin.values()].filter((relation) => !conflicts.has(relation.login)),
    conflicts: [...conflicts],
  };
}

async function downloadRelations(repository, artifact, token, secret, now) {
  const response = await fetch(`${API_URL}/repos/${repository}/actions/artifacts/${artifact.id}/zip`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Artifact download failed (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > 1024 * 1024) throw new Error('Artifact is too large.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw new Error('Artifact is too large.');
  const directory = mkdtempSync(join(tmpdir(), 'discord-relations-'));
  try {
    const zip = join(directory, 'artifact.zip');
    writeFileSync(zip, bytes);
    const result = spawnSync('unzip', ['-p', zip, 'relations.enc.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error('Artifact archive is invalid.');
    const state = decryptState(result.stdout, secret);
    if (state?.version !== 1) throw new Error('Artifact relations format is invalid.');
    return activeRelations(state.relations, now);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function restoreRelations(repository, token, secret, now = Date.now()) {
  const artifacts = await listRelationsArtifacts(repository, token);
  const groups = [];
  for (const artifact of artifacts) {
    try {
      groups.push(await downloadRelations(repository, artifact, token, secret, now));
    } catch {
      console.warn(`Relations artifact ${artifact.id} could not be used.`);
    }
  }
  return mergeRelations(groups, now);
}

async function readLedger(repository, prNumber, token, secret) {
  const prefix = `/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=`;
  let ledger = null;
  for (let page = 1; page <= 100; page += 1) {
    const comments = await githubRequest(`${prefix}${page}`, token);
    for (const comment of comments) {
      if (!comment.body?.startsWith(LEDGER_MARKER)) continue;
      if (ledger) throw new Error('More than one notification ledger exists for this PR.');
      const data = decryptState(comment.body.slice(LEDGER_MARKER.length).trim(), secret);
      if (data?.version !== 1 || data.repository !== repository ||
          data.prNumber !== prNumber || !Array.isArray(data.keys) ||
          !data.keys.every((key) => typeof key === 'string' && /^[A-Za-z0-9_-]{24}$/.test(key)) ||
          (data.announcedReviewerIds !== undefined &&
            (!Array.isArray(data.announcedReviewerIds) ||
              !data.announcedReviewerIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
              new Set(data.announcedReviewerIds).size !== data.announcedReviewerIds.length)) ||
          (data.notifiedReviewerIds !== undefined &&
            (!Array.isArray(data.notifiedReviewerIds) ||
              !data.notifiedReviewerIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
              new Set(data.notifiedReviewerIds).size !== data.notifiedReviewerIds.length))) {
        throw new Error('The notification ledger is invalid.');
      }
      ledger = { id: comment.id, keys: data.keys,
        announcedReviewerIds: data.announcedReviewerIds ?? null,
        notifiedReviewerIds: data.notifiedReviewerIds ?? null };
    }
    if (comments.length < 100) return ledger ?? {
      id: null, keys: [], announcedReviewerIds: [], notifiedReviewerIds: [],
    };
  }
  throw new Error('The notification ledger could not be fully read.');
}

export async function wasNotified(repository, prNumber, reviewerIds, token, secret) {
  return (await unnotifiedReviewerIds(repository, prNumber, reviewerIds, token, secret)).length === 0;
}

function legacyNotifiedIds(repository, prNumber, ledger, reviewerIds) {
  const ids = new Set();
  if (reviewerIds.length >= 2 && ledger.keys.includes(notificationKey(repository, prNumber, reviewerIds))) {
    reviewerIds.forEach((id) => ids.add(id));
  }
  // El registro anterior guardaba solo hashes de parejas de revisores.
  for (let first = 0; first < reviewerIds.length; first += 1) {
    for (let second = first + 1; second < reviewerIds.length; second += 1) {
      const pair = [reviewerIds[first], reviewerIds[second]];
      if (ledger.keys.includes(notificationKey(repository, prNumber, pair))) pair.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

export async function notificationStatus(repository, prNumber, requestedIds, resolvedIds, token, secret) {
  notificationKey(repository, prNumber, requestedIds);
  if (!Array.isArray(resolvedIds) || resolvedIds.some((id) => !requestedIds.includes(id)) ||
      new Set(resolvedIds).size !== resolvedIds.length) {
    throw new Error('The notification identity is invalid.');
  }
  const ledger = await readLedger(repository, prNumber, token, secret);
  const legacy = legacyNotifiedIds(repository, prNumber, ledger, requestedIds);
  const announced = new Set(ledger.announcedReviewerIds ?? legacy);
  const notified = new Set(ledger.notifiedReviewerIds ?? legacy);
  return {
    announced: ledger.keys.length > 0,
    newRequestedIds: requestedIds.filter((id) => !announced.has(id)),
    newMentionIds: resolvedIds.filter((id) => !notified.has(id)),
  };
}

export async function unnotifiedReviewerIds(repository, prNumber, reviewerIds, token, secret) {
  if (!Array.isArray(reviewerIds) || reviewerIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('The notification identity is invalid.');
  }
  const ledger = await readLedger(repository, prNumber, token, secret);
  const notified = new Set(ledger.notifiedReviewerIds ??
    legacyNotifiedIds(repository, prNumber, ledger, reviewerIds));
  return reviewerIds.filter((id) => !notified.has(id));
}

export async function markNotified(repository, prNumber, reviewerIds, token, secret,
  mentionedReviewerIds = reviewerIds) {
  const key = notificationKey(repository, prNumber, reviewerIds);
  if (!Array.isArray(mentionedReviewerIds) ||
      mentionedReviewerIds.some((id) => !reviewerIds.includes(id)) ||
      new Set(mentionedReviewerIds).size !== mentionedReviewerIds.length) {
    throw new Error('The notification identity is invalid.');
  }
  const ledger = await readLedger(repository, prNumber, token, secret);
  const legacy = legacyNotifiedIds(repository, prNumber, ledger, reviewerIds);
  const announced = new Set(ledger.announcedReviewerIds ?? legacy);
  const notified = new Set(ledger.notifiedReviewerIds ?? legacy);
  if (ledger.keys.includes(key) && reviewerIds.every((id) => announced.has(id)) &&
      mentionedReviewerIds.every((id) => notified.has(id))) return;

  // Se llama solo después de que Discord confirme el envío.
  const encrypted = encryptState({
    version: 1,
    repository,
    prNumber,
    keys: [...new Set([...ledger.keys, key])],
    announcedReviewerIds: [...new Set([...announced, ...reviewerIds])],
    notifiedReviewerIds: [...new Set([...notified, ...mentionedReviewerIds])],
  }, secret);
  const body = JSON.stringify({ body: `${LEDGER_MARKER}\n${encrypted}` });
  if (ledger.id === null) {
    await githubRequest(`/repos/${repository}/issues/${prNumber}/comments`, token, {
      method: 'POST', body,
    });
  } else {
    await githubRequest(`/repos/${repository}/issues/comments/${ledger.id}`, token, {
      method: 'PATCH', body,
    });
  }
}

async function main() {
  const command = process.argv[2];
  const repository = process.env.EXPECTED_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (command === 'prepare') {
    const target = process.env.RELATIONS_FILE;
    const secret = process.env.DISCORD_CACHE_KEY;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
        process.env.GITHUB_REPOSITORY !== repository || !token || !target || !secret) {
      throw new Error('Relations configuration is incomplete.');
    }
    // La clave se valida antes de descargar artefactos de ejecuciones previas.
    encryptionKey(secret);
    const { relations, conflicts } = await restoreRelations(repository, token, secret);
    if (conflicts.length) console.warn(`Conflicting relations require a new exact match: ${conflicts.join(', ')}`);
    writeRelations(target, relations, secret);
    return;
  }
  throw new Error('Unknown state command.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
