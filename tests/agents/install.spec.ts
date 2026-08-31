import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CapabilityObservationV1,
  HostIdentityV1,
  PluginIdentityV1,
  assembleHostCapabilityProfile,
  hostCapabilityIdentityDigest,
} from '../../src/native/capability-profile';
import {
  doctorNativeAgentInstallation,
  installNativeAgents,
  resolveNativeAgentRoot,
} from '../../src/agents/install';
import { CANONICAL_AGENT_IDS_V1 } from '../../src/agents/types';

const REQUIRED = [
  'custom_agent.markdown',
  'custom_agent.main_agent',
  'custom_agent.subagent',
] as const;

function supportedProfile(nativeDelegation = true) {
  const now = '2026-08-30T00:00:00.000Z';
  const host: HostIdentityV1 = {
    realpath: '/usr/local/bin/agy',
    binarySha256: 'a'.repeat(64),
    version: '1.1.11',
    versionOutputSha256: 'b'.repeat(64),
    helpOutputSha256: 'c'.repeat(64),
    platform: 'linux',
    arch: 'x64',
  };
  const plugin: PluginIdentityV1 = {
    status: 'absent',
    realpath: null,
    packageDigest: null,
    version: null,
    readbackDigest: null,
    enabled: false,
  };
  const identityDigest = hostCapabilityIdentityDigest(host, plugin);
  const observations: CapabilityObservationV1[] = REQUIRED.map((capability) => ({
    capability,
    source: 'help',
    tier: 'observed',
    result: 'positive',
    observedAt: now,
    identityDigest,
    detailCode: 'TEST_SUPPORTED',
    diagnostic: null,
  }));
  if (nativeDelegation) {
    observations.push({
      capability: 'subagent.invoke',
      source: 'live_probe',
      tier: 'verified',
      result: 'positive',
      observedAt: now,
      identityDigest,
      detailCode: 'TEST_SUBAGENT_INVOKE',
      diagnostic: null,
    });
  }
  return assembleHostCapabilityProfile({
    evaluationTimestamp: now,
    hostIdentityBefore: host,
    hostIdentityAfter: host,
    pluginIdentityBefore: plugin,
    pluginIdentityAfter: plugin,
    observations,
  });
}

