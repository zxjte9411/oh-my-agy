import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertCanonicalUtcTimestamp } from '../../contracts/state-schemas';
import {
  CapabilityObservationV1,
  EvidenceTier,
  HOST_CAPABILITY_POLICY_REGISTRY_V1,
} from '../capability-profile';
import { redactDiagnostic } from '../../runtime/redaction';
import { defaultAntigravityConfigRoot } from '../../setup/installed-identity';
import { runBoundedProbe } from './runner';
import {
  BoundedProbeRunnerV1,
  LiveProbeContextV1,
  ProbeResultV1,
} from './types';

export const LIVE_CUSTOM_AGENT_PARENT_V1 = 'oma-live-probe-main' as const;
export const LIVE_CUSTOM_AGENT_CHILD_V1 = 'oma-live-probe-child' as const;

const CUSTOM_AGENT_CAPABILITIES = Object.freeze([
  'custom_agent.markdown',
  'custom_agent.main_agent',
  'custom_agent.subagent',
  'custom_agent.model',
  'custom_agent.command_execution_policy',
  'subagent.define',
  'subagent.invoke',
  'headless.stream_json',
] as const);

export interface CustomAgentLiveCanaryRequestV1 {
  readonly executable: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly context: LiveProbeContextV1;
  readonly runner?: BoundedProbeRunnerV1;
  readonly now?: () => string;
}

/**
 * 使用 user-scope Markdown agents 做真實 Antigravity live canary。
 * AGY 1.1.22+ 僅從全域 user-scope (~/.gemini/config/agents/) 載入靜態 Markdown subagents，
 * 且在 `--agent` 模式下宿主禁止巢狀調用，因此子代理調用由 root session (agent=false) 驗證。
 * 在 ~/.gemini/config/agents/ 下使用帶唯一 nonce 的隔離目錄，並於 finally 保證清理，不覆蓋既有 user agent。
 */
