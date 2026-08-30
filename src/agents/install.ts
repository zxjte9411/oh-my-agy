import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalBytesV1 } from '../contracts/state-schemas';
import {
  EVIDENCE_TIERS,
  HOST_CAPABILITY_POLICY_REGISTRY_V1,
  HostCapabilityProfileV1,
  validateHostCapabilityProfile,
} from '../native/capability-profile';
import { atomicWriteFile, atomicWriteJson, sha256 } from '../runtime/atomic';
import { RuntimeError, runtimeError } from '../runtime/errors';
import { Result, err, ok } from '../runtime/types';
import {
  NativeDelegationCapabilityV1,
  assessNativeDelegationCapability,
} from './orchestration';
import { renderAllCanonicalAgents } from './render-markdown-agent';
import { CANONICAL_AGENT_IDS_V1, CanonicalAgentIdV1 } from './types';

export const AGENT_INSTALL_RECEIPT_SCHEMA_V1 = 'oma.agent-install-receipt/v1' as const;
export type AgentInstallScopeV1 = 'project' | 'user';

const REQUIRED_AGENT_CAPABILITIES = Object.freeze([
  'custom_agent.markdown',
  'custom_agent.main_agent',
  'custom_agent.subagent',
  'custom_agent.model',
  'custom_agent.command_execution_policy',
] as const);

export interface AgentInstallReceiptFileV1 {
  readonly id: CanonicalAgentIdV1;
  readonly path: string;
  readonly sha256: string;
}

export interface AgentInstallReceiptV1 {
  readonly schema: typeof AGENT_INSTALL_RECEIPT_SCHEMA_V1;
  readonly scope: AgentInstallScopeV1;
  readonly transactionId: string;
  readonly installedAt: string;
  readonly files: readonly AgentInstallReceiptFileV1[];
  readonly receiptDigest: string;
}

