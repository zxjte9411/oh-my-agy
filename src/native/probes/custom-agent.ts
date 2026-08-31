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
import { runBoundedProbe } from './runner';
import {
  BoundedProbeRunnerV1,
  LiveProbeContextV1,
  PASSIVE_PROBE_LIMITS_V1,
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

interface StreamEvidenceV1 {
  readonly streamValid: boolean;
  readonly mainAgentSelected: boolean;
  readonly modelProjected: boolean;
  readonly invokeToolAvailable: boolean;
  readonly childInvoked: boolean;
  readonly terminalExact: boolean;
  readonly diagnostic: string | null;
}

/**
 * 使用 workspace-local Markdown agents 做真實 Antigravity live canary。
 * 不寫入 ~/.gemini，不放寬 capability gate；任何不完整 stream 都只留下 indeterminate evidence。
 */
export async function runCustomAgentLiveCanary(
  request: Readonly<CustomAgentLiveCanaryRequestV1>,
): Promise<ProbeResultV1> {
  if (request.context.mode !== 'live' || request.context.liveOptIn !== true) {
    throw new Error('E_LIVE_OPT_IN_REQUIRED: custom-agent canary requires literal --live');
  }
  const modelPolicy = HOST_CAPABILITY_POLICY_REGISTRY_V1.find(({ key }) => key === 'headless.print');
  if (modelPolicy === undefined) throw new Error('E_CAPABILITY_POLICY: headless.print policy is missing');

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-native-agent-'));
  fs.chmodSync(workspace, 0o700);
  const finalToken = `oma-agent-final-${crypto.randomBytes(12).toString('hex')}`;
  const childToken = `oma-agent-child-${crypto.randomBytes(12).toString('hex')}`;
  const observedAt = () => (request.now ?? (() => new Date().toISOString()))();
  const runner = request.runner ?? runBoundedProbe;
  try {
    const helpOutcome = await runner({
      command: request.executable,
      argv: ['--help'],
      cwd: workspace,
      environment: request.environment,
      timeoutMs: PASSIVE_PROBE_LIMITS_V1.timeoutMs,
      maximumOutputBytes: PASSIVE_PROBE_LIMITS_V1.maximumOutputBytes,
      maximumProcesses: PASSIVE_PROBE_LIMITS_V1.maximumProcesses,
    });
    if (!advertisesCustomAgentSurface(helpOutcome)) {
      return { observations: [], cacheable: true, detailCode: 'LIVE_CUSTOM_AGENT_NOT_ADVERTISED' };
    }

    writeCanaryAgent(workspace, LIVE_CUSTOM_AGENT_PARENT_V1, parentAgentMarkdown());
    writeCanaryAgent(workspace, LIVE_CUSTOM_AGENT_CHILD_V1, childAgentMarkdown());
    const prompt = [
      `CHILD_AGENT=${LIVE_CUSTOM_AGENT_CHILD_V1}`,
      `CHILD_TOKEN=${childToken}`,
      `FINAL_TOKEN=${finalToken}`,
      `Invoke the custom subagent named ${LIVE_CUSTOM_AGENT_CHILD_V1} exactly once.`,
      `Ask that child to reply with exactly ${childToken}.`,
      'Do not invoke any built-in subagent.',
      'After the custom subagent invocation is accepted, reply with exactly the value of FINAL_TOKEN and nothing else.',
    ].join('\n');
    const outcome = await runner({
      command: request.executable,
      argv: [
        '--agent', LIVE_CUSTOM_AGENT_PARENT_V1,
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
      ? parseStreamEvidence(outcome.stdout, finalToken)
      : emptyStreamEvidence(redactDiagnostic(`${outcome.stderr}\n${outcome.error ?? ''}`, 4096));
    const baseSelected = boundedClean && evidence.streamValid
      && evidence.mainAgentSelected && evidence.invokeToolAvailable && evidence.terminalExact;
    const fullyVerified = baseSelected && evidence.modelProjected && evidence.childInvoked;
    const detailCode = outcome.timedOut ? 'LIVE_CUSTOM_AGENT_TIMEOUT'
      : outcome.outputOverflow ? 'LIVE_CUSTOM_AGENT_OVERFLOW'
        : outcome.processCountOverflow ? 'LIVE_CUSTOM_AGENT_PROCESS_OVERFLOW'
          : outcome.error === 'E_PROBE_PROCESS_COUNT_UNAVAILABLE' ? 'LIVE_CUSTOM_AGENT_PROCESS_LIMIT_UNAVAILABLE'
            : fullyVerified ? 'LIVE_CUSTOM_AGENT_VERIFIED'
              : baseSelected ? 'LIVE_CUSTOM_AGENT_PARTIAL' : 'LIVE_CUSTOM_AGENT_MALFORMED';
    const diagnostic = fullyVerified ? null : evidence.diagnostic;
    const observations: CapabilityObservationV1[] = [
      observation('custom_agent.markdown', baseSelected, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.main_agent', baseSelected, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.command_execution_policy', baseSelected, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.model', baseSelected && evidence.modelProjected, 'observed', timestamp, request.context, detailCode, diagnostic),
      observation('custom_agent.subagent', baseSelected && evidence.childInvoked, 'verified', timestamp, request.context, detailCode, diagnostic),
      observation('subagent.define', baseSelected && evidence.childInvoked, 'verified', timestamp, request.context, detailCode, diagnostic),
      observation('subagent.invoke', baseSelected && evidence.childInvoked, 'verified', timestamp, request.context, detailCode, diagnostic),
      observation('headless.stream_json', baseSelected, 'verified', timestamp, request.context, detailCode, diagnostic),
    ];
    return { observations, cacheable: fullyVerified, detailCode };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function advertisesCustomAgentSurface(outcome: Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputOverflow: boolean;
  processCountOverflow: boolean;
  error?: string;
}>): boolean {
  if (outcome.status !== 0 || outcome.timedOut || outcome.outputOverflow
    || outcome.processCountOverflow || outcome.error !== undefined) return false;
  const help = `${outcome.stdout}\n${outcome.stderr}`;
  return /(?:^|\s)--agent(?:[\s=,]|$)/mu.test(help)
    && /(?:^|[\s,(|])(?:--)?stream-json(?=$|[\s,):|])/imu.test(help);
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

function writeCanaryAgent(workspace: string, name: string, markdown: string): void {
  const directory = path.join(workspace, '.agents', 'agents', name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'agent.md'), markdown, { mode: 0o600 });
}

function parentAgentMarkdown(): string {
  return `---\nname: ${LIVE_CUSTOM_AGENT_PARENT_V1}\ndescription: OMA bounded live capability canary parent.\ntools:\n  - invoke_subagent\nmainAgent: true\nsubagent: false\nmodel: flash\ncommandExecutionPolicy: off\n---\n\n# System Prompt\n\nYou are a bounded OMA capability canary. Follow the user request exactly. Invoke only the explicitly named custom subagent and do not use any other tool.\n`;
}

function childAgentMarkdown(): string {
  return `---\nname: ${LIVE_CUSTOM_AGENT_CHILD_V1}\ndescription: OMA bounded live capability canary child.\ntools: []\nmainAgent: false\nsubagent: true\nmodel: flash\ncommandExecutionPolicy: off\n---\n\n# System Prompt\n\nReply with exactly the token requested by the parent and nothing else.\n`;
}

function parseStreamEvidence(stdout: string, expectedFinalToken: string): StreamEvidenceV1 {
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
    const childInvoked = events.some((event) => {
      const stepValue = event.step_update;
      if (event.event !== 'step_update' || !plainObject(stepValue)) return false;
      const step = stepValue;
      const subagentInfoValue = step.subagent_info;
      if (step.state !== 'DONE' || step.step_type !== 'tool' || step.tool_name !== 'invoke_subagent'
        || !plainObject(subagentInfoValue) || !Array.isArray(subagentInfoValue.subagents)) return false;
      return subagentInfoValue.subagents.some((value: unknown) =>
        plainObject(value) && value.type_name === LIVE_CUSTOM_AGENT_CHILD_V1);
    });
    return {
      streamValid: true,
      mainAgentSelected: init.agent === LIVE_CUSTOM_AGENT_PARENT_V1,
      modelProjected: typeof init.model === 'string' && init.model.trim() !== '',
      invokeToolAvailable: tools.includes('invoke_subagent'),
      childInvoked,
      terminalExact: result.status === 'SUCCESS'
        && typeof result.response === 'string'
        && result.response.trim() === expectedFinalToken
        && (result.error === undefined || result.error === null || result.error === ''),
      diagnostic: null,
    };
  } catch (cause) {
    return emptyStreamEvidence(redactDiagnostic(
      cause instanceof Error ? cause.message : String(cause),
      4096,
    ));
  }
}

function emptyStreamEvidence(diagnostic: string | null): StreamEvidenceV1 {
  return {
    streamValid: false,
    mainAgentSelected: false,
    modelProjected: false,
    invokeToolAvailable: false,
    childInvoked: false,
    terminalExact: false,
    diagnostic,
  };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
