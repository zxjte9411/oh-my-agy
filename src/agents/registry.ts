import {
  CANONICAL_AGENT_IDS_V1,
  CanonicalAgentDefinitionV1,
  CanonicalAgentIdV1,
} from './types';

function defineAgent(definition: CanonicalAgentDefinitionV1): CanonicalAgentDefinitionV1 {
  return Object.freeze({ ...definition });
}

/**
 * OMA slim-agent 的 canonical registry。
 * 這是角色能力、模型偏好與 AGY main/subagent posture 的產品層 SSOT。
 */
export const CANONICAL_AGENT_REGISTRY_V1 = Object.freeze({
  orchestrator: defineAgent({
    id: 'orchestrator',
    description: 'Coordinate dependency-aware work, delegate bounded lanes, reconcile results, and verify completion.',
    mainAgent: true,
    subagent: false,
    preferredModelTier: 'inherit',
    capabilityFloor: 'read-write',
    writeScopeAllowed: true,
  }),
  explorer: defineAgent({
    id: 'explorer',
    description: 'Discover repository structure, relevant code paths, ownership seams, and local implementation context.',
    mainAgent: false,
    subagent: true,
    preferredModelTier: 'flash',
    capabilityFloor: 'read-only',
    writeScopeAllowed: false,
  }),
  librarian: defineAgent({
    id: 'librarian',
    description: 'Research external documentation, current APIs, dependencies, and high-trust reference material.',
    mainAgent: false,
    subagent: true,
    preferredModelTier: 'flash',
    capabilityFloor: 'read-only',
    writeScopeAllowed: false,
  }),
  oracle: defineAgent({
    id: 'oracle',
    description: 'Review architecture, security, difficult diagnoses, and high-consequence technical decisions.',
    mainAgent: false,
    subagent: true,
    preferredModelTier: 'pro',
    capabilityFloor: 'read-only',
    writeScopeAllowed: false,
  }),
  fixer: defineAgent({
    id: 'fixer',
    description: 'Perform bounded implementation, debugging fixes, tests, and other scoped repository changes.',
    mainAgent: false,
    subagent: true,
    preferredModelTier: 'flash',
    capabilityFloor: 'read-write',
    writeScopeAllowed: true,
  }),
  designer: defineAgent({
    id: 'designer',
    description: 'Implement bounded UI and UX design work while preserving the repository design system.',
    mainAgent: false,
    subagent: true,
    preferredModelTier: 'flash',
    capabilityFloor: 'read-write',
    writeScopeAllowed: true,
  }),
  observer: defineAgent({
    id: 'observer',
    description: 'Inspect images, screenshots, PDFs, and other visual evidence without mutating the workspace.',
    mainAgent: false,
    subagent: true,
    preferredModelTier: 'inherit',
    capabilityFloor: 'read-only',
    writeScopeAllowed: false,
  }),
} satisfies Record<CanonicalAgentIdV1, CanonicalAgentDefinitionV1>);

export function isCanonicalAgentId(value: unknown): value is CanonicalAgentIdV1 {
  return typeof value === 'string'
    && (CANONICAL_AGENT_IDS_V1 as readonly string[]).includes(value);
}

export function canonicalAgentDefinition(id: CanonicalAgentIdV1): CanonicalAgentDefinitionV1 {
  return CANONICAL_AGENT_REGISTRY_V1[id];
}
