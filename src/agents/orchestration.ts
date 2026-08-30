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
export const NATIVE_DELEGATION_RECONCILIATION_SCHEMA_V1 = 'oma.native-delegation-reconciliation/v1' as const;
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

export type NativeDelegationOutcomeStatusV1 = 'completed' | 'failed' | 'blocked';

export interface NativeDelegationOutcomeInputV1 {
  readonly laneId: string;
  readonly status: NativeDelegationOutcomeStatusV1;
  readonly summary: string;
  readonly evidence?: readonly string[];
}

export interface NativeDelegationOutcomeV1 {
  readonly laneId: string;
  readonly status: NativeDelegationOutcomeStatusV1;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly resultDigest: string;
}

export interface NativeDelegationReconciliationV1 {
  readonly schema: typeof NATIVE_DELEGATION_RECONCILIATION_SCHEMA_V1;
  readonly planDigest: string;
  readonly status: 'continue' | 'blocked' | 'ready-for-verification';
  readonly completedWaves: number;
  readonly nextWaveIndex: number | null;
  readonly nextLaneIds: readonly string[];
  readonly blockers: readonly string[];
  readonly outcomes: readonly NativeDelegationOutcomeV1[];
  readonly reconciliationDigest: string;
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

/**
 * 將 child outcomes 綁回 immutable plan，且只允許已完整完成的 wave 推進。
 * 不接受跨 wave 偷跑，也不把 failed/blocked predecessor 當成可繼續。
 */
export function reconcileNativeDelegation(
  planValue: unknown,
  outcomeValues: readonly NativeDelegationOutcomeInputV1[],
): Result<NativeDelegationReconciliationV1, RuntimeError> {
  const plan = validateNativeDelegationPlan(planValue);
  if (!plan.ok) return plan;
  if (!Array.isArray(outcomeValues) || outcomeValues.length === 0
    || outcomeValues.length > plan.value.lanes.length) {
    return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation reconciliation requires bounded outcomes'));
  }

  const laneIds = new Set(plan.value.lanes.map(({ id }) => id));
  const outcomes: NativeDelegationOutcomeV1[] = [];
  const seen = new Set<string>();
  for (const raw of outcomeValues) {
    const laneId = boundedLaneId(raw.laneId);
    if (laneId === null || !laneIds.has(laneId) || seen.has(laneId)) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `native delegation outcome lane is invalid: ${String(raw.laneId)}`));
    }
    seen.add(laneId);
    if (!['completed', 'failed', 'blocked'].includes(raw.status)) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `native delegation outcome ${laneId} has invalid status`));
    }
    const summary = boundedTask(raw.summary);
    if (summary === null) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `native delegation outcome ${laneId} has invalid summary`));
    }
    const evidence = normalizeEvidence(raw.evidence ?? []);
    if (evidence === null) {
      return err(runtimeError('E_VALIDATOR_REJECTED', `native delegation outcome ${laneId} has invalid evidence`));
    }
    const material = { laneId, status: raw.status, summary, evidence } as const;
    outcomes.push(Object.freeze({
      ...material,
      evidence: Object.freeze(evidence),
      resultDigest: sha256(canonicalBytesV1(material)),
    }));
  }
  outcomes.sort((left, right) => compareUtf8(left.laneId, right.laneId));
  const outcomeByLane = new Map(outcomes.map((outcome) => [outcome.laneId, outcome]));

  let completedWaves = 0;
  let nextWaveIndex: number | null = null;
  let nextLaneIds: readonly string[] = Object.freeze([]);
  let blockers: readonly string[] = Object.freeze([]);
  let blocked = false;
  for (const wave of plan.value.waves) {
    const waveOutcomes = wave.laneIds.map((laneId) => outcomeByLane.get(laneId));
    const present = waveOutcomes.filter((outcome) => outcome !== undefined).length;
    if (present === 0) {
      nextWaveIndex = wave.index;
      nextLaneIds = Object.freeze([...wave.laneIds]);
      const laterIds = plan.value.waves
        .filter(({ index }) => index > wave.index)
        .flatMap(({ laneIds: laterLaneIds }) => [...laterLaneIds]);
      if (laterIds.some((laneId) => outcomeByLane.has(laneId))) {
        return err(runtimeError('E_TASK_DEPENDENCY_BLOCKED', 'native delegation outcomes skipped a dependency wave'));
      }
      break;
    }
    if (present !== wave.laneIds.length) {
      return err(runtimeError('E_TASK_DEPENDENCY_BLOCKED', `native delegation wave ${wave.index} is only partially reconciled`));
    }
    const waveBlockers = waveOutcomes
      .filter((outcome): outcome is NativeDelegationOutcomeV1 => outcome !== undefined && outcome.status !== 'completed')
      .map(({ laneId }) => laneId)
      .sort(compareUtf8);
    completedWaves += 1;
    if (waveBlockers.length > 0) {
      blockers = Object.freeze(waveBlockers);
      blocked = true;
      const laterIds = plan.value.waves
        .filter(({ index }) => index > wave.index)
        .flatMap(({ laneIds: laterLaneIds }) => [...laterLaneIds]);
      if (laterIds.some((laneId) => outcomeByLane.has(laneId))) {
        return err(runtimeError('E_TASK_DEPENDENCY_BLOCKED', 'native delegation continued after a blocked predecessor wave'));
      }
      nextWaveIndex = null;
      nextLaneIds = Object.freeze([]);
      break;
    }
  }

  const allWavesCompleted = completedWaves === plan.value.waves.length;
  const status = blocked
    ? 'blocked' as const
    : allWavesCompleted ? 'ready-for-verification' as const : 'continue' as const;
  const base = {
    schema: NATIVE_DELEGATION_RECONCILIATION_SCHEMA_V1,
    planDigest: plan.value.planDigest,
    status,
    completedWaves,
    nextWaveIndex,
    nextLaneIds,
    blockers,
    outcomes: Object.freeze(outcomes),
  } as const;
  return ok(Object.freeze({
    ...base,
    reconciliationDigest: sha256(canonicalBytesV1(base)),
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

function validateNativeDelegationPlan(
  value: unknown,
): Result<NativeDelegationPlanV1, RuntimeError> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation plan is not an object'));
  }
  const candidate = value as Partial<NativeDelegationPlanV1>;
  if (candidate.schema !== NATIVE_DELEGATION_PLAN_SCHEMA_V1
    || !Array.isArray(candidate.lanes) || !Array.isArray(candidate.waves)
    || typeof candidate.planDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.planDigest)) {
    return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation plan shape is invalid'));
  }
  const { planDigest, ...base } = candidate as NativeDelegationPlanV1;
  if (sha256(canonicalBytesV1(base)) !== planDigest) {
    return err(runtimeError('E_PROJECTION_HASH_MISMATCH', 'native delegation plan digest does not match its contents'));
  }
  const laneIds = candidate.lanes.map(({ id }) => id);
  if (laneIds.length === 0 || laneIds.length > 16 || new Set(laneIds).size !== laneIds.length
    || laneIds.some((id) => boundedLaneId(id) === null)) {
    return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation plan lane set is invalid'));
  }
  const waveLaneIds = candidate.waves.flatMap(({ laneIds: ids }) => [...ids]);
  if (waveLaneIds.length !== laneIds.length || new Set(waveLaneIds).size !== waveLaneIds.length
    || waveLaneIds.some((id) => !laneIds.includes(id))) {
    return err(runtimeError('E_VALIDATOR_REJECTED', 'native delegation plan waves do not cover the lane set exactly'));
  }
  return ok(candidate as NativeDelegationPlanV1);
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

function normalizeEvidence(value: readonly string[]): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const evidence: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.includes('\0')
      || Buffer.byteLength(entry, 'utf8') > 2_048 || evidence.includes(entry)) return null;
    evidence.push(entry);
  }
  return evidence.sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
