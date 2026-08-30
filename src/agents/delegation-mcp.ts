import * as fs from 'fs';
import * as path from 'path';
import { canonicalBytesV1 } from '../contracts/state-schemas';
import { writeImmutableFile } from '../runtime/atomic';
import { McpOperationContextV1 } from '../mcp/operations';
import { McpToolSurfaceV1 } from '../mcp/server';
import {
  planNativeDelegation,
  reconcileNativeDelegation,
} from './orchestration';

export const AGENT_DELEGATION_MCP_OPERATION_NAMES_V1 = [
  'delegation.plan',
  'delegation.reconcile',
] as const;

export type AgentDelegationMcpOperationNameV1 =
  typeof AGENT_DELEGATION_MCP_OPERATION_NAMES_V1[number];

type JsonObject = Record<string, unknown>;

const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false as const,
  idempotentHint: true,
});

export const AGENT_DELEGATION_MCP_TOOLS_V1 = Object.freeze([
  {
    name: 'delegation.plan',
    description: 'Create a deterministic canonical native-subagent plan and immutable planning evidence.',
    inputSchema: objectSchema({
      lanes: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: objectSchema({
          id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' },
          task: { type: 'string', minLength: 1, maxLength: 16384 },
          intent: { type: 'string', minLength: 1, maxLength: 64 },
          requested_role: { type: 'string', minLength: 1, maxLength: 64 },
          depends_on: {
            type: 'array',
            maxItems: 16,
            items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' },
          },
        }, ['id', 'task']),
      },
    }, ['lanes']),
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: 'delegation.reconcile',
    description: 'Reconcile native child outcomes against an immutable plan before advancing dependency waves.',
    inputSchema: objectSchema({
      plan_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      outcomes: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: objectSchema({
          lane_id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' },
          status: { type: 'string', enum: ['completed', 'failed', 'blocked'] },
          summary: { type: 'string', minLength: 1, maxLength: 16384 },
          evidence: {
            type: 'array',
            maxItems: 100,
            items: { type: 'string', minLength: 1, maxLength: 2048 },
          },
        }, ['lane_id', 'status', 'summary']),
      },
    }, ['plan_digest', 'outcomes']),
    annotations: WRITE_ANNOTATIONS,
  },
] as const);

export function listAgentDelegationMcpTools() {
  return AGENT_DELEGATION_MCP_TOOLS_V1.map((tool) => ({
    ...tool,
    inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)) as Record<string, unknown>,
    annotations: { ...tool.annotations },
  }));
}

export async function invokeAgentDelegationMcpOperation(
  name: string,
  rawArguments: unknown,
  context: Readonly<McpOperationContextV1>,
): Promise<unknown> {
  if (!(AGENT_DELEGATION_MCP_OPERATION_NAMES_V1 as readonly string[]).includes(name)) {
    throw new Error(`E_MCP_TOOL_NOT_FOUND: ${name}`);
  }
  const args = plainObject(rawArguments, 'arguments');
  const repositoryRoot = fs.realpathSync(path.resolve(context.repositoryRoot));
  switch (name as AgentDelegationMcpOperationNameV1) {
    case 'delegation.plan':
      return createDelegationPlan(repositoryRoot, args);
    case 'delegation.reconcile':
      return createDelegationReconciliation(repositoryRoot, args);
  }
}

export const AGENT_DELEGATION_MCP_SURFACE_V1: McpToolSurfaceV1 = Object.freeze({
  serverName: 'oh-my-agy-agents',
  listTools: listAgentDelegationMcpTools,
  invoke: invokeAgentDelegationMcpOperation,
});

function createDelegationPlan(repositoryRoot: string, args: JsonObject): unknown {
  exactKeys(args, ['lanes']);
  if (!Array.isArray(args.lanes) || args.lanes.length < 1 || args.lanes.length > 16) {
    throw new Error('E_MCP_ARGUMENT: lanes must contain 1..16 items');
  }
  const lanes = args.lanes.map((value, index) => {
    const lane = plainObject(value, `lanes[${index}]`);
    exactKeys(lane, ['id', 'task'], ['intent', 'requested_role', 'depends_on']);
    return {
      id: boundedString(lane.id, `lanes[${index}].id`, 64),
      task: boundedString(lane.task, `lanes[${index}].task`, 16_384),
      ...(lane.intent === undefined
        ? {} : { intent: boundedString(lane.intent, `lanes[${index}].intent`, 64) }),
      ...(lane.requested_role === undefined
        ? {} : { requestedRole: boundedString(lane.requested_role, `lanes[${index}].requested_role`, 64) }),
      ...(lane.depends_on === undefined
        ? {} : { dependsOn: stringArray(lane.depends_on, `lanes[${index}].depends_on`, 16, 64) }),
    };
  });
  const planned = planNativeDelegation({ lanes });
  if (!planned.ok) throw new Error(`${planned.error.code}: ${planned.error.message}`);
  const relativePath = `.agy/artifacts/native-delegation/${planned.value.planDigest}.json`;
  const targetPath = path.resolve(repositoryRoot, ...relativePath.split('/'));
  if (!contained(repositoryRoot, targetPath)) throw new Error('E_MCP_PATH: delegation plan path escaped root');
  writeImmutableFile(targetPath, canonicalBytesV1(planned.value));
  return {
    store_kind: 'oma_agent_native_delegation_plan',
    schema_version: 1,
    authority: 'planning_only',
    plan: planned.value,
    plan_digest: planned.value.planDigest,
    plan_path: relativePath,
    immutable: true,
  };
}