export interface NativeAgentInstallOptionsV1 {
  readonly scope: AgentInstallScopeV1;
  readonly workspaceRoot: string;
  readonly homeDir?: string;
  readonly capabilityProfile: unknown;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export interface NativeAgentInstallResultV1 {
  readonly scope: AgentInstallScopeV1;
  readonly agentsRoot: string;
  readonly receiptPath: string;
  readonly idempotent: boolean;
  readonly receipt: AgentInstallReceiptV1;
  readonly delegation: NativeDelegationCapabilityV1;
}

export interface NativeAgentDoctorReportV1 {
  readonly scope: AgentInstallScopeV1;
  readonly agentsRoot: string;
  readonly receiptPath: string;
  readonly status: 'healthy' | 'missing' | 'drifted' | 'unsupported';
  readonly exitCode: 0 | 1;
  readonly diagnostics: readonly string[];
  readonly delegation: NativeDelegationCapabilityV1;
}

export function resolveNativeAgentRoot(
  scope: AgentInstallScopeV1,
  workspaceRoot: string,
  homeDir = os.homedir(),
): string {
  return scope === 'project'
    ? path.resolve(workspaceRoot, '.agents', 'agents')
    : path.resolve(homeDir, '.gemini', 'config', 'agents');
}

export function validateNativeAgentCapabilityProfile(
  profileValue: unknown,
): Result<HostCapabilityProfileV1, RuntimeError> {
  let profile: HostCapabilityProfileV1;
  try {
    profile = validateHostCapabilityProfile(profileValue);
  } catch (cause) {
    return err(runtimeError(
      'E_CAPABILITY_UNPROVEN',
      'Antigravity custom-agent capability profile is invalid or unavailable',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    ));
  }
  const missing: string[] = [];
  for (const capability of REQUIRED_AGENT_CAPABILITIES) {
    const policy = HOST_CAPABILITY_POLICY_REGISTRY_V1.find(({ key }) => key === capability);
    const assessment = profile.capabilities.find(({ key }) => key === capability);
    const actualRank = assessment?.tier === null || assessment?.tier === undefined
      ? -1
      : EVIDENCE_TIERS.indexOf(assessment.tier);
    const requiredRank = policy === undefined ? Number.MAX_SAFE_INTEGER : EVIDENCE_TIERS.indexOf(policy.routeTier);
    if (policy === undefined || assessment === undefined || assessment.outcome !== 'supported'
      || actualRank < requiredRank) {
      missing.push(capability);
    }
  }
  if (missing.length > 0) {
    return err(runtimeError(
      'E_CAPABILITY_UNPROVEN',
      `Antigravity custom-agent capabilities are unproven: ${missing.join(', ')}`,
      { missingCapabilities: missing },
    ));
  }
  return ok(profile);
}

/**
 * 僅管理七個 OMA canonical agent 目標；其他使用者 agents 永遠不刪除。
 * 每次寫入前驗證舊 receipt ownership，寫完逐檔 read-back；任何失敗還原快照。
 */
export function installNativeAgents(
  options: Readonly<NativeAgentInstallOptionsV1>,
): Result<NativeAgentInstallResultV1, RuntimeError> {
  const capability = validateNativeAgentCapabilityProfile(options.capabilityProfile);
  if (!capability.ok) return capability;
  const delegation = assessNativeDelegationCapability(capability.value);
  const nativeDelegationAvailable = delegation.status === 'available';
  const agentsRoot = resolveNativeAgentRoot(options.scope, options.workspaceRoot, options.homeDir);
  const receiptPath = path.join(agentsRoot, '.oma', 'receipt.json');
  const safeRoot = validateAgentsRoot(agentsRoot);
  if (!safeRoot.ok) return safeRoot;
  const desired = renderAllCanonicalAgents({ nativeDelegationAvailable }).map((agent) => ({
    id: agent.id,
    relativePath: `${agent.id}/agent.md`,
    targetPath: path.join(agentsRoot, agent.id, 'agent.md'),
    bytes: Buffer.from(agent.markdown, 'utf8'),
    digest: sha256(agent.markdown),
  }));
  const previousReceipt = readReceipt(receiptPath, options.scope);
  if (!previousReceipt.ok) return previousReceipt;

  if (previousReceipt.value === null) {
    const collision = desired.find(({ targetPath }) => fs.existsSync(targetPath));
    if (collision !== undefined) {
      return err(runtimeError(
        'E_ALREADY_EXISTS',
        `Refusing to overwrite an unowned native agent: ${collision.relativePath}`,
      ));
    }
  } else {
    const ownership = verifyOwnedFiles(agentsRoot, previousReceipt.value);
    if (!ownership.ok) return ownership;
    const desiredById = new Map(desired.map((entry) => [entry.id, entry.digest]));
    const identical = previousReceipt.value.files.every((file) => desiredById.get(file.id) === file.sha256);
    if (identical) {
      return ok({
        scope: options.scope,
        agentsRoot,
        receiptPath,
        idempotent: true,
        receipt: previousReceipt.value,
        delegation,
      });
    }
  }

  const snapshot = snapshotTargets(desired.map(({ targetPath }) => targetPath), receiptPath);
  const transactionId = options.idFactory?.() ?? crypto.randomUUID();
  const installedAt = (options.now?.() ?? new Date()).toISOString();
  try {
    fs.mkdirSync(agentsRoot, { recursive: true, mode: 0o700 });
    for (const entry of desired) {
      assertRegularOrAbsent(entry.targetPath);
      atomicWriteFile(entry.targetPath, entry.bytes, { mode: 0o600, transactionId });
      const readback = fs.readFileSync(entry.targetPath);
      if (sha256(readback) !== entry.digest) {
        throw new Error(`agent read-back digest mismatch: ${entry.relativePath}`);
      }
    }
    const files = desired.map(({ id, relativePath, digest }) => ({ id, path: relativePath, sha256: digest }));
    const receipt = buildReceipt(options.scope, transactionId, installedAt, files);
    assertNoSymlinkComponents(receiptPath);
    atomicWriteJson(receiptPath, receipt, { mode: 0o600, transactionId });
    const verified = readReceipt(receiptPath, options.scope);
    if (!verified.ok || verified.value === null || verified.value.receiptDigest !== receipt.receiptDigest) {
      throw new Error(verified.ok ? 'agent receipt read-back failed' : verified.error.message);
    }
    return ok({
      scope: options.scope,
      agentsRoot,
      receiptPath,
      idempotent: false,
      receipt,
      delegation,
    });
  } catch (cause) {
    try {
      restoreSnapshot(snapshot);
    } catch (rollbackCause) {
      return err(runtimeError(
        'E_CORRUPT_STATE',
        'Native agent install failed and rollback could not be completed',
        {
          cause: cause instanceof Error ? cause.message : String(cause),
          rollbackCause: rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause),
        },
      ));
    }
    return err(runtimeError(
      'E_VALIDATOR_REJECTED',
      'Native agent install failed; previous owned state was restored',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    ));
  }
}

