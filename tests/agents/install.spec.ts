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
  CANONICAL_OMA_MCP_SERVER_ENTRY,
} from '../../src/agents/install';
import { CANONICAL_AGENT_IDS_V1 } from '../../src/agents/types';
import { sha256 } from '../../src/runtime/atomic';
import { canonicalBytesV1 } from '../../src/contracts/state-schemas';
import { renderAllCanonicalAgents } from '../../src/agents/render-markdown-agent';

const REQUIRED = [
  'custom_agent.markdown',
  'custom_agent.main_agent',
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
      capability: 'custom_agent.subagent',
      source: 'live_probe',
      tier: 'verified',
      result: 'positive',
      observedAt: now,
      identityDigest,
      detailCode: 'LIVE_CUSTOM_AGENT_VERIFIED',
      diagnostic: null,
    });
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
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-user-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-home-'));
    try {
      const first = installNativeAgents({
        scope: 'user',
        workspaceRoot: workspace,
        homeDir: home,
        capabilityProfile: supportedProfile(true),
        now: () => new Date('2026-08-30T01:00:00.000Z'),
        idFactory: () => 'tx-user',
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
      expect(orchestrator).not.toContain('mcpServers:');
      expect(first.value.mcpConfigPath).toBe(path.join(home, '.gemini', 'config', 'mcp_config.json'));
      expect(orchestrator).toContain('delegation.plan');
      expect(orchestrator).toContain('delegation.reconcile');
      expect(fs.existsSync(path.join(first.value.agentsRoot, 'reviewer'))).toBe(false);
      expect(fs.existsSync(first.value.receiptPath)).toBe(true);

      const second = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.value.idempotent).toBe(true);
      const doctor = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(doctor.status).toBe('healthy');
      expect(doctor.delegation.status).toBe('available');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('fresh install for project scope fails closed because project MCP binding is unproven', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-project-mcp-'));
    try {
      const installed = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(true),
      });
      expect(installed.ok).toBe(false);
      if (!installed.ok) {
        expect(installed.error.code).toBe('E_CAPABILITY_UNPROVEN');
        expect(installed.error.message).toContain('project-scope MCP binding is unproven');
      }
      expect(fs.existsSync(path.join(workspace, '.agents'))).toBe(false);

      const doctor = doctorNativeAgentInstallation({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(true),
      });
      expect(doctor.status).toBe('missing');
      expect(doctor.delegation.status).toBe('unavailable');
      expect(doctor.delegation.diagnostic).toContain('project-scope MCP binding is unproven');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('fresh install fails closed when native delegation is unproven and leaves no files', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-no-delegation-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-no-del-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(installed.ok).toBe(false);
      if (!installed.ok) {
        expect(installed.error.code).toBe('E_CAPABILITY_UNPROVEN');
        expect(installed.error.message).toContain('delegation is unavailable');
      }
      expect(fs.existsSync(path.join(home, '.gemini', 'config', 'agents'))).toBe(false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('existing valid OMA install safely remediates when delegation becomes unavailable and can upgrade back', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-remediation-ws-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-remediation-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          foreign_server: { command: 'node', args: ['foreign.js'] },
        },
      }, null, 2), 'utf8');

      // 1. Initial valid install with full delegation
      const first = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.delegation.status).toBe('available');
      expect(first.value.remediated).toBe(false);
      const orchestratorFull = fs.readFileSync(path.join(first.value.agentsRoot, 'orchestrator', 'agent.md'), 'utf8');
      expect(orchestratorFull).toContain('invoke_subagent');
      expect(orchestratorFull).toContain('delegation.plan');
      const mcpWithOma = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(mcpWithOma.mcpServers['oh-my-agy-agents']).toBeDefined();
      expect(mcpWithOma.mcpServers['foreign_server']).toBeDefined();

      // 2. Delegation becomes unavailable -> safe remediation transaction
      const remediation = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(remediation.ok).toBe(true);
      if (!remediation.ok) return;
      expect(remediation.value.remediated).toBe(true);
      expect(remediation.value.idempotent).toBe(false);
      expect(remediation.value.delegation.status).toBe('unavailable');
      expect(remediation.value.mcpConfigPath).toBeNull();
      const orchestratorBase = fs.readFileSync(path.join(remediation.value.agentsRoot, 'orchestrator', 'agent.md'), 'utf8');
      expect(orchestratorBase).not.toContain('invoke_subagent');
      expect(orchestratorBase).not.toContain('delegation.plan');
      // OMA MCP server removed, foreign preserved
      const mcpRemediated = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(mcpRemediated.mcpServers['oh-my-agy-agents']).toBeUndefined();
      expect(mcpRemediated.mcpServers['foreign_server']).toBeDefined();
      const doctorRemediated = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(doctorRemediated.status).toBe('unsupported');
      expect(doctorRemediated.exitCode).toBe(1);

      // 3. Rerun under unavailable delegation is idempotent
      const rerun = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(rerun.ok).toBe(true);
      if (rerun.ok) {
        expect(rerun.value.idempotent).toBe(true);
        expect(rerun.value.remediated).toBe(false);
      }

      // 4. Delegation becomes available again -> upgrades back to full orchestrator + owned MCP
      const upgrade = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(upgrade.ok).toBe(true);
      if (!upgrade.ok) return;
      expect(upgrade.value.idempotent).toBe(false);
      expect(upgrade.value.remediated).toBe(false);
      expect(upgrade.value.delegation.status).toBe('available');
      const orchestratorUpgraded = fs.readFileSync(path.join(upgrade.value.agentsRoot, 'orchestrator', 'agent.md'), 'utf8');
      expect(orchestratorUpgraded).toContain('invoke_subagent');
      expect(orchestratorUpgraded).toContain('delegation.plan');
      const mcpUpgraded = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(mcpUpgraded.mcpServers['oh-my-agy-agents']).toBeDefined();
      expect(mcpUpgraded.mcpServers['foreign_server']).toBeDefined();
      const doctorUpgraded = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(doctorUpgraded.status).toBe('healthy');
      expect(doctorUpgraded.exitCode).toBe(0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('remediation preserves drifted/foreign same-name MCP entry per ownership contract', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-remediation-drift-ws-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-remediation-drift-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });

      // Install with delegation
      const first = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(first.ok).toBe(true);

      // User customizes oh-my-agy-agents entry
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': { command: 'custom-wrapper', args: ['run'] },
        },
      }, null, 2), 'utf8');

      // Remediate -> does not delete user modified entry
      const remediation = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(remediation.ok).toBe(true);
      const mcpAfter = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(mcpAfter.mcpServers['oh-my-agy-agents']).toEqual({
        command: 'custom-wrapper',
        args: ['run'],
      });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('P1-H2: existing install with no MCP receipt remediates posture when delegation becomes unavailable', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-p1h2-ws-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-p1h2-home-'));
    try {
      const agentsRoot = resolveNativeAgentRoot('user', workspace, home);
      fs.mkdirSync(agentsRoot, { recursive: true });
      const renderOptions = { nativeDelegationAvailable: true, modelProjectionAvailable: false, commandExecutionPolicyAvailable: false };
      const agents = renderAllCanonicalAgents(renderOptions);
      for (const agent of agents) {
        const agentDir = path.join(agentsRoot, agent.id);
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'agent.md'), agent.markdown, 'utf8');
      }
      const files = agents.map((agent: any) => ({
        id: agent.id,
        path: `${agent.id}/agent.md`,
        sha256: sha256(agent.markdown),
      }));
      const receiptDir = path.join(agentsRoot, '.oma');
      fs.mkdirSync(receiptDir, { recursive: true });
      const receiptPath = path.join(receiptDir, 'receipt.json');
      const baseReceipt = {
        schema: 'oma.agent-install-receipt/v1' as const,
        scope: 'user' as const,
        transactionId: 'tx-seed',
        installedAt: '2026-08-30T00:00:00.000Z',
        files,
        mcpConfigPath: null,
        mcpServer: null,
      };
      const seededReceipt = { ...baseReceipt, receiptDigest: sha256(canonicalBytesV1(baseReceipt)) };
      fs.writeFileSync(receiptPath, JSON.stringify(seededReceipt, null, 2), 'utf8');

      // Now run installNativeAgents when delegation is unavailable
      const remediation = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(remediation.ok).toBe(true);
      if (!remediation.ok) return;
      expect(remediation.value.remediated).toBe(true);
      expect(remediation.value.idempotent).toBe(false);
      expect(remediation.value.delegation.status).toBe('unavailable');

      const orchestrator = fs.readFileSync(path.join(agentsRoot, 'orchestrator', 'agent.md'), 'utf8');
      expect(orchestrator).not.toContain('invoke_subagent');
      expect(orchestrator).not.toContain('delegation.plan');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('P0-H3: remediated/no-MCP receipt refuses silent adoption of exact-canonical foreign MCP entry when delegation is restored', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-p0h3-ws-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-p0h3-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });

      // 1. Initial valid install with full delegation
      const first = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(first.ok).toBe(true);

      // 2. Remediate -> receipt now has mcpServer: null and mcpConfigPath: null
      const remediated = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(remediated.ok).toBe(true);
      if (!remediated.ok) return;
      expect(remediated.value.receipt.mcpServer).toBeNull();

      // 3. User or 3rd party creates an exact-canonical oh-my-agy-agents entry in mcp_config.json
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': { ...CANONICAL_OMA_MCP_SERVER_ENTRY },
        },
      }, null, 2), 'utf8');

      // 4. Delegation is restored -> upgrade attempt MUST fail closed instead of silently adopting the unowned entry
      const upgrade = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(upgrade.ok).toBe(false);
      if (!upgrade.ok) {
        expect(upgrade.error.code).toBe('E_ALREADY_EXISTS');
        expect(upgrade.error.message).toContain('Refusing to adopt unowned MCP server entry during upgrade');
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
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
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-collision-home-'));
    try {
      const root = resolveNativeAgentRoot('user', workspace, home);
      const target = path.join(root, 'oracle', 'agent.md');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'user-owned\n', 'utf8');
      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('E_ALREADY_EXISTS');
      expect(fs.readFileSync(target, 'utf8')).toBe('user-owned\n');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('rejects symlinked install ancestry instead of following it outside the workspace', () => {
    if (process.platform === 'win32') return;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-symlink-workspace-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-symlink-outside-'));
    try {
      fs.symlinkSync(outside, path.join(workspace, '.agents'), 'dir');
      const result = installNativeAgents({
        scope: 'project', workspaceRoot: workspace, capabilityProfile: supportedProfile(true),
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
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-drift-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;
      const target = path.join(installed.value.agentsRoot, 'fixer', 'agent.md');
      fs.appendFileSync(target, '\nuser edit\n', 'utf8');
      expect(doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      }).status).toBe('drifted');
      const reinstall = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(reinstall.ok).toBe(false);
      if (!reinstall.ok) expect(reinstall.error.code).toBe('E_PROJECTION_HASH_MISMATCH');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('succeeds and omits optional model and commandExecutionPolicy when they are unknown', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-optional-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-optional-home-'));
    try {
      const result = installNativeAgents({
        scope: 'user',
        workspaceRoot: workspace,
        homeDir: home,
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
      fs.rmSync(home, { recursive: true, force: true });
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
        expect(result.error.message).toContain('custom_agent.main_agent');
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('user-scope install writes oh-my-agy-agents to global MCP config and preserves foreign entries', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'foreign-server': { command: 'foreign', args: ['--run'] }
        }
      }), 'utf8');
      
      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      
      const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(mcpConfig.mcpServers['foreign-server']).toEqual({ command: 'foreign', args: ['--run'] });
      expect(mcpConfig.mcpServers['oh-my-agy-agents']).toEqual({ command: 'oma', args: ['agents', 'mcp-server'] });
      expect(result.value.mcpConfigPath).toBe(mcpConfigPath);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('user-scope install is idempotent for MCP config', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-idem-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-idem-home-'));
    try {
      const first = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(first.ok).toBe(true);
      
      const second = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.value.idempotent).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('doctor detects missing MCP config entry for user-scope', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-doctor-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-doctor-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      const mcpConfigPath = installed.value.mcpConfigPath;
      expect(mcpConfigPath).not.toBeNull();
      if (mcpConfigPath) {
        fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }), 'utf8');
      }

      const doctor = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(doctor.status).toBe('drifted');
      expect(doctor.diagnostics.some(d => d.includes('oh-my-agy-agents'))).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('orchestrator markdown contains no agent-local mcpServers', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-orch-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-orch-home-'));
    try {
      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const orchestrator = fs.readFileSync(path.join(result.value.agentsRoot, 'orchestrator', 'agent.md'), 'utf8');
      expect(orchestrator).not.toContain('mcpServers:');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('foreign oh-my-agy-agents collision fails closed with E_ALREADY_EXISTS', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-collision-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-collision-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': { command: 'foreign-oma', args: ['--custom'] },
        },
      }), 'utf8');

      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E_ALREADY_EXISTS');
        expect(result.error.message).toContain('oh-my-agy-agents');
      }
      // Verify foreign config is preserved
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['oh-my-agy-agents']).toEqual({ command: 'foreign-oma', args: ['--custom'] });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('install failure restores MCP config and agent files to prior state', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-rollback-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-rollback-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      const initialMcpConfig = {
        mcpServers: {
          'existing-server': { command: 'node', args: ['server.js'] },
        },
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(initialMcpConfig), 'utf8');

      // Pre-seed an invalid unowned agent file to cause an install error or corrupt receipt path
      const agentsRoot = path.join(home, '.gemini', 'config', 'agents');
      const receiptDir = path.join(agentsRoot, '.oma');
      fs.mkdirSync(receiptDir, { recursive: true });
      // Create a directory where receipt.json should be, making atomicWriteJson throw
      fs.mkdirSync(path.join(receiptDir, 'receipt.json'));

      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);

      // Verify MCP config was restored to initial state
      const restoredConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(restoredConfig).toEqual(initialMcpConfig);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads legacy agent receipt without mcp fields successfully', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-legacy-receipt-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-legacy-receipt-home-'));
    try {
      // First do a normal install
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      // Now rewrite the receipt to legacy format (without mcpConfigPath and mcpServer)
      const receiptPath = path.join(installed.value.agentsRoot, '.oma', 'receipt.json');
      const current = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));

      const legacyBase = {
        schema: current.schema,
        scope: current.scope,
        transactionId: current.transactionId,
        installedAt: current.installedAt,
        files: current.files,
      };
      const legacyReceipt = {
        ...legacyBase,
        receiptDigest: sha256(canonicalBytesV1(legacyBase)),
      };
      fs.writeFileSync(receiptPath, JSON.stringify(legacyReceipt, null, 2), 'utf8');

      // Doctor should be able to read this legacy receipt without throwing E_CORRUPT_STATE
      const doctor = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(doctor.status).toBe('healthy');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('legacy receipt upgrade explicitly migrates pre-existing exact canonical MCP entry', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-legacy-mig-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-legacy-mig-home-'));
    try {
      // First install to user scope
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      // Rewrite receipt to legacy shape (without mcpConfigPath / mcpServer)
      const receiptPath = path.join(installed.value.agentsRoot, '.oma', 'receipt.json');
      const current = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const { canonicalBytesV1 } = require('../../src/contracts/state-schemas');
      const { sha256 } = require('../../src/runtime/atomic');

      const legacyBase = {
        schema: current.schema,
        scope: current.scope,
        transactionId: current.transactionId,
        installedAt: current.installedAt,
        files: current.files,
      };
      const legacyReceipt = {
        ...legacyBase,
        receiptDigest: sha256(canonicalBytesV1(legacyBase)),
      };
      fs.writeFileSync(receiptPath, JSON.stringify(legacyReceipt, null, 2), 'utf8');

      // Global mcp_config.json already has exact canonical entry
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      expect(fs.existsSync(mcpConfigPath)).toBe(true);

      // Re-install (upgrade path) should explicitly migrate and adopt the canonical entry
      const upgrade = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(upgrade.ok).toBe(true);
      if (!upgrade.ok) return;
      expect(upgrade.value.legacyMcpMigrated).toBe(true);
      expect(upgrade.value.idempotent).toBe(false);
      expect(upgrade.value.receipt.mcpServer).toBeDefined();

      // Subsequent install is now cleanly idempotent
      const nextRun = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(nextRun.ok).toBe(true);
      if (nextRun.ok) {
        expect(nextRun.value.idempotent).toBe(true);
        expect(nextRun.value.legacyMcpMigrated).toBe(false);
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('legacy receipt upgrade fails closed when pre-existing MCP entry is non-canonical', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-legacy-drift-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-legacy-drift-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      // Rewrite receipt to legacy shape
      const receiptPath = path.join(installed.value.agentsRoot, '.oma', 'receipt.json');
      const current = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const { canonicalBytesV1 } = require('../../src/contracts/state-schemas');
      const { sha256 } = require('../../src/runtime/atomic');

      const legacyBase = {
        schema: current.schema,
        scope: current.scope,
        transactionId: current.transactionId,
        installedAt: current.installedAt,
        files: current.files,
      };
      const legacyReceipt = {
        ...legacyBase,
        receiptDigest: sha256(canonicalBytesV1(legacyBase)),
      };
      fs.writeFileSync(receiptPath, JSON.stringify(legacyReceipt, null, 2), 'utf8');

      // Pre-seed a drifted / foreign entry in mcp_config.json
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': { command: 'foreign-oma', args: ['--custom'] },
        },
      }), 'utf8');

      // Upgrade should fail closed
      const upgrade = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(upgrade.ok).toBe(false);
      if (!upgrade.ok) {
        expect(upgrade.error.code).toBe('E_ALREADY_EXISTS');
        expect(upgrade.error.message).toContain('Refusing to adopt non-canonical MCP server entry during legacy migration');
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('doctor detects drifted MCP entry when extra args or wrong command are present', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-drift-args-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-drift-args-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      const mcpConfigPath = installed.value.mcpConfigPath;
      expect(mcpConfigPath).not.toBeNull();
      if (mcpConfigPath) {
        // Add extra unexpected arg
        fs.writeFileSync(mcpConfigPath, JSON.stringify({
          mcpServers: {
            'oh-my-agy-agents': { command: 'oma', args: ['agents', 'mcp-server', '--extra'] },
          },
        }), 'utf8');
      }

      const doctor = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(doctor.status).toBe('drifted');
      expect(doctor.diagnostics.some((d) => d.includes('drifted'))).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('reinstall repairs missing MCP entry and does not claim false-idempotent', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-repair-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-repair-home-'));
    try {
      const first = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const mcpConfigPath = first.value.mcpConfigPath!;
      // Delete MCP entry externally
      fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }), 'utf8');

      // Re-install should NOT claim idempotent, and should repair the entry
      const second = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.idempotent).toBe(false);

      // Verify entry was restored
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['oh-my-agy-agents']).toEqual({ command: 'oma', args: ['agents', 'mcp-server'] });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('rejects symlinked MCP config path', () => {
    if (process.platform === 'win32') return;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-sym-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-sym-home-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-sym-outside-'));
    try {
      const configDir = path.join(home, '.gemini', 'config');
      fs.mkdirSync(configDir, { recursive: true });
      const outsideFile = path.join(outside, 'mcp_config.json');
      fs.writeFileSync(outsideFile, JSON.stringify({ mcpServers: {} }), 'utf8');
      fs.symlinkSync(outsideFile, path.join(configDir, 'mcp_config.json'));

      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E_PATH_OUTSIDE_ROOT');
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('uninstall removes owned agents and owned MCP entry while preserving foreign entries', async () => {
    const { uninstallNativeAgents } = await import('../../src/agents/install');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-uninstall-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-uninstall-home-'));
    try {
      // Pre-seed a foreign entry
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'foreign-server': { command: 'foreign', args: ['--run'] },
        },
      }), 'utf8');

      // Install
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      // Uninstall
      const uninstalled = uninstallNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home,
      });
      expect(uninstalled.ok).toBe(true);
      if (!uninstalled.ok) return;
      expect(uninstalled.value.status).toBe('uninstalled');
      expect(uninstalled.value.collisions).toEqual([]);

      // Agent files should be deleted
      for (const id of CANONICAL_AGENT_IDS_V1) {
        expect(fs.existsSync(path.join(installed.value.agentsRoot, id, 'agent.md'))).toBe(false);
      }
      // Receipt should be deleted
      expect(fs.existsSync(installed.value.receiptPath)).toBe(false);

      // Foreign MCP entry preserved, OMA MCP entry removed
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['foreign-server']).toEqual({ command: 'foreign', args: ['--run'] });
      expect(config.mcpServers['oh-my-agy-agents']).toBeUndefined();
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('foreign oh-my-agy-agents collision (even exact canonical) without prior receipt fails closed', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-exact-collision-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-exact-collision-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      // Pre-seed an EXACT canonical entry without any OMA receipt
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': { command: 'oma', args: ['agents', 'mcp-server'] },
        },
      }), 'utf8');

      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E_ALREADY_EXISTS');
        expect(result.error.message).toContain('Refusing to overwrite or adopt');
      }
      // Verify foreign config is preserved
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['oh-my-agy-agents']).toEqual({ command: 'oma', args: ['agents', 'mcp-server'] });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('extra fields in MCP entry are treated as foreign/drifted and preserved on uninstall', async () => {
    const { uninstallNativeAgents } = await import('../../src/agents/install');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-extra-fields-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-extra-fields-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      const mcpConfigPath = installed.value.mcpConfigPath!;
      // Mutate entry by adding extra fields
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': {
            command: 'oma',
            args: ['agents', 'mcp-server'],
            env: { USER_CUSTOM: '1' },
          },
        },
      }), 'utf8');

      // Doctor detects drift
      const doctor = doctorNativeAgentInstallation({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(doctor.status).toBe('drifted');

      // Uninstall preserves this drifted entry
      const uninstalled = uninstallNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home,
      });
      expect(uninstalled.ok).toBe(true);
      if (!uninstalled.ok) return;
      expect(uninstalled.value.status).toBe('completed_with_collisions');
      expect(uninstalled.value.collisions.length).toBeGreaterThan(0);

      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['oh-my-agy-agents']).toEqual({
        command: 'oma',
        args: ['agents', 'mcp-server'],
        env: { USER_CUSTOM: '1' },
      });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('install with delegation unavailable does not claim MCP ownership and uninstall never deletes foreign entry', async () => {
    const { uninstallNativeAgents } = await import('../../src/agents/install');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-no-del-mcp-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-no-del-mcp-home-'));
    try {
      // Pre-seed an entry in global config
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      const initialEntry = { command: 'foreign-oma', args: ['custom'] };
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'foreign-server': initialEntry,
        },
      }), 'utf8');

      // 1. Fresh install with delegation
      const first = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(true),
      });
      expect(first.ok).toBe(true);

      // 2. Remediate -> receipt.mcpServer becomes null
      const remediated = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(false),
      });
      expect(remediated.ok).toBe(true);
      if (!remediated.ok) return;
      expect(remediated.value.receipt.mcpServer).toBeNull();

      // Now pre-seed an unowned canonical entry as if user or other tool created it
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'foreign-server': initialEntry,
          'oh-my-agy-agents': { command: 'oma', args: ['agents', 'mcp-server'] },
        },
      }), 'utf8');

      // Uninstall should NOT touch mcp_config.json because receipt has mcpServer: null
      const uninstalled = uninstallNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home,
      });
      expect(uninstalled.ok).toBe(true);

      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['oh-my-agy-agents']).toBeDefined();
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('symlinked MCP config path fails before snapshot/mutation, leaving target unchanged', () => {
    if (process.platform === 'win32') return;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-sym-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-sym-home-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-sym-outside-'));
    try {
      const configDir = path.join(home, '.gemini', 'config');
      fs.mkdirSync(configDir, { recursive: true });
      const outsideFile = path.join(outside, 'mcp_config.json');
      const outsideContent = JSON.stringify({ mcpServers: { 'outside-server': { command: 'ext' } } });
      fs.writeFileSync(outsideFile, outsideContent, 'utf8');
      fs.symlinkSync(outsideFile, path.join(configDir, 'mcp_config.json'));

      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E_PATH_OUTSIDE_ROOT');
      }
      // Outside file must be completely untouched
      expect(fs.readFileSync(outsideFile, 'utf8')).toBe(outsideContent);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('malformed mcpServers container fails closed and preserves original bytes', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-malformed-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-mcp-malformed-home-'));
    try {
      const mcpConfigDir = path.join(home, '.gemini', 'config');
      const mcpConfigPath = path.join(mcpConfigDir, 'mcp_config.json');
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      const rawContent = JSON.stringify({ mcpServers: 'invalid-string-container' });
      fs.writeFileSync(mcpConfigPath, rawContent, 'utf8');

      const result = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E_CORRUPT_STATE');
      }
      expect(fs.readFileSync(mcpConfigPath, 'utf8')).toBe(rawContent);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('uninstall preserves drifted/modified MCP entry as a collision', async () => {
    const { uninstallNativeAgents } = await import('../../src/agents/install');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-uninstall-drift-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-uninstall-drift-home-'));
    try {
      const installed = installNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home, capabilityProfile: supportedProfile(),
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      const mcpConfigPath = installed.value.mcpConfigPath!;
      // Modify MCP entry externally
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: {
          'oh-my-agy-agents': { command: 'user-modified', args: [] },
        },
      }), 'utf8');

      // Uninstall should preserve user-modified entry
      const uninstalled = uninstallNativeAgents({
        scope: 'user', workspaceRoot: workspace, homeDir: home,
      });
      expect(uninstalled.ok).toBe(true);
      if (!uninstalled.ok) return;
      expect(uninstalled.value.status).toBe('completed_with_collisions');
      expect(uninstalled.value.collisions.length).toBeGreaterThan(0);

      // User modified config is preserved
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      expect(config.mcpServers['oh-my-agy-agents']).toEqual({ command: 'user-modified', args: [] });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
