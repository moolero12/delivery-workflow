import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(new URL('../../.github/actions/discord-pr-notifications/action.yml', import.meta.url), 'utf8');
const trigger = readFileSync(new URL('../../examples/atempo/discord-pr-trigger.yml', import.meta.url), 'utf8');
const publisher = readFileSync(new URL('../../examples/atempo/discord-pr-publish.yml', import.meta.url), 'utf8');
const packageTrigger = readFileSync(new URL('../../.github/workflows/discord-pr-trigger.yml', import.meta.url), 'utf8');
const packagePublisher = readFileSync(new URL('../../.github/workflows/discord-pr-publish.yml', import.meta.url), 'utf8');
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
  assert.doesNotMatch(action + trigger + publisher + packageTrigger + packagePublisher + docs, /\b[0-9]{17,20}\b/);
});

test('el disparador recoge cualquier PR a staging sin secretos', () => {
  for (const workflow of [trigger, packageTrigger]) {
    assert.match(workflow, /pull_request:\s*\n\s*branches: \[staging\]/);
    assert.match(workflow, /types: \[opened, review_requested, ready_for_review\]/);
    assert.match(workflow, /permissions: \{\}/);
    assert.match(workflow, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
    assert.match(workflow, /retention-days: 1/);
    assert.doesNotMatch(workflow, /actions\/checkout|secrets\.|pull_request_target/);
  }
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

test('delivery-workflow publica desde su staging con la acción local confiable', () => {
  assert.match(packagePublisher, /workflow_run:\s*\n\s*workflows: \[Discord PR notification trigger\]/);
  assert.match(packagePublisher, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(packagePublisher, /workflow_run\.conclusion == 'success'/);
  assert.match(packagePublisher, /workflow_run\.event == 'pull_request'/);
  assert.match(packagePublisher, /workflow_run\.repository\.full_name == github\.repository/);
  assert.match(packagePublisher, /environment: discord-pr-notifications/);
  assert.match(packagePublisher, /group: discord-pr-relations/);
  assert.match(packagePublisher, /queue: max/);
  assert.match(packagePublisher, /cancel-in-progress: false/);
  for (const permission of ['actions: read', 'contents: read', 'issues: write', 'pull-requests: read']) {
    assert.ok(packagePublisher.includes(permission));
  }
  assert.match(packagePublisher, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(packagePublisher, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(packagePublisher, /persist-credentials: false/);
  assert.match(packagePublisher, /uses: \.\/\.github\/actions\/discord-pr-notifications/);
  assert.match(packagePublisher, /expected-repository: venturars\/delivery-workflow/);
  assert.match(packagePublisher, /base-branch: staging/);
  assert.match(packagePublisher, /trigger-run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.doesNotMatch(packagePublisher, /head_sha|pull_request_target/);
});

test('cada emisor recibe sus propios secretos y token de GitHub', () => {
  for (const workflow of [publisher, packagePublisher]) {
    assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
    assert.match(workflow, /bot-token: \$\{\{ secrets\.DISCORD_BOT_TOKEN \}\}/);
    assert.match(workflow, /cache-key: \$\{\{ secrets\.DISCORD_CACHE_KEY \}\}/);
    assert.match(workflow, /guild-id: \$\{\{ vars\.DISCORD_GUILD_ID \}\}/);
    assert.match(workflow, /channel-id: \$\{\{ vars\.DISCORD_GIT_CHANNEL_ID \}\}/);
  }
  assert.match(publisher, /expected-repository: venturars\/aTempo/);
  assert.notEqual(publisher, packagePublisher);
});
