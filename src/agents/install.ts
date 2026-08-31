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
import { atomicWriteFile, atomicWriteJson, canonicalJson, sha256 } from '../runtime/atomic';
import { RuntimeError, runtimeError, RUNTIME_ERROR_CODES, RuntimeErrorCode } from '../runtime/errors';
import { Result, err, ok } from '../runtime/types';
import { defaultAntigravityConfigRoot } from '../setup/installed-identity';
import {
  NativeDelegationCapabilityV1,
  assessNativeDelegationCapability,
} from './orchestration';
import { renderAllCanonicalAgents } from './render-markdown-agent';
import { CANONICAL_AGENT_IDS_V1, CanonicalAgentIdV1 } from './types';

export const AGENT_INSTALL_RECEIPT_SCHEMA_V1 = 'oma.agent-install-receipt/v1' as const;
export type AgentInstallScopeV1 = 'project' | 'user';

export const CANONICAL_OMA_MCP_SERVER_NAME = 'oh-my-agy-agents' as const;
export const CANONICAL_OMA_MCP_SERVER_ENTRY = Object.freeze({
  command: 'oma',
  args: ['agents', 'mcp-server'] as const,
});

export function canonicalMcpEntryDigest(): string {
  return sha256(canonicalJson(CANONICAL_OMA_MCP_SERVER_ENTRY));
}

export function isCanonicalMcpEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
  try {
    return sha256(canonicalJson(entry)) === canonicalMcpEntryDigest();
  } catch {
    return false;
  }
}

const REQUIRED_AGENT_CAPABILITIES = Object.freeze([
  'custom_agent.markdown',
  'custom_agent.main_agent',
] as const);

export interface AgentInstallReceiptFileV1 {
  readonly id: CanonicalAgentIdV1;
  readonly path: string;
  readonly sha256: string;
}

export interface AgentInstallReceiptMcpV1 {
  readonly serverName: typeof CANONICAL_OMA_MCP_SERVER_NAME;
  readonly configPath: string;
  readonly entryDigest: string;
}

export interface AgentInstallReceiptV1 {
  readonly schema: typeof AGENT_INSTALL_RECEIPT_SCHEMA_V1;
  readonly scope: AgentInstallScopeV1;
  readonly transactionId: string;
  readonly installedAt: string;
  readonly files: readonly AgentInstallReceiptFileV1[];
  readonly mcpConfigPath?: string | null;
  readonly mcpServer?: AgentInstallReceiptMcpV1 | null;
  readonly receiptDigest: string;
  readonly isLegacyReceipt?: boolean;
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
  readonly mcpConfigPath: string | null;
  readonly idempotent: boolean;
  readonly legacyMcpMigrated: boolean;
  readonly receipt: AgentInstallReceiptV1;
  readonly delegation: NativeDelegationCapabilityV1;
}

export interface NativeAgentUninstallOptionsV1 {
  readonly scope: AgentInstallScopeV1;
  readonly workspaceRoot: string;
  readonly homeDir?: string;
}

