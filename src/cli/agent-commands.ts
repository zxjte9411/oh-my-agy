import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CANONICAL_AGENT_ROLE_ALIASES_V1, resolveCanonicalAgentId } from '../agents/aliases';
import { AGENT_DELEGATION_MCP_SURFACE_V1 } from '../agents/delegation-mcp';
import {
  AgentInstallScopeV1,
  doctorNativeAgentInstallation,
  installNativeAgents,
} from '../agents/install';
import { CANONICAL_AGENT_REGISTRY_V1 } from '../agents/registry';
import { CANONICAL_AGENT_IDS_V1 } from '../agents/types';
import { startMcpNdjsonServer } from '../mcp/server';
import { HostCapabilityProfileV1 } from '../native/capability-profile';
import { runBoundedProbe } from '../native/probes/runner';
import { formatCliError } from '../runtime/error-catalog';
import { RuntimeError, runtimeError } from '../runtime/errors';
import { Result, err, ok } from '../runtime/types';
import { PluginCommandAdapter } from '../setup/plugin';
import { inspectNativeCapabilities } from './runtime-adapter';

export type AgentCliCommandV1 =
  | { readonly kind: 'list'; readonly asJson: boolean }
  | { readonly kind: 'inspect'; readonly role: string; readonly asJson: boolean }
  | { readonly kind: 'install'; readonly scope: AgentInstallScopeV1; readonly asJson: boolean }
  | { readonly kind: 'uninstall'; readonly scope: AgentInstallScopeV1; readonly asJson: boolean }
  | { readonly kind: 'doctor'; readonly scope: AgentInstallScopeV1; readonly asJson: boolean }
  | { readonly kind: 'mcp-server' };

