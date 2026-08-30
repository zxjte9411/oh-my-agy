import { resolveCanonicalAgent, resolveCanonicalAgentId } from './aliases';
import { canonicalAgentDefinition } from './registry';
import { CanonicalAgentDefinitionV1, CanonicalAgentIdV1 } from './types';

export const AGENT_DELEGATION_INTENTS_V1 = [
  'orchestration',
  'codebase-discovery',
  'external-research',
  'architecture-review',
  'implementation',
  'design',
  'observation',
] as const;

export type AgentDelegationIntentV1 = typeof AGENT_DELEGATION_INTENTS_V1[number];
export type AgentRouteReasonV1 = 'requested-role' | 'delegation-intent';

export interface AgentRouteRequestV1 {
  requestedRole?: unknown;
  intent?: unknown;
}

export type AgentRouteResultV1 =
  | {
    ok: true;
    agent: CanonicalAgentDefinitionV1;
    reason: AgentRouteReasonV1;
  }
  | {
    ok: false;
    code: 'unknown-requested-role' | 'unknown-intent' | 'missing-route';
    message: string;
  };

const INTENT_AGENT_V1: Readonly<Record<AgentDelegationIntentV1, CanonicalAgentIdV1>> = Object.freeze({
  orchestration: 'orchestrator',
  'codebase-discovery': 'explorer',
  'external-research': 'librarian',
  'architecture-review': 'oracle',
  implementation: 'fixer',
  design: 'designer',
  observation: 'observer',
});

export function isAgentDelegationIntent(value: unknown): value is AgentDelegationIntentV1 {
  return typeof value === 'string'
    && (AGENT_DELEGATION_INTENTS_V1 as readonly string[]).includes(value);
}

/**
 * Delegation routing 的單一 seam。
 * 明確指定 role 時優先採用且未知值 fail-closed；沒有 role 時才依 bounded intent 選擇 canonical agent。
 */
export function routeAgentDelegation(request: AgentRouteRequestV1): AgentRouteResultV1 {
  if (request.requestedRole !== undefined) {
    const id = resolveCanonicalAgentId(request.requestedRole);
    if (id === null) {
      return {
        ok: false,
        code: 'unknown-requested-role',
        message: `unknown requested agent role ${JSON.stringify(request.requestedRole)}`,
      };
    }
    const agent = resolveCanonicalAgent(request.requestedRole);
    if (agent === null) throw new Error(`canonical agent resolution invariant failed for ${id}`);
    return { ok: true, agent, reason: 'requested-role' };
  }

  if (request.intent === undefined) {
    return {
      ok: false,
      code: 'missing-route',
      message: 'agent routing requires requestedRole or intent',
    };
  }
  if (!isAgentDelegationIntent(request.intent)) {
    return {
      ok: false,
      code: 'unknown-intent',
      message: `unknown delegation intent ${JSON.stringify(request.intent)}`,
    };
  }

  return {
    ok: true,
    agent: canonicalAgentDefinition(INTENT_AGENT_V1[request.intent]),
    reason: 'delegation-intent',
  };
}