export function doctorNativeAgentInstallation(
  options: Readonly<NativeAgentInstallOptionsV1>,
): NativeAgentDoctorReportV1 {
  const agentsRoot = resolveNativeAgentRoot(options.scope, options.workspaceRoot, options.homeDir);
  const receiptPath = path.join(agentsRoot, '.oma', 'receipt.json');
  const delegation = assessNativeDelegationCapability(options.capabilityProfile);
  const capability = validateNativeAgentCapabilityProfile(options.capabilityProfile);
  if (!capability.ok) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'unsupported',
      exitCode: 1,
      diagnostics: [capability.error.message],
      delegation,
    };
  }
  const nativeDelegationAvailable = delegation.status === 'available';
  const safeRoot = validateAgentsRoot(agentsRoot);
  if (!safeRoot.ok) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'drifted',
      exitCode: 1,
      diagnostics: [safeRoot.error.message],
      delegation,
    };
  }
  const receipt = readReceipt(receiptPath, options.scope);
  if (!receipt.ok) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'drifted',
      exitCode: 1,
      diagnostics: [receipt.error.message],
      delegation,
    };
  }
  if (receipt.value === null) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'missing',
      exitCode: 1,
      diagnostics: ['OMA native agent ownership receipt is missing'],
      delegation,
    };
  }
  const owned = verifyOwnedFiles(agentsRoot, receipt.value);
  if (!owned.ok) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'drifted',
      exitCode: 1,
      diagnostics: [owned.error.message],
      delegation,
    };
  }
  const desired = new Map(renderAllCanonicalAgents({ nativeDelegationAvailable })
    .map((agent) => [agent.id, sha256(agent.markdown)]));
  const stale = receipt.value.files.filter((file) => desired.get(file.id) !== file.sha256).map(({ id }) => id);
  if (stale.length > 0) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'drifted',
      exitCode: 1,
      diagnostics: [
        `Installed native agents are stale: ${stale.join(', ')}`,
        ...(delegation.diagnostic === null ? [] : [delegation.diagnostic]),
      ],
      delegation,
    };
  }
  if (delegation.status !== 'available') {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'unsupported',
      exitCode: 1,
      diagnostics: [delegation.diagnostic ?? 'Native subagent delegation is unavailable'],
      delegation,
    };
  }
  return {
    scope: options.scope,
    agentsRoot,
    receiptPath,
    status: 'healthy',
    exitCode: 0,
    diagnostics: [],
    delegation,
  };
}

function buildReceipt(
  scope: AgentInstallScopeV1,
  transactionId: string,
  installedAt: string,
  files: readonly AgentInstallReceiptFileV1[],
): AgentInstallReceiptV1 {
  const base = {
    schema: AGENT_INSTALL_RECEIPT_SCHEMA_V1,
    scope,
    transactionId,
    installedAt,
    files,
  };
  return Object.freeze({ ...base, receiptDigest: sha256(canonicalBytesV1(base)) });
}