export interface AgentCommandDependenciesV1 {
  readonly workspaceRoot: string;
  readonly homeDir?: string;
  readonly loadCapabilityProfile: () => Promise<Result<HostCapabilityProfileV1, RuntimeError>>;
  readonly startDelegationMcpServer?: () => Promise<number>;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface DefaultAgentCommandIoV1 {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export function parseAgentCommand(argv: readonly string[]): Result<AgentCliCommandV1, RuntimeError> {
  const subcommand = argv[0];
  if (subcommand === 'list') {
    return parseSimpleFormatCommand('list', argv.slice(1));
  }
  if (subcommand === 'inspect') {
    const positional = argv.slice(1).filter((value) => value !== '--json');
    const jsonCount = argv.filter((value) => value === '--json').length;
    if (jsonCount > 1 || positional.length !== 1 || positional[0].startsWith('--')) {
      return usage('agents inspect requires exactly one role and optional --json');
    }
    return ok({ kind: 'inspect', role: positional[0], asJson: jsonCount === 1 });
  }
  if (subcommand === 'install') {
    const parsed = parseScopedOptions(argv.slice(1), true);
    if (!parsed.ok) return parsed;
    return ok({ kind: 'install', scope: parsed.value.scope, asJson: parsed.value.asJson });
  }
  if (subcommand === 'uninstall') {
    const parsed = parseScopedOptions(argv.slice(1), true);
    if (!parsed.ok) return parsed;
    return ok({ kind: 'uninstall', scope: parsed.value.scope, asJson: parsed.value.asJson });
  }
  if (subcommand === 'doctor') {
    const parsed = parseScopedOptions(argv.slice(1), false);
    if (!parsed.ok) return parsed;
    return ok({ kind: 'doctor', scope: parsed.value.scope, asJson: parsed.value.asJson });
  }
  if (subcommand === 'mcp-server') {
    if (argv.length !== 1) return usage('agents mcp-server accepts no arguments');
    return ok({ kind: 'mcp-server' });
  }
  return usage('agents command must be one of: list, inspect, install, uninstall, doctor, mcp-server');
}

export async function runAgentCommand(
  command: Readonly<AgentCliCommandV1>,
  dependencies: Readonly<AgentCommandDependenciesV1>,
): Promise<number> {
  if (command.kind === 'mcp-server') {
    if (dependencies.startDelegationMcpServer === undefined) {
      dependencies.stderr(formatCliError(
        'E_VALIDATOR_REJECTED',
        'agent delegation MCP server is unavailable in this runtime',
      ));
      return 1;
    }
    return dependencies.startDelegationMcpServer();
  }

  if (command.kind === 'list') {
    const agents = CANONICAL_AGENT_IDS_V1.map((id) => CANONICAL_AGENT_REGISTRY_V1[id]);
    if (command.asJson) {
      dependencies.stdout(`${JSON.stringify({ schema: 'oma.agents-list/v1', agents }, null, 2)}\n`);
    } else {
      dependencies.stdout([
        `oma agents list (${agents.length} canonical agents)`,
        ...agents.map((agent) => `${agent.id}\tmodel=${agent.preferredModelTier}\tcapability=${agent.capabilityFloor}\tmain=${agent.mainAgent}\tsubagent=${agent.subagent}`),
        '',
      ].join('\n'));
    }
    return 0;
  }

  if (command.kind === 'inspect') {
    const canonicalId = resolveCanonicalAgentId(command.role);
    if (canonicalId === null) {
      dependencies.stderr(formatCliError('E_NOT_FOUND', `Unknown agent role: ${command.role}`));
      return 1;
    }
    const definition = CANONICAL_AGENT_REGISTRY_V1[canonicalId];
    const aliases = Object.entries(CANONICAL_AGENT_ROLE_ALIASES_V1)
      .filter(([, target]) => target === canonicalId)
      .map(([alias]) => alias)
      .sort();
    const body = {
      schema: 'oma.agent-inspect/v1',
      requestedRole: command.role,
      canonicalId,
      aliases,
      definition,
    };
    if (command.asJson) {
      dependencies.stdout(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      dependencies.stdout([
        `${command.role} -> ${canonicalId}`,
        definition.description,
        `model=${definition.preferredModelTier} capability=${definition.capabilityFloor}`,
        `mainAgent=${definition.mainAgent} subagent=${definition.subagent}`,
        `aliases=${aliases.join(', ')}`,
        '',
      ].join('\n'));
    }
    return 0;
  }

  const profile = await dependencies.loadCapabilityProfile();
  if (!profile.ok) {
    dependencies.stderr(formatCliError(profile.error.code, profile.error.message));
    return 1;
  }

  if (command.kind === 'install') {
    const installed = installNativeAgents({
      scope: command.scope,
      workspaceRoot: dependencies.workspaceRoot,
      homeDir: dependencies.homeDir,
      capabilityProfile: profile.value,
    });
    if (!installed.ok) {
      dependencies.stderr(formatCliError(installed.error.code, installed.error.message));
      return 1;
    }
    if (command.asJson) {
      dependencies.stdout(`${JSON.stringify({
        schema: 'oma.agents-install/v1',
        ok: true,
        ...installed.value,
      }, null, 2)}\n`);
    } else {
      dependencies.stdout(`${installed.value.idempotent ? 'verified existing' : 'installed'} ${CANONICAL_AGENT_IDS_V1.length} canonical agents at ${installed.value.agentsRoot}\n`);
      dependencies.stdout('Open /agents in Antigravity to verify discovery.\n');
    }
    return 0;
  }

  if (command.kind === 'uninstall') {
    const { uninstallNativeAgents } = await import('../agents/install');
    const uninstalled = uninstallNativeAgents({
      scope: command.scope,
      workspaceRoot: dependencies.workspaceRoot,
      homeDir: dependencies.homeDir,
    });
    if (!uninstalled.ok) {
      dependencies.stderr(formatCliError(uninstalled.error.code, uninstalled.error.message));
      return 1;
    }
    if (command.asJson) {
      dependencies.stdout(`${JSON.stringify({
        schema: 'oma.agents-uninstall/v1',
        ok: uninstalled.value.collisions.length === 0,
        ...uninstalled.value,
      }, null, 2)}\n`);
    } else {
      dependencies.stdout(`oma agents uninstall: ${uninstalled.value.status}\n`);
      for (const item of uninstalled.value.removed) dependencies.stdout(`- removed ${item}\n`);
      for (const item of uninstalled.value.collisions) dependencies.stdout(`- collision ${item}\n`);
    }
    return uninstalled.value.collisions.length === 0 ? 0 : 1;
  }

  const report = doctorNativeAgentInstallation({
    scope: command.scope,
    workspaceRoot: dependencies.workspaceRoot,
    homeDir: dependencies.homeDir,
    capabilityProfile: profile.value,
  });
  if (command.asJson) {
    dependencies.stdout(`${JSON.stringify({ schema: 'oma.agents-doctor/v1', ...report }, null, 2)}\n`);
  } else {
    dependencies.stdout(`oma agents doctor: ${report.status}\n`);
    dependencies.stdout(`scope=${report.scope} root=${report.agentsRoot}\n`);
    for (const diagnostic of report.diagnostics) dependencies.stdout(`- ${diagnostic}\n`);
  }
  return report.exitCode;
}

/** Production entrypoint using OMA's existing native capability inspector. */
export async function runDefaultAgentCommand(
  argv: readonly string[],
  io: Readonly<DefaultAgentCommandIoV1> = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  const parsed = parseAgentCommand(argv);
  if (!parsed.ok) {
    io.stderr(formatCliError(parsed.error.code, parsed.error.message));
    return 2;
  }
  const workspaceRoot = process.cwd();
  const agyCommand = process.env.OMA_AGY_BIN?.trim() || 'agy';
  const packageRoot = findPackageRoot(__dirname);
  return runAgentCommand(parsed.value, {
    workspaceRoot,
    homeDir: os.homedir(),
    stdout: io.stdout,
    stderr: io.stderr,
    startDelegationMcpServer: async () => {
      const stateRoot = process.env.OMA_STATE_ROOT ?? path.join(workspaceRoot, '.agy', 'state');
      startMcpNdjsonServer(
        { repositoryRoot: workspaceRoot, stateRoot },
        process.stdin,
        process.stdout,
        AGENT_DELEGATION_MCP_SURFACE_V1,
      );
      if (process.stdin.readableEnded) return 0;
      await new Promise<void>((resolve) => { process.stdin.once('end', resolve); });
      return 0;
    },
    loadCapabilityProfile: async () => {
      try {
        const inspected = await inspectNativeCapabilities({
          agyCommand,
          stateRoot: process.env.OMA_STATE_ROOT,
          environment: process.env,
          packageRoot,
          pluginAdapter: boundedAgyPluginAdapter(agyCommand, workspaceRoot),
          cwd: workspaceRoot,
        }, false);
        if (inspected.kind !== 'profile') {
          return err(runtimeError(
            'E_CAPABILITY_UNPROVEN',
            inspected.diagnostics[0]?.message ?? 'Antigravity custom-agent capability profile is unavailable',
          ));
        }
        return ok(inspected.profile);
      } catch (cause) {
        return err(runtimeError(
          'E_CAPABILITY_UNPROVEN',
          'Antigravity custom-agent capability inspection failed',
          { cause: cause instanceof Error ? cause.message : String(cause) },
        ));
      }
    },
  });
}

function parseSimpleFormatCommand(
  kind: 'list',
  argv: readonly string[],
): Result<AgentCliCommandV1, RuntimeError> {
  if (argv.length === 0) return ok({ kind, asJson: false });
  if (argv.length === 1 && argv[0] === '--json') return ok({ kind, asJson: true });
  return usage(`agents ${kind} accepts only optional --json`);
}

function parseScopedOptions(
  argv: readonly string[],
  scopeRequired: boolean,
): Result<{ scope: AgentInstallScopeV1; asJson: boolean }, RuntimeError> {
  let scope: AgentInstallScopeV1 | undefined;
  let asJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      if (asJson) return usage('agents command received duplicate --json');
      asJson = true;
      continue;
    }
    if (arg === '--scope') {
      if (scope !== undefined) return usage('agents command received duplicate --scope');
      const value = argv[index + 1];
      if (value !== 'project' && value !== 'user') return usage('agents --scope must be project or user');
      scope = value;
      index += 1;
      continue;
    }
    return usage(`agents command received unexpected argument: ${arg}`);
  }
  if (scopeRequired && scope === undefined) return usage('agents install requires --scope project|user');
  return ok({ scope: scope ?? 'project', asJson });
}

function boundedAgyPluginAdapter(agyCommand: string, cwd: string): PluginCommandAdapter {
  return {
    async run(argv) {
      const outcome = await runBoundedProbe({
        command: agyCommand,
        argv,
        cwd,
        environment: process.env,
        timeoutMs: 5_000,
        maximumOutputBytes: 64 * 1024,
        maximumProcesses: 8,
      });
      return {
        argv: [...argv],
        code: outcome.timedOut ? 124 : outcome.status ?? 1,
        stdout: outcome.stdout,
        stderr: outcome.stderr || outcome.error || '',
      };
    },
  };
}

function findPackageRoot(start: string): string {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, 'plugin.json'))
      && fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start, '../..');
}

function usage<T = never>(message: string): Result<T, RuntimeError> {
  return err(runtimeError('E_VALIDATOR_REJECTED', message));
}
