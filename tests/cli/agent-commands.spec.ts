import { parseAgentCommand, runAgentCommand } from '../../src/cli/agent-commands';
import { err } from '../../src/runtime/types';
import { runtimeError } from '../../src/runtime/errors';

describe('oma agents command contract', () => {
  test('parses list, inspect, install, uninstall, doctor and private mcp-server', () => {
    expect(parseAgentCommand(['list'])).toEqual({ ok: true, value: { kind: 'list', asJson: false } });
    expect(parseAgentCommand(['inspect', 'critic', '--json'])).toEqual({
      ok: true,
      value: { kind: 'inspect', role: 'critic', asJson: true },
    });
    expect(parseAgentCommand(['install', '--scope', 'user'])).toEqual({
      ok: true,
      value: { kind: 'install', scope: 'user', asJson: false },
    });
    expect(parseAgentCommand(['uninstall', '--scope', 'user'])).toEqual({
      ok: true,
      value: { kind: 'uninstall', scope: 'user', asJson: false },
    });
    expect(parseAgentCommand(['doctor'])).toEqual({
      ok: true,
      value: { kind: 'doctor', scope: 'project', asJson: false },
    });
    expect(parseAgentCommand(['mcp-server'])).toEqual({
      ok: true,
      value: { kind: 'mcp-server' },
    });
  });

  test('rejects unsafe or ambiguous argv', () => {
    expect(parseAgentCommand(['install']).ok).toBe(false);
    expect(parseAgentCommand(['install', '--scope', 'global']).ok).toBe(false);
    expect(parseAgentCommand(['inspect', 'oracle', 'extra']).ok).toBe(false);
    expect(parseAgentCommand(['list', '--json', '--json']).ok).toBe(false);
    expect(parseAgentCommand(['mcp-server', '--json']).ok).toBe(false);
  });

  test('runs the private delegation MCP server without probing host capabilities', async () => {
    let started = 0;
    let capabilityLoads = 0;
    const parsed = parseAgentCommand(['mcp-server']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const code = await runAgentCommand(parsed.value, {
      workspaceRoot: '/workspace',
      loadCapabilityProfile: async () => {
        capabilityLoads += 1;
        return err(runtimeError('E_CAPABILITY_UNPROVEN', 'must not be called'));
      },
      startDelegationMcpServer: async () => {
        started += 1;
        return 0;
      },
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(started).toBe(1);
    expect(capabilityLoads).toBe(0);
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

  test('reports remediation clearly in text and JSON output when delegation is unavailable on existing install', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const { assembleHostCapabilityProfile, hostCapabilityIdentityDigest } = await import('../../src/native/capability-profile');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-cli-agent-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-cli-agent-home-'));

    const host = {
      realpath: '/usr/local/bin/agy',
      binarySha256: 'a'.repeat(64),
      version: '1.1.11',
      versionOutputSha256: 'b'.repeat(64),
      helpOutputSha256: 'c'.repeat(64),
      platform: 'linux' as const,
      arch: 'x64',
    };
    const plugin = {
      status: 'absent' as const,
      realpath: null,
      packageDigest: null,
      version: null,
      readbackDigest: null,
      enabled: false,
    };
    const identityDigest = hostCapabilityIdentityDigest(host, plugin);

    const makeProfile = (delegation: boolean) => assembleHostCapabilityProfile({
      evaluationTimestamp: '2026-08-31T00:00:00.000Z',
      hostIdentityBefore: host,
      hostIdentityAfter: host,
      pluginIdentityBefore: plugin,
      pluginIdentityAfter: plugin,
      observations: [
        { capability: 'custom_agent.markdown', source: 'help', tier: 'observed', result: 'positive', observedAt: '2026-08-31T00:00:00.000Z', identityDigest, detailCode: 'T', diagnostic: null },
        { capability: 'custom_agent.main_agent', source: 'help', tier: 'observed', result: 'positive', observedAt: '2026-08-31T00:00:00.000Z', identityDigest, detailCode: 'T', diagnostic: null },
        ...(delegation ? [
          { capability: 'custom_agent.subagent', source: 'live_probe' as const, tier: 'verified' as const, result: 'positive' as const, observedAt: '2026-08-31T00:00:00.000Z', identityDigest, detailCode: 'T', diagnostic: null },
          { capability: 'subagent.invoke', source: 'live_probe' as const, tier: 'verified' as const, result: 'positive' as const, observedAt: '2026-08-31T00:00:00.000Z', identityDigest, detailCode: 'T', diagnostic: null },
        ] : []),
      ],
    });

    try {
      // 1. First install with delegation
      const firstCommand = parseAgentCommand(['install', '--scope', 'user']);
      expect(firstCommand.ok).toBe(true);
      if (!firstCommand.ok) return;
      let stdout = '';
      let stderr = '';
      const code1 = await runAgentCommand(firstCommand.value, {
        workspaceRoot: workspace,
        homeDir: home,
        loadCapabilityProfile: async () => ({ ok: true, value: makeProfile(true) }),
        stdout: (val) => { stdout += val; },
        stderr: (val) => { stderr += val; },
      });
      expect(code1).toBe(0);
      expect(stdout).toContain('installed 7 canonical agents');

      // 2. Remediate in text mode
      stdout = '';
      stderr = '';
      const code2 = await runAgentCommand(firstCommand.value, {
        workspaceRoot: workspace,
        homeDir: home,
        loadCapabilityProfile: async () => ({ ok: true, value: makeProfile(false) }),
        stdout: (val) => { stdout += val; },
        stderr: (val) => { stderr += val; },
      });
      expect(code2).toBe(0);
      expect(stdout).toContain('remediated (native delegation unavailable) 7 canonical agents');
      expect(stdout).not.toContain('installed 7 canonical agents');

      // 3. Remediate in JSON mode on rerun
      const jsonCommand = parseAgentCommand(['install', '--scope', 'user', '--json']);
      expect(jsonCommand.ok).toBe(true);
      if (!jsonCommand.ok) return;
      stdout = '';
      stderr = '';
      const code3 = await runAgentCommand(jsonCommand.value, {
        workspaceRoot: workspace,
        homeDir: home,
        loadCapabilityProfile: async () => ({ ok: true, value: makeProfile(false) }),
        stdout: (val) => { stdout += val; },
        stderr: (val) => { stderr += val; },
      });
      expect(code3).toBe(0);
      const json = JSON.parse(stdout);
      expect(json).toMatchObject({
        schema: 'oma.agents-install/v1',
        ok: true,
        idempotent: true,
        remediated: false,
        delegation: { status: 'unavailable' },
      });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
