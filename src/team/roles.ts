import {
  CANONICAL_AGENT_ROLE_ALIASES_V1,
  CANONICAL_AGENT_ROLE_NAMES_V1,
  CanonicalAgentRoleAliasV1,
  isCanonicalAgentRoleAlias,
  resolveCanonicalAgent,
} from '../agents/aliases';

export type OmaCapabilityModeV1 = 'read-only' | 'read-write';

export interface OmaRolePolicyV1 {
  capabilityFloor: OmaCapabilityModeV1;
  writeScopeAllowed: boolean;
  childAllowed: boolean;
}

/**
 * Team/workflow 的 legacy role compatibility view。
 * Canonical agent registry 是角色能力與 child posture 的 SSOT；這裡只投影既有契約需要的欄位。
 */
export const OMA_ROLES_V1 = Object.freeze(Object.fromEntries(
  CANONICAL_AGENT_ROLE_NAMES_V1.map((role) => {
    const agent = resolveCanonicalAgent(role);
    if (agent === null) throw new Error(`canonical agent alias invariant failed for ${role}`);
    return [role, Object.freeze({
      capabilityFloor: agent.capabilityFloor,
      writeScopeAllowed: agent.writeScopeAllowed,
      childAllowed: agent.subagent,
    })];
  }),
) as { [Role in CanonicalAgentRoleAliasV1]: OmaRolePolicyV1 });

export type OmaRoleV1 = CanonicalAgentRoleAliasV1;

export const OMA_ROLE_NAMES_V1: readonly OmaRoleV1[] = CANONICAL_AGENT_ROLE_NAMES_V1;

export type OmaRolePostureCodeV1 =
  | 'unknown-role'
  | 'child-forbidden'
  | 'capability-floor'
  | 'write-scope';

export interface OmaRolePostureInputV1 {
  role: unknown;
  capabilityMode: OmaCapabilityModeV1;
  writeScopeNone: boolean;
  asChild: boolean;
}

export type OmaRolePostureResultV1 =
  | { ok: true; role: OmaRoleV1; policy: OmaRolePolicyV1 }
  | {
    ok: false;
    code: OmaRolePostureCodeV1;
    message: string;
    details: Readonly<Record<string, unknown>>;
  };

export function isOmaRole(value: unknown): value is OmaRoleV1 {
  return isCanonicalAgentRoleAlias(value);
}

export function unknownOmaRoleMessage(role: unknown): string {
  return `unknown team role ${JSON.stringify(role)}; expected one of: ${OMA_ROLE_NAMES_V1.join(', ')}`;
}

export function omaRolePolicy(role: OmaRoleV1): OmaRolePolicyV1 {
  return OMA_ROLES_V1[role];
}

export function omaCanonicalAgentId(role: OmaRoleV1) {
  return CANONICAL_AGENT_ROLE_ALIASES_V1[role];
}

/**
 * 單一姿勢評估：workflow stage、team task、worker envelope 共用。
 * asChild=true 時 leader-only canonical agent 一律拒絕。
 */
export function inspectOmaRolePosture(input: OmaRolePostureInputV1): OmaRolePostureResultV1 {
  if (!isOmaRole(input.role)) {
    return {
      ok: false,
      code: 'unknown-role',
      message: unknownOmaRoleMessage(input.role),
      details: { role: input.role, legal_roles: OMA_ROLE_NAMES_V1 },
    };
  }
  const policy = OMA_ROLES_V1[input.role];
  if (input.asChild && !policy.childAllowed) {
    return {
      ok: false,
      code: 'child-forbidden',
      message: `role ${input.role} is leader-only and cannot be assigned to a child task or workflow stage; use a worker role such as fixer`,
      details: { role: input.role, childAllowed: false },
    };
  }
  if (policy.capabilityFloor === 'read-only' && input.capabilityMode === 'read-write') {
    return {
      ok: false,
      code: 'capability-floor',
      message: `native_role ${input.role} capability_mode 'read-write' violates the read-only role floor; set capability_mode to 'read-only' and write_paths/write_scope to none/[]`,
      details: {
        role: input.role,
        capability_mode: input.capabilityMode,
        capabilityFloor: policy.capabilityFloor,
      },
    };
  }
  if (!policy.writeScopeAllowed && !input.writeScopeNone) {
    return {
      ok: false,
      code: 'write-scope',
      message: `role ${input.role} requires write_scope none / empty write_paths; a writable scope violates the role floor`,
      details: { role: input.role, writeScopeAllowed: false },
    };
  }
  return { ok: true, role: input.role, policy };
}