export interface NativeAgentUninstallResultV1 {
  readonly scope: AgentInstallScopeV1;
  readonly status: 'uninstalled' | 'already_absent' | 'completed_with_collisions';
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly collisions: readonly string[];
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

export function isCapabilityProven(profile: HostCapabilityProfileV1, key: string): boolean {
  const policy = HOST_CAPABILITY_POLICY_REGISTRY_V1.find((p) => p.key === key);
  const assessment = profile.capabilities.find((c) => c.key === key);
  if (policy === undefined || assessment === undefined || assessment.outcome !== 'supported' || assessment.tier === null) {
    return false;
  }
  return EVIDENCE_TIERS.indexOf(assessment.tier) >= EVIDENCE_TIERS.indexOf(policy.routeTier);
}

function resolveRenderOptions(
  profile: HostCapabilityProfileV1,
  nativeDelegationAvailable: boolean,
) {
  return {
    nativeDelegationAvailable,
    modelProjectionAvailable: isCapabilityProven(profile, 'custom_agent.model'),
    commandExecutionPolicyAvailable: isCapabilityProven(profile, 'custom_agent.command_execution_policy'),
  };
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
  const renderOptions = resolveRenderOptions(capability.value, nativeDelegationAvailable);
  const agentsRoot = resolveNativeAgentRoot(options.scope, options.workspaceRoot, options.homeDir);
  const receiptPath = path.join(agentsRoot, '.oma', 'receipt.json');
  const safeRoot = validateAgentsRoot(agentsRoot);
  if (!safeRoot.ok) return safeRoot;
  const desired = renderAllCanonicalAgents(renderOptions).map((agent) => ({
    id: agent.id,
    relativePath: `${agent.id}/agent.md`,
    targetPath: path.join(agentsRoot, agent.id, 'agent.md'),
    bytes: Buffer.from(agent.markdown, 'utf8'),
    digest: sha256(agent.markdown),
  }));
  const previousReceipt = readReceipt(receiptPath, options.scope);
  if (!previousReceipt.ok) return previousReceipt;

  const mcpConfigPath = resolveMcpConfigPath(options.scope, options.workspaceRoot, options.homeDir);
  let legacyMcpMigrated = false;

  if (previousReceipt.value === null) {
    const collision = desired.find(({ targetPath }) => fs.existsSync(targetPath));
    if (collision !== undefined) {
      return err(runtimeError(
        'E_ALREADY_EXISTS',
        `Refusing to overwrite an unowned native agent: ${collision.relativePath}`,
      ));
    }
    if (mcpConfigPath && nativeDelegationAvailable && fs.existsSync(mcpConfigPath)) {
      const safeMcp = validateMcpConfigPath(mcpConfigPath);
      if (!safeMcp.ok) return safeMcp;
      try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        if (typeof config === 'object' && config !== null && !Array.isArray(config)
          && config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
          && config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME] !== undefined) {
          return err(runtimeError(
            'E_ALREADY_EXISTS',
            `Refusing to overwrite or adopt an unowned MCP server entry: ${CANONICAL_OMA_MCP_SERVER_NAME}`,
          ));
        }
      } catch (cause) {
        if (cause instanceof SyntaxError) {
          return err(runtimeError('E_CORRUPT_STATE', 'MCP config file is invalid JSON', {
            cause: cause.message,
          }));
        }
        throw cause;
      }
    }
  } else {
    const ownership = verifyOwnedFiles(agentsRoot, previousReceipt.value);
    if (!ownership.ok) return ownership;

    if (mcpConfigPath && nativeDelegationAvailable && fs.existsSync(mcpConfigPath)) {
      const safeMcp = validateMcpConfigPath(mcpConfigPath);
      if (!safeMcp.ok) return safeMcp;
      try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        if (typeof config === 'object' && config !== null && !Array.isArray(config)
          && config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
          const existing = config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME];
          if (existing !== undefined) {
            if (previousReceipt.value.isLegacyReceipt) {
              if (isCanonicalMcpEntry(existing)) {
                legacyMcpMigrated = true;
              } else {
                return err(runtimeError(
                  'E_ALREADY_EXISTS',
                  `Refusing to adopt non-canonical MCP server entry during legacy migration: ${CANONICAL_OMA_MCP_SERVER_NAME}`,
                ));
              }
            } else if (previousReceipt.value.mcpServer && !isCanonicalMcpEntry(existing)) {
              return err(runtimeError(
                'E_ALREADY_EXISTS',
                `Refusing to overwrite a modified or foreign MCP server entry: ${CANONICAL_OMA_MCP_SERVER_NAME}`,
              ));
            }
          }
        }
      } catch (cause) {
        if (cause instanceof SyntaxError) {
          return err(runtimeError('E_CORRUPT_STATE', 'MCP config file is invalid JSON', {
            cause: cause.message,
          }));
        }
        throw cause;
      }
    }

    const desiredById = new Map(desired.map((entry) => [entry.id, entry.digest]));
    let mcpHealthy = true;
    if (mcpConfigPath && nativeDelegationAvailable) {
      const mcpDiagnostic = doctorMcpRegistration(mcpConfigPath, nativeDelegationAvailable);
      if (mcpDiagnostic !== null) {
        mcpHealthy = false;
      }
    }
    const expectedMcpConfigPath = nativeDelegationAvailable ? mcpConfigPath : null;
    const identical = previousReceipt.value.files.every((file) => desiredById.get(file.id) === file.sha256)
      && (previousReceipt.value.mcpConfigPath ?? null) === expectedMcpConfigPath
      && !previousReceipt.value.isLegacyReceipt
      && mcpHealthy;
    if (identical) {
      return ok({
        scope: options.scope,
        agentsRoot,
        receiptPath,
        mcpConfigPath: previousReceipt.value.mcpConfigPath ?? null,
        idempotent: true,
        legacyMcpMigrated: false,
        receipt: previousReceipt.value,
        delegation,
      });
    }
  }

  if (mcpConfigPath && nativeDelegationAvailable) {
    const safeMcp = validateMcpConfigPath(mcpConfigPath);
    if (!safeMcp.ok) return safeMcp;
  }

  const snapshotTargetsList = [
    ...desired.map(({ targetPath }) => targetPath),
    receiptPath,
  ];
  if (mcpConfigPath && nativeDelegationAvailable) {
    snapshotTargetsList.push(mcpConfigPath);
  }
  const snapshot = snapshotTargets(snapshotTargetsList);
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
    const mcpInstallResult = installMcpRegistration(mcpConfigPath, nativeDelegationAvailable, transactionId);
    if (!mcpInstallResult.ok) {
      throw new Error(`${mcpInstallResult.error.code}: ${mcpInstallResult.error.message}`);
    }
    const files = desired.map(({ id, relativePath, digest }) => ({ id, path: relativePath, sha256: digest }));
    const effectiveMcpConfigPath = nativeDelegationAvailable ? mcpConfigPath : null;
    const receipt = buildReceipt(options.scope, transactionId, installedAt, files, effectiveMcpConfigPath, nativeDelegationAvailable);
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
      mcpConfigPath: effectiveMcpConfigPath,
      idempotent: false,
      legacyMcpMigrated,
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
    const message = cause instanceof Error ? cause.message : String(cause);
    const codeMatch = /^([A-Z_]+):\s*(.*)$/u.exec(message);
    const candidateCode = codeMatch ? codeMatch[1] : 'E_VALIDATOR_REJECTED';
    const errorCode: RuntimeErrorCode = (RUNTIME_ERROR_CODES as readonly string[]).includes(candidateCode)
      ? (candidateCode as RuntimeErrorCode)
      : 'E_VALIDATOR_REJECTED';
    const errorMsg = codeMatch ? codeMatch[2] : message;
    return err(runtimeError(
      errorCode,
      `Native agent install failed: ${errorMsg}; previous owned state was restored`,
      { cause: message },
    ));
  }
}

