import { canonicalBytesV1 } from '../contracts/state-schemas';
import {
  EVIDENCE_TIERS,
  HOST_CAPABILITY_POLICY_REGISTRY_V1,
  HostCapabilityProfileV1,
  validateHostCapabilityProfile,
} from '../native/capability-profile';
import { sha256 } from '../runtime/atomic';
import { RuntimeError, runtimeError } from '../runtime/errors';
import { Result, err, ok } from '../runtime/types';
import { AgentRouteReasonV1, routeAgentDelegation } from './routing';
import { CanonicalAgentCapabilityModeV1, CanonicalAgentIdV1 } from './types';

export const NATIVE_DELEGATION_PLAN_SCHEMA_V1 = 'oma.native-delegation-plan/v1' as const;
export const NATIVE_DELEGATION_CAPABILITIES_V1 = Object.freeze([
  'custom_agent.subagent',
  'subagent.invoke',
] as const);

export interface NativeDelegationLaneInputV1 {
  readonly id: string;
  readonly task: string;
  readonly intent?: string;
  readonly requestedRole?: string;
  readonly dependsOn?: readonly string[];
}

export interface NativeDelegationPlanInputV1 {
  readonly lanes: readonly NativeDelegationLaneInputV1[];
}

export interface NativeDelegationLaneV1 {
  readonly id: string;
  readonly task: string;
  readonly dependsOn: readonly string[];
  readonly agent: CanonicalAgentIdV1;
  readonly routeReason: AgentRouteReasonV1;
  readonly capabilityFloor: CanonicalAgentCapabilityModeV1;
  readonly writeScopeAllowed: boolean;
  readonly workspace: 'inherit';
  readonly parallelSafe: boolean;
}

export interface NativeDelegationWaveV1 {
  readonly index: number;
  readonly laneIds: readonly string[];
  readonly parallel: boolean;
}

export interface NativeDelegationPlanV1 {
  readonly schema: typeof NATIVE_DELEGATION_PLAN_SCHEMA_V1;
  readonly lanes: readonly NativeDelegationLaneV1[];
  readonly waves: readonly NativeDelegationWaveV1[];
  readonly planDigest: string;
}

export interface NativeDelegationCapabilityRequirementV1 {
  readonly capability: typeof NATIVE_DELEGATION_CAPABILITIES_V1[number];
  readonly requiredTier: string;
  readonly outcome: 'supported' | 'unsupported' | 'unknown' | 'missing';
  readonly actualTier: string | null;
  readonly satisfied: boolean;
}

export interface NativeDelegationCapabilityV1 {
  readonly status: 'available' | 'unavailable';
  readonly profileDigest: string | null;
  readonly requirements: readonly NativeDelegationCapabilityRequirementV1[];
  readonly diagnostic: string | null;
}

/**
 * Native delegation 的單一 planning seam。
 * 所有 lane 都先經 routeAgentDelegation；read-only lanes 可同 wave 併行，write lanes 永遠序列化。
 */
export function planNativeDelegation(
  input: Readonly<NativeDelegationPlanInputV1>,
): Result<NativeDelegationPlanV1, RuntimeError> {
  if (!Array.isArray(input.lanes) || input.lanes.length === 0 || input.lanes.length > 16) {
    return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation requires 1..16 lanes'));
  }

  const normalized: NativeDelegationLaneV1[] = [];
  const ids = new Set<string>();
  for (const raw of input.lanes) {
    const id = boundedLaneId(raw.id);
    if (id === null) {
      return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation lane id is invalid'));
    }
    if (ids.has(id)) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `duplicate native delegation lane id: ${id}`));
    }
    ids.add(id);
    const task = boundedTask(raw.task);
    if (task === null) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `native delegation lane ${id} has an invalid task`));
    }
    const dependsOn = raw.dependsOn === undefined ? [] : normalizeDependencies(raw.dependsOn);
    if (dependsOn === null || dependsOn.includes(id)) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `native delegation lane ${id} has invalid dependencies`));
    }
    const routed = routeAgentDelegation({
      ...(raw.requestedRole === undefined ? {} : { requestedRole: raw.requestedRole }),
      ...(raw.intent === undefined ? {} : { intent: raw.intent }),
    });
    if (!routed.ok) {
      return err(runtimeError(
        'E_VALIDATOR_REJECTED',
        `native delegation lane ${id} cannot be routed: ${routed.message}`,
        { laneId: id, routeCode: routed.code },
      ));
    }
    if (!routed.agent.subagent || routed.agent.id === 'orchestrator') {
      return err(runtimeError(
        'E_VALIDATOR_REJECTED',
        `native delegation lane ${id} resolved to leader-only agent ${routed.agent.id}`,
      ));
    }
    if (routed.agent.capabilityFloor === 'read-only' && routed.agent.writeScopeAllowed) {
      return err(runtimeError('E_CORRUPT_STATE', `read-only agent ${routed.agent.id} unexpectedly allows writes`));
    }
    normalized.push(Object.freeze({
      id,
      task,
      dependsOn: Object.freeze(dependsOn),
      agent: routed.agent.id,
      routeReason: routed.reason,
      capabilityFloor: routed.agent.capabilityFloor,
      writeScopeAllowed: routed.agent.writeScopeAllowed,
      workspace: 'inherit' as const,
      parallelSafe: routed.agent.capabilityFloor === 'read-only',
    }));
  }

  for (const lane of normalized) {
    const missing = lane.dependsOn.find((dependency) => !ids.has(dependency));
    if (missing !== undefined) {
      return err(runtimeError(
        'E_VALIDATOR_REJECTED',
        `native delegation lane ${lane.id} depends on unknown lane ${missing}`,
      ));
    }
  }

  const lanes = [...normalized].sort((left, right) => compareUtf8(left.id, right.id));
  const wavesResult = buildWaves(lanes);
  if (!wavesResult.ok) return wavesResult;
  const base = {
    schema: NATIVE_DELEGATION_PLAN_SCHEMA_V1,
    lanes,
    waves: wavesResult.value,
  } as const;
  return ok(Object.freeze({
    ...base,
    planDigest: sha256(canonicalBytesV1(base)),
  }));
}