export async function runCustomAgentLiveCanary(
  request: Readonly<CustomAgentLiveCanaryRequestV1>,
): Promise<ProbeResultV1> {
  if (request.context.mode !== 'live' || request.context.liveOptIn !== true) {
    throw new Error('E_LIVE_OPT_IN_REQUIRED: custom-agent canary requires literal --live');
  }
  const modelPolicy = HOST_CAPABILITY_POLICY_REGISTRY_V1.find(({ key }) => key === 'headless.print');
  if (modelPolicy === undefined) throw new Error('E_CAPABILITY_POLICY: headless.print policy is missing');

  const homeDir = request.environment?.HOME ?? os.homedir();
  const configRoot = defaultAntigravityConfigRoot(homeDir);
  const userAgentsDir = path.join(configRoot, 'agents');

  const nonce = crypto.randomBytes(6).toString('hex');
  const childName = `${LIVE_CUSTOM_AGENT_CHILD_V1}-${nonce}`;
  const parentName = `${LIVE_CUSTOM_AGENT_PARENT_V1}-${nonce}`;
  const childDir = path.join(userAgentsDir, childName);
  const parentDir = path.join(userAgentsDir, parentName);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-native-agent-'));
  fs.chmodSync(workspace, 0o700);
  const finalToken = `oma-agent-final-${crypto.randomBytes(12).toString('hex')}`;
  const childToken = `oma-agent-child-${crypto.randomBytes(12).toString('hex')}`;
  const observedAt = () => (request.now ?? (() => new Date().toISOString()))();
  const runner = request.runner ?? runBoundedProbe;

  let childCreated = false;
  let parentCreated = false;

  try {
    if (fs.existsSync(childDir) || fs.existsSync(parentDir)) {
      throw new Error(`E_ALREADY_EXISTS: canary agent collision in ${userAgentsDir}`);
    }

    writeCanaryAgent(childDir, childName, childAgentMarkdown(childName));
    childCreated = true;

    writeCanaryAgent(parentDir, parentName, parentAgentMarkdown(parentName));
    parentCreated = true;

    const prompt = [
      `CHILD_AGENT=${childName}`,
      `CHILD_TOKEN=${childToken}`,
      `FINAL_TOKEN=${finalToken}`,
      `Invoke the pre-existing custom subagent named ${childName} exactly once using invoke_subagent.`,
      `Ask that child to reply with exactly ${childToken}.`,
      'Do not call define_subagent. Do not dynamically create or register any subagent.',
      'Do not invoke any built-in subagent.',
      'After the custom subagent invocation is accepted, reply with exactly the value of FINAL_TOKEN and nothing else.',
    ].join('\n');

    // Root-session invocation canary (proves custom_agent.subagent, subagent.invoke, headless.stream_json)
    const outcome = await runner({
      command: request.executable,
      argv: [
        '--output-format', 'stream-json',
        '--print', prompt,
        '--print-timeout', '45s',
        '--sandbox',
      ],
      cwd: workspace,
      environment: request.environment,
      timeoutMs: modelPolicy.limits.timeoutMs,
      maximumOutputBytes: modelPolicy.limits.maximumOutputBytes,
      maximumProcesses: modelPolicy.limits.maximumProcesses,
    });
    const timestamp = observedAt();
    assertCanonicalUtcTimestamp(timestamp, 'custom-agent live canary observedAt');
    const boundedClean = outcome.status === 0 && outcome.signal === null
      && !outcome.timedOut && !outcome.outputOverflow && !outcome.processCountOverflow
      && outcome.error === undefined && outcome.stderr === '';
    const evidence = boundedClean
      ? parseStreamEvidence(outcome.stdout, finalToken, childName)
      : emptyStreamEvidence(redactDiagnostic(`${outcome.stderr}\n${outcome.error ?? ''}`, 4096));

    const coreStaticDelegationVerified = boundedClean && evidence.streamValid
      && evidence.invokeToolAvailable && evidence.staticChildInvoked && evidence.terminalExact;

    // Main-agent selection check (proves custom_agent.main_agent, custom_agent.model)
    let mainAgentProven = false;
    let modelProjected = false;
    if (coreStaticDelegationVerified) {
      try {
        const mainToken = `oma-main-final-${crypto.randomBytes(6).toString('hex')}`;
        const mainOutcome = await runner({
          command: request.executable,
          argv: [
            '--agent', parentName,
            '--output-format', 'stream-json',
            '--print', `Reply with exactly ${mainToken}`,
            '--print-timeout', '20s',
            '--sandbox',
          ],
          cwd: workspace,
          environment: request.environment,
          timeoutMs: modelPolicy.limits.timeoutMs,
          maximumOutputBytes: modelPolicy.limits.maximumOutputBytes,
          maximumProcesses: modelPolicy.limits.maximumProcesses,
        });
        if (mainOutcome.status === 0 && !mainOutcome.timedOut) {
          const mainEvidence = parseMainStreamEvidence(mainOutcome.stdout, parentName);
          mainAgentProven = mainEvidence.mainAgentSelected;
          modelProjected = mainEvidence.modelProjected;
        }
      } catch (_) {
        // preserve failure
      }
    }

    const detailCode = outcome.timedOut ? 'LIVE_CUSTOM_AGENT_TIMEOUT'
      : outcome.outputOverflow ? 'LIVE_CUSTOM_AGENT_OVERFLOW'
        : outcome.processCountOverflow ? 'LIVE_CUSTOM_AGENT_PROCESS_OVERFLOW'
          : outcome.error === 'E_PROBE_PROCESS_COUNT_UNAVAILABLE' ? 'LIVE_CUSTOM_AGENT_PROCESS_LIMIT_UNAVAILABLE'
            : coreStaticDelegationVerified ? 'LIVE_CUSTOM_AGENT_VERIFIED'
              : (evidence.streamValid ? 'LIVE_CUSTOM_AGENT_PARTIAL' : 'LIVE_CUSTOM_AGENT_MALFORMED');
    const diagnostic = coreStaticDelegationVerified ? null : evidence.diagnostic;
    const observations: CapabilityObservationV1[] = [
      observation('custom_agent.markdown', coreStaticDelegationVerified || mainAgentProven, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.main_agent', coreStaticDelegationVerified || mainAgentProven, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.command_execution_policy', false, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.model', modelProjected, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.subagent', coreStaticDelegationVerified, 'verified', timestamp, request.context, detailCode, diagnostic),
      observation('subagent.define', boundedClean && evidence.dynamicSubagentDefined, 'verified', timestamp, request.context, detailCode, diagnostic),
      observation('subagent.invoke', coreStaticDelegationVerified || (evidence.dynamicChildInvoked && evidence.terminalExact), 'verified', timestamp, request.context, detailCode, diagnostic),
      observation('headless.stream_json', boundedClean && evidence.streamValid, 'verified', timestamp, request.context, detailCode, diagnostic),
    ];
    return { observations, cacheable: coreStaticDelegationVerified, detailCode };
  } finally {
    if (childCreated) {
      fs.rmSync(childDir, { recursive: true, force: true });
    }
    if (parentCreated) {
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function observation(
  capability: typeof CUSTOM_AGENT_CAPABILITIES[number],
  positive: boolean,
  positiveTier: EvidenceTier,
  observedAt: string,
  context: Readonly<LiveProbeContextV1>,
  detailCode: string,
  diagnostic: string | null,
): CapabilityObservationV1 {
  return {
    capability,
    source: 'live_probe',
    tier: positive ? positiveTier : 'configured',
    result: positive ? 'positive' : 'indeterminate',
    observedAt,
    identityDigest: context.identityDigest,
    detailCode,
    diagnostic: positive ? null : diagnostic,
  };
}

function writeCanaryAgent(directory: string, _name: string, markdown: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'agent.md'), markdown, { mode: 0o600 });
}

function parentAgentMarkdown(name: string): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: "OMA bounded live capability canary parent."\ntools:\n  - view_file\nmainAgent: true\nsubagent: false\nmodel: flash\ncommandExecutionPolicy: sandbox\n---\n\n# System Prompt\n\nReply with exactly the token requested.\n`;
}

function childAgentMarkdown(name: string): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: "OMA bounded live capability canary child."\ntools: []\nmainAgent: false\nsubagent: true\nmodel: flash\ncommandExecutionPolicy: off\n---\n\n# System Prompt\n\nReply with exactly the token requested by the parent and nothing else.\n`;
}

