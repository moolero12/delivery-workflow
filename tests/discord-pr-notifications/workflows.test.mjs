import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(new URL('../../.github/actions/discord-pr-notifications/action.yml', import.meta.url), 'utf8');
const trigger = readFileSync(new URL('../../examples/atempo/discord-pr-trigger.yml', import.meta.url), 'utf8');
const publisher = readFileSync(new URL('../../examples/atempo/discord-pr-publish.yml', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../../docs/DISCORD-PR-NOTIFICATIONS.md', import.meta.url), 'utf8');

test('la acción declara todos los inputs y solo ejecuta módulos del paquete', () => {
  assert.match(action, /using: composite/);
  for (const input of ['github-token', 'bot-token', 'cache-key', 'guild-id', 'channel-id',
    'expected-repository', 'base-branch', 'trigger-run-id']) {
    assert.match(action, new RegExp(`^  ${input}:`, 'm'));
  }
  assert.match(action, /run-id: \$\{\{ inputs\.trigger-run-id \}\}/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/verify-event\.mjs"/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/state\.mjs" prepare/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/notify\.mjs"/);
  assert.match(action, /steps\.verify\.outputs\.eligible == 'true'/);
  assert.match(action, /if: always\(\) && steps\.prepare\.outcome == 'success'/);
  assert.match(action, /retention-days: 2/);
  assert.doesNotMatch(action, /actions\/checkout|pull_request_target/);
  // Los IDs reales y los secretos no deben estar en el paquete.
  assert.doesNotMatch(action + trigger + publisher + docs, /\b[0-9]{17,20}\b/);
});

test('el disparador recoge cualquier PR a staging sin secretos', () => {
  assert.match(trigger, /pull_request:\s*\n\s*branches: \[staging\]/);
  assert.match(trigger, /types: \[opened, review_requested, ready_for_review\]/);
  assert.match(trigger, /permissions: \{\}/);
  assert.match(trigger, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(trigger, /retention-days: 1/);
  assert.doesNotMatch(trigger, /actions\/checkout|secrets\.|pull_request_target/);
});

test('el emisor protegido llama a un commit fijo de la acción', () => {
  assert.match(publisher, /workflow_run:\s*\n\s*workflows: \[Discord PR notification trigger\]/);
  assert.match(publisher, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publisher, /workflow_run\.conclusion == 'success'/);
  assert.match(publisher, /environment: discord-pr-notifications/);
  assert.match(publisher, /queue: max/);
  assert.match(publisher, /cancel-in-progress: false/);
  assert.match(publisher, /actions: read/);
  assert.match(publisher, /issues: write/);
  assert.match(publisher, /pull-requests: read/);
  assert.match(publisher, /trigger-run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(publisher, /@REPLACE_WITH_V0_2_0_COMMIT_SHA/);
  assert.doesNotMatch(publisher, /actions\/checkout|head_sha|@staging|@main/);
});