export function assessNativeDelegationCapability(profileValue: unknown): NativeDelegationCapabilityV1 {
  let profile: HostCapabilityProfileV1;
  try {
    profile = validateHostCapabilityProfile(profileValue);
  } catch (cause) {
    return Object.freeze({
      status: 'unavailable',
      profileDigest: null,
      requirements: Object.freeze([]),
      diagnostic: `native delegation capability profile is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }

  const requirements = NATIVE_DELEGATION_CAPABILITIES_V1.map((capability) => {
    const policy = HOST_CAPABILITY_POLICY_REGISTRY_V1.find(({ key }) => key === capability);
    const assessment = profile.capabilities.find(({ key }) => key === capability);
    const requiredTier = policy?.routeTier ?? 'unknown';
    const actualTier = assessment?.tier ?? null;
    const actualRank = actualTier === null ? -1 : EVIDENCE_TIERS.indexOf(actualTier);
    const requiredRank = policy === undefined ? Number.MAX_SAFE_INTEGER : EVIDENCE_TIERS.indexOf(policy.routeTier);
    const satisfied = policy !== undefined
      && assessment?.outcome === 'supported'
      && actualRank >= requiredRank;
    return Object.freeze({
      capability,
      requiredTier,
      outcome: assessment?.outcome ?? 'missing',
      actualTier,
      satisfied,
    });
  });
  const missing = requirements.filter(({ satisfied }) => !satisfied).map(({ capability }) => capability);
  return Object.freeze({
    status: missing.length === 0 ? 'available' : 'unavailable',
    profileDigest: profile.profileDigest,
    requirements: Object.freeze(requirements),
    diagnostic: missing.length === 0
      ? null
      : `native delegation capabilities are unproven: ${missing.join(', ')}`,
  });
}

function buildWaves(
  lanes: readonly NativeDelegationLaneV1[],
): Result<readonly NativeDelegationWaveV1[], RuntimeError> {
  const pending = new Map(lanes.map((lane) => [lane.id, lane]));
  const completed = new Set<string>();
  const waves: NativeDelegationWaveV1[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter((lane) => lane.dependsOn.every((dependency) => completed.has(dependency)))
      .sort((left, right) => compareUtf8(left.id, right.id));
    if (ready.length === 0) {
      return err(runtimeError('E_TASK_DEPENDENCY_BLOCKED', 'native delegation dependency graph contains a cycle'));
    }
    const readOnly = ready.filter(({ parallelSafe }) => parallelSafe);
    const selected = readOnly.length > 0 ? readOnly : [ready[0]];
    const laneIds = selected.map(({ id }) => id);
    waves.push(Object.freeze({
      index: waves.length,
      laneIds: Object.freeze(laneIds),
      parallel: laneIds.length > 1,
    }));
    for (const lane of selected) {
      pending.delete(lane.id);
      completed.add(lane.id);
    }
  }
  return ok(Object.freeze(waves));
}

function boundedLaneId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value) ? value : null;
}

function boundedTask(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > 16_384) return null;
  return value;
}

function normalizeDependencies(value: readonly string[]): string[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const dependencies: string[] = [];
  for (const dependency of value) {
    const normalized = boundedLaneId(dependency);
    if (normalized === null || dependencies.includes(normalized)) return null;
    dependencies.push(normalized);
  }
  return dependencies.sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
