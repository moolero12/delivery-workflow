import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verifierPath = fileURLToPath(new URL('../../.github/actions/discord-pr-notifications/verify-event.mjs', import.meta.url));
const repository = 'owner/repository';
const prNumber = 42;

function validEvent() {
  return {
    repository: { full_name: repository },
    workflow_run: {
      id: 987,
      repository: { full_name: repository },
      event: 'pull_request',
      conclusion: 'success',
      pull_requests: [{ number: prNumber }],
      head_repository: { full_name: repository },
      head_branch: 'feature',
      head_sha: 'head-commit',
    },
  };
}

function validPullRequest() {
  return {
    number: prNumber,
    base: { repo: { full_name: repository }, ref: 'staging' },
    head: { repo: { full_name: repository }, ref: 'feature', sha: 'head-commit' },
    state: 'open',
    draft: false,
    requested_reviewers: [
      { id: 10, login: 'first-reviewer' },
      { id: 20, login: 'second-reviewer' },
    ],
  };
}

// El proceso hijo simula GitHub y comprueba que solo una PR verificada llega a GITHUB_OUTPUT.
function runVerifier({ event = validEvent(), pullRequest = validPullRequest(), artifact = '42', httpStatus = 200, envOverrides = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-pr-verify-'));
  const eventPath = join(directory, 'event.json');
  const numberPath = join(directory, 'pr-number');
  const outputPath = join(directory, 'output');
  writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  writeFileSync(numberPath, artifact, 'utf8');
  writeFileSync(outputPath, '', 'utf8');

  const fetchStub = `globalThis.fetch = async (url, options) => {
    if (url !== 'https://api.github.com/repos/owner/repository/pulls/42' ||
        options.headers.authorization !== 'Bearer test-token') {
      throw new Error('Unexpected GitHub API request.');
    }
    return {
      ok: ${httpStatus === 200},
      status: ${httpStatus},
      json: async () => JSON.parse(process.env.TEST_PULL_REQUEST),
    };
  };`;
  const importUrl = `data:text/javascript,${encodeURIComponent(fetchStub)}`;

  try {
    const result = spawnSync(process.execPath, ['--import', importUrl, verifierPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: repository,
        EXPECTED_REPOSITORY: repository,
        PR_BASE_BRANCH: 'staging',
        TRIGGER_RUN_ID: '987',
        GITHUB_TOKEN: 'test-token',
        GITHUB_OUTPUT: outputPath,
        PR_NUMBER_FILE: numberPath,
        TEST_PULL_REQUEST: JSON.stringify(pullRequest),
        ...envOverrides,
      },
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: readFileSync(outputPath, 'utf8'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('acepta una PR abierta y lista con dos revisores distintos', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=true\npr_number=42\n');
});

test('rechaza números de artefacto que no sean un único entero decimal corto', () => {
  for (const artifact of ['0', '42\n', '42;echo x', '-42', '12345678901']) {
    const result = runVerifier({ artifact });
    assert.equal(result.status, 1, artifact);
    assert.equal(result.output, '', artifact);
  }
});

test('rechaza una ejecución ajena, fallida o de otro evento', () => {
  for (const change of [
    (event) => { event.repository.full_name = 'other/repository'; },
    (event) => { event.workflow_run.repository.full_name = 'other/repository'; },
    (event) => { event.workflow_run.conclusion = 'failure'; },
    (event) => { event.workflow_run.event = 'push'; },
    (event) => { event.workflow_run.id = 123; },
  ]) {
    const event = validEvent();
    change(event);
    const result = runVerifier({ event });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
  }
});

test('rechaza repositorio, base, ejecución o token mal configurados sin exponer el secreto', () => {
  for (const envOverrides of [
    { EXPECTED_REPOSITORY: 'other/repository' },
    { PR_BASE_BRANCH: 'main' },
    { TRIGGER_RUN_ID: '123' },
    { GITHUB_TOKEN: '' },
  ]) {
    const result = runVerifier({ envOverrides });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
    assert.doesNotMatch(result.stderr, /test-token/);
  }
});

test('rechaza una PR cerrada, en borrador o dirigida a otra base', () => {
  for (const change of [
    (pr) => { pr.state = 'closed'; },
    (pr) => { pr.draft = true; },
    (pr) => { pr.base.ref = 'main'; },
    (pr) => { pr.base.repo.full_name = 'other/repository'; },
    (pr) => { pr.number = 99; },
  ]) {
    const pullRequest = validPullRequest();
    change(pullRequest);
    const result = runVerifier({ pullRequest });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
  }
});

test('omite las PR con menos de dos revisores', () => {
  for (const reviewers of [[], [{ id: 10, login: 'first-reviewer' }]]) {
    const pullRequest = validPullRequest();
    pullRequest.requested_reviewers = reviewers;
    const result = runVerifier({ pullRequest });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'eligible=false\n');
  }
});

test('admite tres o más revisores solicitados y distintos', () => {
  const pullRequest = validPullRequest();
  pullRequest.requested_reviewers.push({ id: 30, login: 'third-reviewer' });
  const result = runVerifier({ pullRequest });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=true\npr_number=42\n');
});

test('rechaza revisores duplicados en cualquier posición', () => {
  for (const reviewers of [
    [{ id: 10, login: 'first-reviewer' }, { id: 10, login: 'second-reviewer' }],
    [{ id: 10, login: 'first-reviewer' }, { id: 20, login: 'first-reviewer' }],
    [{ id: 10, login: 'first-reviewer' }, { id: 20, login: 'second-reviewer' }, { id: 10, login: 'third-reviewer' }],
  ]) {
    const pullRequest = validPullRequest();
    pullRequest.requested_reviewers = reviewers;
    const result = runVerifier({ pullRequest });
    assert.equal(result.status, 1, JSON.stringify(reviewers));
    assert.equal(result.output, '');
  }
});

test('vincula la PR al run por asociación o por rama, repositorio y commit', () => {
  const unrelatedEvent = validEvent();
  unrelatedEvent.workflow_run.pull_requests = [{ number: 99 }];
  assert.equal(runVerifier({ event: unrelatedEvent }).output, '');

  const fallbackEvent = validEvent();
  fallbackEvent.workflow_run.pull_requests = [];
  assert.equal(runVerifier({ event: fallbackEvent }).output, 'eligible=true\npr_number=42\n');

  fallbackEvent.workflow_run.head_sha = 'unrelated-commit';
  assert.equal(runVerifier({ event: fallbackEvent }).output, '');
});

test('no entrega número si GitHub falla al leer la PR', () => {
  const result = runVerifier({ httpStatus: 503 });
  assert.equal(result.status, 1);
  assert.equal(result.output, '');
  assert.match(result.stderr, /HTTP 503/);
});