function createDelegationReconciliation(repositoryRoot: string, args: JsonObject): unknown {
  exactKeys(args, ['plan_digest', 'outcomes']);
  const planDigest = boundedString(args.plan_digest, 'plan_digest', 64);
  if (!/^[a-f0-9]{64}$/u.test(planDigest)) throw new Error('E_MCP_ARGUMENT: plan_digest is invalid');
  if (!Array.isArray(args.outcomes) || args.outcomes.length < 1 || args.outcomes.length > 16) {
    throw new Error('E_MCP_ARGUMENT: outcomes must contain 1..16 items');
  }
  const planRelative = `.agy/artifacts/native-delegation/${planDigest}.json`;
  const planPath = resolveRegularFile(repositoryRoot, planRelative, 1_048_576);
  if ((fs.statSync(planPath).mode & 0o777) !== 0o400) {
    throw new Error('E_MCP_PATH: delegation plan evidence is not immutable');
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as unknown;
  const outcomes = args.outcomes.map((value, index) => {
    const outcome = plainObject(value, `outcomes[${index}]`);
    exactKeys(outcome, ['lane_id', 'status', 'summary'], ['evidence']);
    return {
      laneId: boundedString(outcome.lane_id, `outcomes[${index}].lane_id`, 64),
      status: delegationOutcomeStatus(outcome.status, `outcomes[${index}].status`),
      summary: boundedString(outcome.summary, `outcomes[${index}].summary`, 16_384),
      ...(outcome.evidence === undefined
        ? {} : { evidence: stringArray(outcome.evidence, `outcomes[${index}].evidence`, 100, 2_048) }),
    };
  });
  const reconciled = reconcileNativeDelegation(plan, outcomes);
  if (!reconciled.ok) throw new Error(`${reconciled.error.code}: ${reconciled.error.message}`);
  const relativePath = `.agy/artifacts/native-delegation/reconciliations/${reconciled.value.reconciliationDigest}.json`;
  const targetPath = path.resolve(repositoryRoot, ...relativePath.split('/'));
  if (!contained(repositoryRoot, targetPath)) throw new Error('E_MCP_PATH: reconciliation path escaped root');
  writeImmutableFile(targetPath, canonicalBytesV1(reconciled.value));
  return {
    store_kind: 'oma_agent_native_delegation_reconciliation',
    schema_version: 1,
    authority: 'reconciliation_only',
    reconciliation: reconciled.value,
    reconciliation_digest: reconciled.value.reconciliationDigest,
    reconciliation_path: relativePath,
    immutable: true,
  };
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  return { type: 'object', properties, required, additionalProperties: false };
}

function plainObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`E_MCP_ARGUMENT: ${label} must be an object`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(`E_MCP_ARGUMENT: unexpected/missing keys (${unknown.join(',')};${missing.join(',')})`);
  }
}

function boundedString(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new Error(`E_MCP_ARGUMENT: ${label} is invalid or exceeds its bound`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maxItems: number, maxBytes: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`E_MCP_ARGUMENT: ${label} is not a bounded array`);
  }
  const output = value.map((entry) => boundedString(entry, label, maxBytes));
  if (new Set(output).size !== output.length) throw new Error(`E_MCP_ARGUMENT: ${label} contains duplicates`);
  return output;
}

function delegationOutcomeStatus(
  value: unknown,
  label: string,
): 'completed' | 'failed' | 'blocked' {
  if (value !== 'completed' && value !== 'failed' && value !== 'blocked') {
    throw new Error(`E_MCP_ARGUMENT: ${label} is invalid`);
  }
  return value;
}

function resolveRegularFile(root: string, relative: string, maximumBytes: number): string {
  const candidate = path.resolve(root, ...relative.split('/'));
  if (!contained(root, candidate)) throw new Error('E_MCP_PATH: path escapes repository');
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
    throw new Error('E_MCP_PATH: target must be a bounded regular non-symlink file');
  }
  const resolved = fs.realpathSync(candidate);
  if (!contained(root, resolved)) throw new Error('E_MCP_PATH: target resolves outside repository');
  return resolved;
}

function contained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