describe('native agent installation', () => {
  test('installs capability-proven orchestrator delegation and is idempotent by ownership receipt', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-project-'));
    try {
      const first = installNativeAgents({
        scope: 'project',
        workspaceRoot: workspace,
        capabilityProfile: supportedProfile(),
        now: () => new Date('2026-08-30T01:00:00.000Z'),
        idFactory: () => 'tx-project',
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.idempotent).toBe(false);
      expect(first.value.delegation.status).toBe('available');
      for (const id of CANONICAL_AGENT_IDS_V1) {
        expect(fs.existsSync(path.join(first.value.agentsRoot, id, 'agent.md'))).toBe(true);
      }
      const orchestrator = fs.readFileSync(
        path.join(first.value.agentsRoot, 'orchestrator', 'agent.md'),
        'utf8',
      );
      expect(orchestrator).toContain('  - invoke_subagent');
      expect(orchestrator).toContain('mcpServers:\n  oh-my-agy-agents:\n    command: oma');
      expect(orchestrator).toContain('      - agents\n      - mcp-server');
      expect(orchestrator).not.toContain('mcpServers:\n  oh-my-agy:\n');
      expect(orchestrator).not.toContain('inheritMcp');
      expect(orchestrator).toContain('delegation.plan');
      expect(orchestrator).toContain('delegation.reconcile');
      expect(fs.existsSync(path.join(first.value.agentsRoot, 'reviewer'))).toBe(false);
      expect(fs.existsSync(first.value.receiptPath)).toBe(true);

      const second = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.value.idempotent).toBe(true);
      const doctor = doctorNativeAgentInstallation({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      });
      expect(doctor.status).toBe('healthy');
      expect(doctor.delegation.status).toBe('available');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('installs non-delegating agents but reports unsupported when native invoke is unproven', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-no-delegation-'));
    try {
      const installed = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(false),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;
      expect(installed.value.delegation.status).toBe('unavailable');
      const orchestrator = fs.readFileSync(
        path.join(installed.value.agentsRoot, 'orchestrator', 'agent.md'),
        'utf8',
      );
      expect(orchestrator).not.toContain('invoke_subagent');
      expect(orchestrator).not.toContain('mcpServers:');
      expect(orchestrator).not.toContain('delegation.plan');
      const doctor = doctorNativeAgentInstallation({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(false),
      });
      expect(doctor.status).toBe('unsupported');
      expect(doctor.exitCode).toBe(1);
      expect(doctor.delegation.diagnostic).toContain('subagent.invoke');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('uses the documented Antigravity global agents directory for user scope', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-workspace-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      expect(resolveNativeAgentRoot('user', workspace, home))
        .toBe(path.join(home, '.gemini', 'config', 'agents'));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('fails closed instead of overwriting an unowned canonical agent', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-collision-'));
    try {
      const root = resolveNativeAgentRoot('project', workspace);
      const target = path.join(root, 'oracle', 'agent.md');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'user-owned\n', 'utf8');
      const result = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('E_ALREADY_EXISTS');
      expect(fs.readFileSync(target, 'utf8')).toBe('user-owned\n');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rejects symlinked install ancestry instead of following it outside the workspace', () => {
    if (process.platform === 'win32') return;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-symlink-workspace-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-symlink-outside-'));
    try {
      fs.symlinkSync(outside, path.join(workspace, '.agents'), 'dir');
      const result = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('E_PATH_OUTSIDE_ROOT');
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('detects external edits and refuses to claim them on reinstall', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-drift-'));
    try {
      const installed = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;
      const target = path.join(installed.value.agentsRoot, 'fixer', 'agent.md');
      fs.appendFileSync(target, '\nuser edit\n', 'utf8');
      expect(doctorNativeAgentInstallation({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      }).status).toBe('drifted');
      const reinstall = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(),
      });
      expect(reinstall.ok).toBe(false);
      if (!reinstall.ok) expect(reinstall.error.code).toBe('E_PROJECTION_HASH_MISMATCH');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('succeeds and omits optional model and commandExecutionPolicy when they are unknown', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-optional-'));
    try {
      const result = installNativeAgents({
        scope: 'project',
        workspaceRoot: workspace,
        capabilityProfile: supportedProfile(true),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const explorer = fs.readFileSync(path.join(result.value.agentsRoot, 'explorer', 'agent.md'), 'utf8');
      expect(explorer).not.toContain('model:');
      expect(explorer).not.toContain('commandExecutionPolicy:');
      expect(explorer).toContain('tools:\n  - view_file\n  - grep_search\n');

      const fixer = fs.readFileSync(path.join(result.value.agentsRoot, 'fixer', 'agent.md'), 'utf8');
      expect(fixer).not.toContain('model:');
      expect(fixer).not.toContain('commandExecutionPolicy:');
      expect(fixer).toContain('tools:\n  - view_file\n  - grep_search\n  - replace_file_content\n  - run_command\n');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('fails install when a core structural capability is missing', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-missing-core-'));
    try {
      const now = '2026-08-30T00:00:00.000Z';
      const host: HostIdentityV1 = {
        realpath: '/usr/local/bin/agy', binarySha256: 'a'.repeat(64), version: '1.1.11',
        versionOutputSha256: 'b'.repeat(64), helpOutputSha256: 'c'.repeat(64), platform: 'linux', arch: 'x64',
      };
      const plugin: PluginIdentityV1 = {
        status: 'absent', realpath: null, packageDigest: null, version: null, readbackDigest: null, enabled: false,
      };
      const observations: CapabilityObservationV1[] = [
        {
          capability: 'custom_agent.markdown', source: 'help', tier: 'observed', result: 'positive',
          observedAt: now, identityDigest: hostCapabilityIdentityDigest(host, plugin), detailCode: 'T', diagnostic: null,
        },
        {
          capability: 'custom_agent.main_agent', source: 'help', tier: 'observed', result: 'positive',
          observedAt: now, identityDigest: hostCapabilityIdentityDigest(host, plugin), detailCode: 'T', diagnostic: null,
        },
      ];
      const profile = assembleHostCapabilityProfile({
        evaluationTimestamp: now, hostIdentityBefore: host, hostIdentityAfter: host,
        pluginIdentityBefore: plugin, pluginIdentityAfter: plugin, observations,
      });
      const result = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: profile,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E_CAPABILITY_UNPROVEN');
        expect(result.error.message).toContain('custom_agent.subagent');
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
