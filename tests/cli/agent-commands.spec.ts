import { parseAgentCommand, runAgentCommand } from '../../src/cli/agent-commands';
import { err } from '../../src/runtime/types';
import { runtimeError } from '../../src/runtime/errors';

describe('oma agents command contract', () => {
  test('parses list, inspect, install and project-default doctor', () => {
    expect(parseAgentCommand(['list'])).toEqual({ ok: true, value: { kind: 'list', asJson: false } });
    expect(parseAgentCommand(['inspect', 'critic', '--json'])).toEqual({
      ok: true,
      value: { kind: 'inspect', role: 'critic', asJson: true },
    });
    expect(parseAgentCommand(['install', '--scope', 'user'])).toEqual({
      ok: true,
      value: { kind: 'install', scope: 'user', asJson: false },
    });
    expect(parseAgentCommand(['doctor'])).toEqual({
      ok: true,
      value: { kind: 'doctor', scope: 'project', asJson: false },
    });
  });

  test('rejects unsafe or ambiguous argv', () => {
    expect(parseAgentCommand(['install']).ok).toBe(false);
    expect(parseAgentCommand(['install', '--scope', 'global']).ok).toBe(false);
    expect(parseAgentCommand(['inspect', 'oracle', 'extra']).ok).toBe(false);
    expect(parseAgentCommand(['list', '--json', '--json']).ok).toBe(false);
  });

  test('lists only canonical agents and resolves inspect aliases without creating visible duplicates', async () => {
    let stdout = '';
    let stderr = '';
    const dependencies = {
      workspaceRoot: '/workspace',
      loadCapabilityProfile: async () => err(runtimeError('E_CAPABILITY_UNPROVEN', 'unused')),
      stdout: (value: string) => { stdout += value; },
      stderr: (value: string) => { stderr += value; },
    };

    const listed = parseAgentCommand(['list', '--json']);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(await runAgentCommand(listed.value, dependencies)).toBe(0);
    const body = JSON.parse(stdout) as { agents: Array<{ id: string }> };
    expect(body.agents.map(({ id }) => id)).toEqual([
      'orchestrator', 'explorer', 'librarian', 'oracle', 'fixer', 'designer', 'observer',
    ]);
    expect(body.agents.some(({ id }) => id === 'critic')).toBe(false);

    stdout = '';
    const inspected = parseAgentCommand(['inspect', 'critic', '--json']);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(await runAgentCommand(inspected.value, dependencies)).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ requestedRole: 'critic', canonicalId: 'oracle' });
    expect(stderr).toBe('');
  });

  test('fails install clearly when host custom-agent capability is unproven', async () => {
    let stderr = '';
    const parsed = parseAgentCommand(['install', '--scope', 'project']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const code = await runAgentCommand(parsed.value, {
      workspaceRoot: '/workspace',
      loadCapabilityProfile: async () => err(runtimeError('E_CAPABILITY_UNPROVEN', 'custom agents unavailable')),
      stdout: () => undefined,
      stderr: (value) => { stderr += value; },
    });
    expect(code).toBe(1);
    expect(stderr).toContain('E_CAPABILITY_UNPROVEN');
  });
});