function readReceipt(
  receiptPath: string,
  scope: AgentInstallScopeV1,
): Result<AgentInstallReceiptV1 | null, RuntimeError> {
  try {
    assertNoSymlinkComponents(receiptPath);
    if (!fs.existsSync(receiptPath)) return ok(null);
    const stat = fs.lstatSync(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('receipt is not a regular file');
    const value = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as AgentInstallReceiptV1;
    if (value.schema !== AGENT_INSTALL_RECEIPT_SCHEMA_V1 || value.scope !== scope
      || typeof value.transactionId !== 'string' || value.transactionId.trim() === ''
      || typeof value.installedAt !== 'string' || Number.isNaN(Date.parse(value.installedAt))
      || !Array.isArray(value.files) || value.files.length !== CANONICAL_AGENT_IDS_V1.length
      || typeof value.receiptDigest !== 'string') {
      throw new Error('receipt shape is invalid');
    }
    const ids = value.files.map(({ id }) => id);
    if (JSON.stringify(ids) !== JSON.stringify(CANONICAL_AGENT_IDS_V1)) throw new Error('receipt agent set/order is invalid');
    for (const file of value.files) {
      if (file.path !== `${file.id}/agent.md` || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
        throw new Error(`receipt file entry is invalid: ${String(file.id)}`);
      }
    }
    const { receiptDigest, ...base } = value;
    if (!/^[a-f0-9]{64}$/u.test(receiptDigest) || receiptDigest !== sha256(canonicalBytesV1(base))) {
      throw new Error('receipt digest is invalid');
    }
    return ok(value);
  } catch (cause) {
    return err(runtimeError(
      'E_CORRUPT_STATE',
      'OMA native agent ownership receipt is invalid',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    ));
  }
}

function verifyOwnedFiles(
  agentsRoot: string,
  receipt: AgentInstallReceiptV1,
): Result<void, RuntimeError> {
  try {
    for (const file of receipt.files) {
      const target = path.join(agentsRoot, file.path);
      assertContained(agentsRoot, target);
      assertNoSymlinkComponents(target);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file.path} is not a regular file`);
      if (sha256(fs.readFileSync(target)) !== file.sha256) {
        return err(runtimeError(
          'E_PROJECTION_HASH_MISMATCH',
          `Owned native agent was modified outside OMA: ${file.path}`,
        ));
      }
    }
    return ok(undefined);
  } catch (cause) {
    return err(runtimeError(
      'E_PROJECTION_HASH_MISMATCH',
      'Owned native agent projection is incomplete or unsafe',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    ));
  }
}

function validateAgentsRoot(agentsRoot: string): Result<void, RuntimeError> {
  try {
    assertNoSymlinkComponents(agentsRoot);
    if (fs.existsSync(agentsRoot)) {
      const stat = fs.lstatSync(agentsRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('agents root is not a regular directory');
    }
    return ok(undefined);
  } catch (cause) {
    return err(runtimeError(
      'E_PATH_OUTSIDE_ROOT',
      'Native agent install root is unsafe',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    ));
  }
}

function assertRegularOrAbsent(targetPath: string): void {
  assertNoSymlinkComponents(targetPath);
  const directory = path.dirname(targetPath);
  if (fs.existsSync(directory)) {
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('agent directory is unsafe');
  }
  if (fs.existsSync(targetPath)) {
    const stat = fs.lstatSync(targetPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('agent file is unsafe');
  }
}

function assertContained(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('agent path escaped install root');
}

/** Reject any existing symlink component before mkdir/read/write follows it. */
function assertNoSymlinkComponents(targetPath: string): void {
  const absolute = path.resolve(targetPath);
  let ancestor = absolute;
  const suffix: string[] = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) {
    throw new Error('native agent path contains a symbolic-link component');
  }
  let cursor = ancestor;
  for (const segment of suffix) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error('native agent path contains a symbolic-link component');
    }
  }
}

interface FileSnapshotV1 {
  readonly path: string;
  readonly existed: boolean;
  readonly bytes?: Buffer;
}

function snapshotTargets(targetPaths: readonly string[], receiptPath: string): readonly FileSnapshotV1[] {
  return [...targetPaths, receiptPath].map((targetPath) => ({
    path: targetPath,
    existed: fs.existsSync(targetPath),
    ...(fs.existsSync(targetPath) ? { bytes: fs.readFileSync(targetPath) } : {}),
  }));
}

function restoreSnapshot(snapshot: readonly FileSnapshotV1[]): void {
  for (const entry of [...snapshot].reverse()) {
    if (entry.existed) {
      atomicWriteFile(entry.path, entry.bytes ?? Buffer.alloc(0), { mode: 0o600 });
      continue;
    }
    fs.rmSync(entry.path, { force: true });
    removeEmptyParents(path.dirname(entry.path));
  }
}

function removeEmptyParents(start: string): void {
  let current = start;
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      if (fs.readdirSync(current).length !== 0) return;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      return;
    }
  }
}
