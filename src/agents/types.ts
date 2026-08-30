export const CANONICAL_AGENT_IDS_V1 = [
  'orchestrator',
  'explorer',
  'librarian',
  'oracle',
  'fixer',
  'designer',
  'observer',
] as const;

export type CanonicalAgentIdV1 = typeof CANONICAL_AGENT_IDS_V1[number];
export type CanonicalAgentModelTierV1 = 'inherit' | 'flash' | 'pro';
export type CanonicalAgentCapabilityModeV1 = 'read-only' | 'read-write';

export interface CanonicalAgentDefinitionV1 {
  id: CanonicalAgentIdV1;
  description: string;
  mainAgent: boolean;
  subagent: boolean;
  preferredModelTier: CanonicalAgentModelTierV1;
  capabilityFloor: CanonicalAgentCapabilityModeV1;
  writeScopeAllowed: boolean;
}
