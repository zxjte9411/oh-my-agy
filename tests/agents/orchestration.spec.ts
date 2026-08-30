import {
  CapabilityObservationV1,
  HostIdentityV1,
  PluginIdentityV1,
  assembleHostCapabilityProfile,
  hostCapabilityIdentityDigest,
} from '../../src/native/capability-profile';
import {
  assessNativeDelegationCapability,
  planNativeDelegation,
} from '../../src/agents/orchestration';

function capabilityProfile(invokeSupported: boolean) {
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
    status: 'present',
    realpath: '/plugin',
    packageDigest: 'd'.repeat(64),
    version: '0.6.0',
    readbackDigest: 'e'.repeat(64),
    enabled: true,
  };
  const identityDigest = hostCapabilityIdentityDigest(host, plugin);
  const observations: CapabilityObservationV1[] = [
    'custom_agent.subagent',
    'custom_agent.inherit_mcp',
    'mcp.local_config',
  ].map((capability) => ({
    capability,
    source: 'help' as const,
    tier: 'observed' as const,
    result: 'positive' as const,
    observedAt: now,
    identityDigest,
    detailCode: 'TEST_NATIVE_DELEGATION_SUPPORT',
    diagnostic: null,
  }));
  if (invokeSupported) {
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

describe('native orchestrator delegation planning', () => {
  test('routes a representative multi-lane task into deterministic dependency waves', () => {
    const result = planNativeDelegation({
      lanes: [
        { id: 'scan', task: 'Locate the implementation seam.', intent: 'codebase-discovery' },
        { id: 'docs', task: 'Check the current framework contract.', intent: 'external-research' },
        { id: 'arch', task: 'Review the proposed architecture.', requestedRole: 'architect' },
        {
          id: 'impl', task: 'Implement the bounded change.', intent: 'implementation',
          dependsOn: ['scan', 'docs', 'arch'],
        },
        { id: 'verify', task: 'Review the completed change.', requestedRole: 'verifier', dependsOn: ['impl'] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lanes.map(({ id, agent, routeReason }) => ({ id, agent, routeReason }))).toEqual([
      { id: 'arch', agent: 'oracle', routeReason: 'requested-role' },
      { id: 'docs', agent: 'librarian', routeReason: 'delegation-intent' },
      { id: 'impl', agent: 'fixer', routeReason: 'delegation-intent' },
      { id: 'scan', agent: 'explorer', routeReason: 'delegation-intent' },
      { id: 'verify', agent: 'oracle', routeReason: 'requested-role' },
    ]);
    expect(result.value.waves).toEqual([
      { index: 0, laneIds: ['arch', 'docs', 'scan'], parallel: true },
      { index: 1, laneIds: ['impl'], parallel: false },
      { index: 2, laneIds: ['verify'], parallel: false },
    ]);
    expect(result.value.lanes.find(({ id }) => id === 'impl')).toMatchObject({
      capabilityFloor: 'read-write', parallelSafe: false, workspace: 'inherit',
    });
    expect(result.value.planDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  test('serializes independent write lanes after ready read-only work', () => {
    const result = planNativeDelegation({
      lanes: [
        { id: 'scan', task: 'Read first.', intent: 'codebase-discovery' },
        { id: 'write-a', task: 'Change A.', intent: 'implementation' },
        { id: 'write-b', task: 'Change B.', intent: 'design' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.waves).toEqual([
      { index: 0, laneIds: ['scan'], parallel: false },
      { index: 1, laneIds: ['write-a'], parallel: false },
      { index: 2, laneIds: ['write-b'], parallel: false },
    ]);
  });

  test('fails closed for unknown explicit roles and leader-only orchestration routes', () => {
    const unknown = planNativeDelegation({
      lanes: [{ id: 'bad', task: 'Do work.', requestedRole: 'wizard', intent: 'implementation' }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.message).toContain('unknown requested agent role');

    const leader = planNativeDelegation({
      lanes: [{ id: 'nested', task: 'Delegate an orchestrator.', intent: 'orchestration' }],
    });
    expect(leader.ok).toBe(false);
    if (!leader.ok) expect(leader.error.message).toContain('leader-only agent orchestrator');
  });

  test('rejects cyclic dependencies instead of guessing an execution order', () => {
    const result = planNativeDelegation({
      lanes: [
        { id: 'a', task: 'A', intent: 'codebase-discovery', dependsOn: ['b'] },
        { id: 'b', task: 'B', intent: 'external-research', dependsOn: ['a'] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('E_TASK_DEPENDENCY_BLOCKED');
  });

  test('requires MCP inheritance and verified native invoke evidence before advertising delegation', () => {
    const available = assessNativeDelegationCapability(capabilityProfile(true));
    expect(available).toMatchObject({ status: 'available', diagnostic: null });
    expect(available.requirements.map(({ capability }) => capability)).toEqual([
      'custom_agent.subagent', 'custom_agent.inherit_mcp', 'mcp.local_config', 'subagent.invoke',
    ]);

    const unavailable = assessNativeDelegationCapability(capabilityProfile(false));
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.diagnostic).toContain('subagent.invoke');
    expect(unavailable.requirements.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ requiredTier: 'verified', satisfied: false });
  });
});