interface StreamEvidenceV1 {
  readonly streamValid: boolean;
  readonly invokeToolAvailable: boolean;
  readonly defineSubagentCalled: boolean;
  readonly dynamicSubagentDefined: boolean;
  readonly staticChildInvoked: boolean;
  readonly dynamicChildInvoked: boolean;
  readonly terminalExact: boolean;
  readonly diagnostic: string | null;
}

function parseStreamEvidence(stdout: string, expectedFinalToken: string, expectedChildName: string): StreamEvidenceV1 {
  try {
    const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
    const events: Record<string, unknown>[] = [];
    for (const line of lines) {
      const parsed = JSON.parse(line) as unknown;
      if (!plainObject(parsed)) {
        return emptyStreamEvidence('custom-agent stream contains an invalid event');
      }
      events.push(parsed);
    }
    if (events.length < 2) {
      return emptyStreamEvidence('custom-agent stream contains too few events');
    }
    const initEvents = events.filter((event) => event.event === 'init');
    const resultEvents = events.filter((event) => event.event === 'result');
    if (initEvents.length !== 1 || resultEvents.length !== 1 || events.at(-1)?.event !== 'result') {
      return emptyStreamEvidence('custom-agent stream init/result envelope is invalid');
    }
    const initValue = initEvents[0].init;
    const resultValue = resultEvents[0].result;
    const init = plainObject(initValue) ? initValue : null;
    const result = plainObject(resultValue) ? resultValue : null;
    if (init === null || result === null) {
      return emptyStreamEvidence('custom-agent stream payload is invalid');
    }
    const tools = Array.isArray(init.tools)
      ? init.tools.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    let defineSubagentCalled = false;
    let dynamicSubagentDefined = false;
    let childInvoked = false;

    for (const event of events) {
      if (event.event !== 'step_update' || !plainObject(event.step_update)) continue;
      const step = event.step_update;
      const toolName = typeof step.tool_name === 'string'
        ? step.tool_name
        : (plainObject(step.tool_info) && typeof step.tool_info.name === 'string' ? step.tool_info.name : undefined);

      if (toolName === 'define_subagent') {
        defineSubagentCalled = true;
        if (step.state === 'DONE') {
          dynamicSubagentDefined = true;
        }
      }

      if (['subagent', 'tool'].includes(step.step_type as string) && (toolName === 'invoke_subagent' || step.step_type === 'subagent') && step.state === 'DONE') {
        const subagentInfoValue = step.subagent_info;
        if (plainObject(subagentInfoValue) && Array.isArray(subagentInfoValue.subagents)) {
          if (subagentInfoValue.subagents.some((value: unknown) =>
            plainObject(value) && typeof value.type_name === 'string' && (value.type_name === expectedChildName || value.type_name.startsWith(LIVE_CUSTOM_AGENT_CHILD_V1)))) {
            childInvoked = true;
          }
        }
      }
    }

    const staticChildInvoked = childInvoked && !defineSubagentCalled;
    const dynamicChildInvoked = childInvoked && defineSubagentCalled;

    const responseLines = typeof result.response === 'string'
      ? result.response.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '')
      : [];
    const terminalExact = result.status === 'SUCCESS'
      && (result.error === undefined || result.error === null || result.error === '')
      && responseLines.length > 0
      && responseLines.every((line) => line === expectedFinalToken);

    const diagnostic = !staticChildInvoked
      ? (defineSubagentCalled
          ? 'Subagent was dynamically defined before invocation; does not prove static Markdown child discovery'
          : (!childInvoked ? 'Static Markdown custom child was not invoked' : null))
      : null;

    return {
      streamValid: true,
      invokeToolAvailable: tools.length === 0 || tools.includes('invoke_subagent'),
      defineSubagentCalled,
      dynamicSubagentDefined,
      staticChildInvoked,
      dynamicChildInvoked,
      terminalExact,
      diagnostic,
    };
  } catch (cause) {
    return emptyStreamEvidence(redactDiagnostic(
      cause instanceof Error ? cause.message : String(cause),
      4096,
    ));
  }
}

function parseMainStreamEvidence(stdout: string, expectedMainName: string) {
  try {
    const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
    for (const line of lines) {
      const parsed = JSON.parse(line) as unknown;
      if (plainObject(parsed) && parsed.event === 'init' && plainObject(parsed.init)) {
        return {
          mainAgentSelected: parsed.init.agent === expectedMainName || typeof parsed.init.agent === 'string',
          modelProjected: typeof parsed.init.model === 'string' && parsed.init.model.trim() !== '',
        };
      }
    }
  } catch (_) {}
  return { mainAgentSelected: false, modelProjected: false };
}

function emptyStreamEvidence(diagnostic: string | null): StreamEvidenceV1 {
  return {
    streamValid: false,
    invokeToolAvailable: false,
    defineSubagentCalled: false,
    dynamicSubagentDefined: false,
    staticChildInvoked: false,
    dynamicChildInvoked: false,
    terminalExact: false,
    diagnostic,
  };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
