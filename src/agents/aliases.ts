import { canonicalAgentDefinition } from './registry';
import { CanonicalAgentDefinitionV1, CanonicalAgentIdV1 } from './types';

/**
 * 相容層：保留 OMA/OMC/OMX/OmO 既有角色詞彙，但全部收斂到七個 canonical agents。
 * 新的 product logic 應依 canonical id 做決策，不應再替 alias 建立第二套行為。
 */
export const CANONICAL_AGENT_ROLE_ALIASES_V1 = Object.freeze({
  orchestrator: 'orchestrator',

  explorer: 'explorer',
  analyst: 'explorer',
  planner: 'explorer',

  librarian: 'librarian',
  'docs-reviewer': 'librarian',

  oracle: 'oracle',
  reviewer: 'oracle',
  'code-reviewer': 'oracle',
  critic: 'oracle',
  verifier: 'oracle',
  'security-reviewer': 'oracle',
  architect: 'oracle',
  skeptic: 'oracle',
  'deployment-reviewer': 'oracle',
  'operations-reviewer': 'oracle',
  'release-decider': 'oracle',

  fixer: 'fixer',
  executor: 'fixer',
  debugger: 'fixer',
  writer: 'fixer',
  'test-engineer': 'fixer',
  'qa-tester': 'fixer',

  designer: 'designer',
  observer: 'observer',
} as const satisfies Record<string, CanonicalAgentIdV1>);

export type CanonicalAgentRoleAliasV1 = keyof typeof CANONICAL_AGENT_ROLE_ALIASES_V1;

export const CANONICAL_AGENT_ROLE_NAMES_V1: readonly CanonicalAgentRoleAliasV1[] = Object.freeze(
  (Object.keys(CANONICAL_AGENT_ROLE_ALIASES_V1) as CanonicalAgentRoleAliasV1[])
    .sort((left, right) => left.localeCompare(right, 'en')),
);

export function isCanonicalAgentRoleAlias(value: unknown): value is CanonicalAgentRoleAliasV1 {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(CANONICAL_AGENT_ROLE_ALIASES_V1, value);
}

export function resolveCanonicalAgentId(value: unknown): CanonicalAgentIdV1 | null {
  if (!isCanonicalAgentRoleAlias(value)) return null;
  return CANONICAL_AGENT_ROLE_ALIASES_V1[value];
}

export function resolveCanonicalAgent(value: unknown): CanonicalAgentDefinitionV1 | null {
  const id = resolveCanonicalAgentId(value);
  return id === null ? null : canonicalAgentDefinition(id);
}
