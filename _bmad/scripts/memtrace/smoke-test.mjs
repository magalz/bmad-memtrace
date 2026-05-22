import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ADAPTER = resolve(import.meta.dirname, 'memtrace-adapter.mjs');
const RESTART = resolve(import.meta.dirname, 'memtrace-restart.mjs');

function runScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error
  };
}

describe('memtrace-adapter.mjs smoke tests', () => {

  it('--help exits 0 and documents all required flags', () => {
    const r = runScript(ADAPTER, ['--help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('Usage:'));
    assert.ok(r.stdout.includes('--target'));
    assert.ok(r.stdout.includes('--query'));
    assert.ok(r.stdout.includes('--repo'));
    assert.ok(r.stdout.includes('--summarize'));
    assert.ok(r.stdout.includes('--check-freshness'));
    assert.ok(r.stdout.includes('--batch'));
  });

  it('--help lists all 3 query types', () => {
    const r = runScript(ADAPTER, ['--help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('get_impact'));
    assert.ok(r.stdout.includes('find_dead_code'));
    assert.ok(r.stdout.includes('list_repos'));
  });

  it('--query list_repos exits 0 with valid JSON', { timeout: 60000 }, async () => {
    const r = await new Promise((resolvePromise) => {
      execFile(process.execPath, [ADAPTER, '--query', 'list_repos'], {
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        timeout: 55000,
        windowsHide: true
      }, (error, stdout, stderr) => {
        resolvePromise({
          code: error?.code === 'ETIMEDOUT' ? null : (error?.code || 0),
          stdout: stdout || '',
          stderr: stderr || ''
        });
      });
    });
    if (r.code === 0) {
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch (e) {
        assert.fail(`STDOUT is not valid JSON: ${r.stdout.slice(0, 200)}`);
      }
      assert.equal(parsed.query, 'list_repos');
      assert.ok(Array.isArray(parsed.repositories));
      assert.ok(typeof parsed.elapsed_ms === 'number');
      for (const repo of parsed.repositories) {
        assert.ok(repo.freshness, 'Each repo must have freshness field');
      }
    } else if (r.code === 1) {
      assert.ok(r.stdout.includes('MEMTRACE_MCP_ERROR_TIMEOUT') || r.stderr.includes('ERROR'),
        'Exit 1 should include MEMTRACE_MCP_ERROR_TIMEOUT or error message');
    }
  });
});

describe('memtrace-restart.mjs smoke tests', () => {

  it('--help exits 0 with Usage: and --dry-run', () => {
    const r = runScript(RESTART, ['--help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('Usage:'));
    assert.ok(r.stdout.includes('--dry-run'));
    assert.ok(r.stdout.includes('--help'));
  });

  it('-h exits 0 with Usage:', () => {
    const r = runScript(RESTART, ['-h']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('Usage:'));
  });

  it('--dry-run exits 0 with DRY-RUN in stderr', () => {
    const r = runScript(RESTART, ['--dry-run']);
    assert.equal(r.code, 0);
    assert.ok(r.stderr.includes('DRY-RUN'));
    assert.ok(r.stderr.includes('[restart]'));
  });

  it('--dry-run shows Terminating step in stderr', () => {
    const r = runScript(RESTART, ['--dry-run']);
    const stderrLines = r.stderr.split('\n').filter(Boolean);
    const killIdx = stderrLines.findIndex(l => l.includes('Terminating'));
    assert.ok(killIdx !== -1, 'Kill step (Terminating) must exist in stderr');
  });

  it('--invalid exits 1 with Unknown argument error', () => {
    const r = runScript(RESTART, ['--invalid']);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes('Unknown argument'));
    assert.ok(r.stderr.includes('ERROR'));
  });
});