export function uninstallNativeAgents(
  options: Readonly<NativeAgentUninstallOptionsV1>,
): Result<NativeAgentUninstallResultV1, RuntimeError> {
  const agentsRoot = resolveNativeAgentRoot(options.scope, options.workspaceRoot, options.homeDir);
  const receiptPath = path.join(agentsRoot, '.oma', 'receipt.json');
  const safeRoot = validateAgentsRoot(agentsRoot);
  if (!safeRoot.ok) return safeRoot;

  const receipt = readReceipt(receiptPath, options.scope);
  if (!receipt.ok) return receipt;
  if (receipt.value === null) {
    return ok({
      scope: options.scope,
      status: 'already_absent',
      removed: [],
      preserved: [],
      collisions: [],
    });
  }

  const removed: string[] = [];
  const preserved: string[] = [];
  const collisions: string[] = [];

  for (const file of receipt.value.files) {
    const target = path.join(agentsRoot, file.path);
    if (!fs.existsSync(target)) continue;
    try {
      assertContained(agentsRoot, target);
      assertNoSymlinkComponents(target);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(target)) !== file.sha256) {
        collisions.push(target);
        continue;
      }
      fs.rmSync(target, { force: true });
      removed.push(target);
      removeEmptyParents(path.dirname(target));
    } catch {
      collisions.push(target);
    }
  }

  const mcpConfigPath = receipt.value.mcpServer?.configPath ?? receipt.value.mcpConfigPath;
  if (mcpConfigPath) {
    const expectedDigest = receipt.value.mcpServer?.entryDigest ?? canonicalMcpEntryDigest();
    const uninstalledMcp = uninstallMcpRegistration(mcpConfigPath, expectedDigest);
    if (uninstalledMcp.ok) {
      if (uninstalledMcp.value === 'removed') {
        removed.push(`mcp:${CANONICAL_OMA_MCP_SERVER_NAME}@${mcpConfigPath}`);
      } else if (uninstalledMcp.value === 'foreign_preserved') {
        collisions.push(`mcp:${CANONICAL_OMA_MCP_SERVER_NAME}@${mcpConfigPath}`);
      }
    } else {
      collisions.push(mcpConfigPath);
    }
  }

  if (collisions.length === 0) {
    fs.rmSync(receiptPath, { force: true });
    removed.push(receiptPath);
    removeEmptyParents(path.dirname(receiptPath));
  } else {
    preserved.push(receiptPath);
  }

  return ok({
    scope: options.scope,
    status: collisions.length > 0 ? 'completed_with_collisions' : 'uninstalled',
    removed,
    preserved,
    collisions,
  });
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
  const renderOptions = resolveRenderOptions(capability.value, nativeDelegationAvailable);
  const desired = new Map(renderAllCanonicalAgents(renderOptions)
    .map((agent) => [agent.id, sha256(agent.markdown)]));
  const mcpPath = receipt.value.mcpServer?.configPath ?? receipt.value.mcpConfigPath;
  const mcpDiagnostic = nativeDelegationAvailable && mcpPath
    ? doctorMcpRegistration(mcpPath, nativeDelegationAvailable)
    : null;
  const stale = receipt.value.files.filter((file) => desired.get(file.id) !== file.sha256).map(({ id }) => id);
  if (stale.length > 0 || mcpDiagnostic !== null) {
    return {
      scope: options.scope,
      agentsRoot,
      receiptPath,
      status: 'drifted',
      exitCode: 1,
      diagnostics: [
        ...(stale.length > 0 ? [`Installed native agents are stale: ${stale.join(', ')}`] : []),
        ...(mcpDiagnostic !== null ? [mcpDiagnostic] : []),
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
  mcpConfigPath: string | null,
  nativeDelegationAvailable = true,
): AgentInstallReceiptV1 {
  const mcpServer: AgentInstallReceiptMcpV1 | null = nativeDelegationAvailable && mcpConfigPath !== null
    ? {
        serverName: CANONICAL_OMA_MCP_SERVER_NAME,
        configPath: mcpConfigPath,
        entryDigest: canonicalMcpEntryDigest(),
      }
    : null;
  const base = {
    schema: AGENT_INSTALL_RECEIPT_SCHEMA_V1,
    scope,
    transactionId,
    installedAt,
    files,
    mcpConfigPath,
    mcpServer,
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
    const value = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
    if (value.schema !== AGENT_INSTALL_RECEIPT_SCHEMA_V1 || value.scope !== scope
      || typeof value.transactionId !== 'string' || value.transactionId.trim() === ''
      || typeof value.installedAt !== 'string' || Number.isNaN(Date.parse(value.installedAt))
      || !Array.isArray(value.files) || value.files.length !== CANONICAL_AGENT_IDS_V1.length
      || typeof value.receiptDigest !== 'string') {
      throw new Error('receipt shape is invalid');
    }
    const ids = (value.files as AgentInstallReceiptFileV1[]).map(({ id }) => id);
    if (JSON.stringify(ids) !== JSON.stringify(CANONICAL_AGENT_IDS_V1)) throw new Error('receipt agent set/order is invalid');
    for (const file of value.files as AgentInstallReceiptFileV1[]) {
      if (file.path !== `${file.id}/agent.md` || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
        throw new Error(`receipt file entry is invalid: ${String(file.id)}`);
      }
    }
    const { receiptDigest, ...base } = value;
    if (!/^[a-f0-9]{64}$/u.test(receiptDigest as string) || receiptDigest !== sha256(canonicalBytesV1(base))) {
      throw new Error('receipt digest is invalid');
    }
    const isLegacyReceipt = value.mcpServer === undefined && value.mcpConfigPath === undefined;
    const mcpConfigPath = typeof value.mcpConfigPath === 'string'
      ? value.mcpConfigPath
      : value.mcpServer && typeof (value.mcpServer as any).configPath === 'string'
        ? (value.mcpServer as any).configPath
        : null;
    const mcpServer = (value.mcpServer as AgentInstallReceiptMcpV1 | null | undefined) ?? null;
    return ok({
      schema: value.schema as typeof AGENT_INSTALL_RECEIPT_SCHEMA_V1,
      scope: value.scope as AgentInstallScopeV1,
      transactionId: value.transactionId as string,
      installedAt: value.installedAt as string,
      files: value.files as readonly AgentInstallReceiptFileV1[],
      mcpConfigPath,
      mcpServer,
      receiptDigest: receiptDigest as string,
      isLegacyReceipt,
    });
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

export function validateMcpConfigPath(mcpConfigPath: string): Result<void, RuntimeError> {
  try {
    assertNoSymlinkComponents(mcpConfigPath);
    if (fs.existsSync(mcpConfigPath)) {
      const stat = fs.lstatSync(mcpConfigPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return err(runtimeError('E_PATH_OUTSIDE_ROOT', 'MCP config is not a regular file'));
      }
    }
    return ok(undefined);
  } catch (cause) {
    return err(runtimeError('E_PATH_OUTSIDE_ROOT', 'MCP config path contains a symbolic-link component', {
      cause: cause instanceof Error ? cause.message : String(cause),
    }));
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

function snapshotTargets(targetPaths: readonly string[]): readonly FileSnapshotV1[] {
  return targetPaths.map((targetPath) => ({
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

export function resolveMcpConfigPath(scope: AgentInstallScopeV1, workspaceRoot: string, homeDir?: string): string | null {
  if (scope === 'user') {
    return path.join(defaultAntigravityConfigRoot(homeDir), 'mcp_config.json');
  }
  // TODO: project scope MCP path is not verified yet
  return null;
}

export function installMcpRegistration(
  mcpConfigPath: string | null,
  nativeDelegationAvailable: boolean,
  transactionId?: string,
): Result<void, RuntimeError> {
  if (!nativeDelegationAvailable || !mcpConfigPath) return ok(undefined);
  const safePath = validateMcpConfigPath(mcpConfigPath);
  if (!safePath.ok) return safePath;

  let config: Record<string, any> = {};
  if (fs.existsSync(mcpConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        return err(runtimeError('E_CORRUPT_STATE', 'MCP config root must be an object'));
      }
    } catch (cause) {
      return err(runtimeError('E_CORRUPT_STATE', 'MCP config file is invalid JSON', {
        cause: cause instanceof Error ? cause.message : String(cause),
      }));
    }
  }
  if (config.mcpServers !== undefined) {
    if (typeof config.mcpServers !== 'object' || config.mcpServers === null || Array.isArray(config.mcpServers)) {
      return err(runtimeError('E_CORRUPT_STATE', 'MCP config mcpServers container must be an object'));
    }
  } else {
    config.mcpServers = {};
  }
  const existing = config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME];
  if (existing !== undefined && !isCanonicalMcpEntry(existing)) {
    return err(runtimeError(
      'E_ALREADY_EXISTS',
      `Refusing to overwrite an unowned or foreign MCP server entry: ${CANONICAL_OMA_MCP_SERVER_NAME}`,
    ));
  }
  config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME] = { ...CANONICAL_OMA_MCP_SERVER_ENTRY };
  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true, mode: 0o700 });
  atomicWriteJson(mcpConfigPath, config, { mode: 0o600, transactionId });
  return ok(undefined);
}

export function uninstallMcpRegistration(
  mcpConfigPath: string | null,
  expectedDigest = canonicalMcpEntryDigest(),
  transactionId?: string,
): Result<'removed' | 'already_absent' | 'foreign_preserved', RuntimeError> {
  if (!mcpConfigPath || !fs.existsSync(mcpConfigPath)) return ok('already_absent');
  const safePath = validateMcpConfigPath(mcpConfigPath);
  if (!safePath.ok) return safePath;

  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    if (!config.mcpServers || !config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME]) {
      return ok('already_absent');
    }
    const current = config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME];
    const currentDigest = sha256(canonicalJson(current));
    if (currentDigest !== expectedDigest) {
      return ok('foreign_preserved');
    }
    delete config.mcpServers[CANONICAL_OMA_MCP_SERVER_NAME];
    if (Object.keys(config.mcpServers).length === 0) {
      delete config.mcpServers;
    }
    atomicWriteJson(mcpConfigPath, config, { mode: 0o600, transactionId });
    return ok('removed');
  } catch (cause) {
    return err(runtimeError('E_CORRUPT_STATE', 'Failed to uninstall MCP registration', {
      cause: cause instanceof Error ? cause.message : String(cause),
    }));
  }
}

export function doctorMcpRegistration(
  mcpConfigPath: string | null,
  nativeDelegationAvailable: boolean,
): string | null {
  if (!nativeDelegationAvailable || !mcpConfigPath) return null;
  const safePath = validateMcpConfigPath(mcpConfigPath);
  if (!safePath.ok) return `MCP config path is unsafe: ${safePath.error.message}`;
  if (!fs.existsSync(mcpConfigPath)) return 'MCP config file is missing';
  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    const server = config.mcpServers?.[CANONICAL_OMA_MCP_SERVER_NAME];
    if (!server) return 'MCP config entry for oh-my-agy-agents is missing';
    if (!isCanonicalMcpEntry(server)) {
      return 'MCP config entry for oh-my-agy-agents is drifted';
    }
  } catch {
    return 'MCP config file is invalid JSON';
  }
  return null;
}
