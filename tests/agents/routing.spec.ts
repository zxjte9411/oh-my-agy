import {
  AGENT_DELEGATION_INTENTS_V1,
  routeAgentDelegation,
} from '../../src/agents/routing';

describe('slim native agent routing', () => {
  test('delegation intents map to the seven canonical agents deterministically', () => {
    const expected = {
      orchestration: 'orchestrator',
      'codebase-discovery': 'explorer',
      'external-research': 'librarian',
      'architecture-review': 'oracle',
      implementation: 'fixer',
      design: 'designer',
      observation: 'observer',
    } as const;

    expect(AGENT_DELEGATION_INTENTS_V1).toHaveLength(7);
    for (const intent of AGENT_DELEGATION_INTENTS_V1) {
      const result = routeAgentDelegation({ intent });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.agent.id).toBe(expected[intent]);
      expect(result.reason).toBe('delegation-intent');
    }
  });

  test('explicit legacy role takes precedence over inferred intent', () => {
    const result = routeAgentDelegation({
      requestedRole: 'critic',
      intent: 'implementation',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.id).toBe('oracle');
    expect(result.agent.preferredModelTier).toBe('pro');
    expect(result.agent.capabilityFloor).toBe('read-only');
    expect(result.reason).toBe('requested-role');
  });

  test('canonical requested role is accepted directly', () => {
    const result = routeAgentDelegation({ requestedRole: 'fixer' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.id).toBe('fixer');
    expect(result.agent.preferredModelTier).toBe('flash');
    expect(result.agent.capabilityFloor).toBe('read-write');
  });

  test('unknown requested role fail-closes even when intent is otherwise valid', () => {
    const result = routeAgentDelegation({
      requestedRole: 'wizard',
      intent: 'implementation',
    });
    expect(result).toEqual({
      ok: false,
      code: 'unknown-requested-role',
      message: 'unknown requested agent role "wizard"',
    });
  });

  test('missing and unknown intents return explicit route errors', () => {
    expect(routeAgentDelegation({})).toEqual({
      ok: false,
      code: 'missing-route',
      message: 'agent routing requires requestedRole or intent',
    });
    expect(routeAgentDelegation({ intent: 'database-migration' })).toEqual({
      ok: false,
      code: 'unknown-intent',
      message: 'unknown delegation intent "database-migration"',
    });
  });
});
