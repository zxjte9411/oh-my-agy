import * as fs from 'fs';
import * as path from 'path';
import {
  LIVE_CUSTOM_AGENT_CHILD_V1,
  LIVE_CUSTOM_AGENT_PARENT_V1,
  runCustomAgentLiveCanary,
} from '../../../src/native/probes/custom-agent';
import { absentPluginIdentity } from '../../../src/native/probes/identity';
import { LiveProbeContextV1 } from '../../../src/native/probes/types';

const context: LiveProbeContextV1 = {
  mode: 'live',
  liveOptIn: true,
  evaluationTimestamp: '2026-08-31T06:00:00.000Z',
  identityDigest: 'd'.repeat(64),
  hostIdentity: {
    realpath: '/agy',
    binarySha256: 'a'.repeat(64),
    version: '2.0.0',
    versionOutputSha256: 'b'.repeat(64),
    helpOutputSha256: 'c'.repeat(64),
    platform: 'linux',
    arch: 'x64',
  },
  pluginIdentity: absentPluginIdentity(),
};

describe('custom-agent live canary', () => {
  test('proves selected Markdown agent and exact custom subagent invocation from stream-json', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        expect(request.argv).toEqual(expect.arrayContaining([
          '--agent', LIVE_CUSTOM_AGENT_PARENT_V1,
          '--output-format', 'stream-json',
          '--sandbox',
        ]));
        expect(request.maximumProcesses).toBe(32);
        expect(fs.existsSync(path.join(
          workspace,
          '.agents',
          'agents',
          LIVE_CUSTOM_AGENT_PARENT_V1,
          'agent.md',
        ))).toBe(true);
        expect(fs.existsSync(path.join(
          workspace,
          '.agents',
          'agents',
          LIVE_CUSTOM_AGENT_CHILD_V1,
          'agent.md',
        ))).toBe(true);
        const prompt = valueAfter(request.argv, '--print');
        const finalToken = marker(prompt, 'FINAL_TOKEN');
        return successfulStream(finalToken, true);
      },
    });

    expect(result).toMatchObject({ cacheable: true, detailCode: 'LIVE_CUSTOM_AGENT_VERIFIED' });
    for (const key of [
      'custom_agent.markdown',
      'custom_agent.main_agent',
      'custom_agent.subagent',
      'subagent.invoke',
      'headless.stream_json',
    ]) {
      expect(result.observations.find(({ capability }) => capability === key)).toMatchObject({
        result: 'positive',
        source: 'live_probe',
      });
    }
    expect(result.observations.find(({ capability }) => capability === 'subagent.define'))
      .toMatchObject({ result: 'indeterminate', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.command_execution_policy'))
      .toMatchObject({ result: 'indeterminate', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ tier: 'verified' });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('proves core native agent and delegation even when init.model is missing', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        const finalToken = marker(valueAfter(request.argv, '--print'), 'FINAL_TOKEN');
        return successfulStream(finalToken, true, {
          omitInitModel: true,
          stepType: 'subagent',
          response: `${finalToken}\n${finalToken}\n`,
        });
      },
    });

    expect(result).toMatchObject({ cacheable: true, detailCode: 'LIVE_CUSTOM_AGENT_VERIFIED' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.markdown'))
      .toMatchObject({ result: 'positive', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.main_agent'))
      .toMatchObject({ result: 'positive', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.subagent'))
      .toMatchObject({ result: 'positive', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ result: 'positive', tier: 'verified', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.model'))
      .toMatchObject({ result: 'indeterminate', source: 'live_probe' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.command_execution_policy'))
      .toMatchObject({ result: 'indeterminate', source: 'live_probe' });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('attempts the bounded canary after explicit live opt-in even when the host rejects the flags', async () => {
    let calls = 0;
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        calls += 1;
        workspace = request.cwd ?? '';
        expect(request.argv).toEqual(expect.arrayContaining([
          '--agent', LIVE_CUSTOM_AGENT_PARENT_V1,
          '--output-format', 'stream-json',
        ]));
        return {
          status: 2,
          signal: null,
          stdout: '',
          stderr: 'unknown option --agent',
          timedOut: false,
          outputOverflow: false,
          processCountOverflow: false,
        };
      },
    });

    expect(result).toMatchObject({ cacheable: false, detailCode: 'LIVE_CUSTOM_AGENT_MALFORMED' });
    expect(result.observations).toHaveLength(8);
    expect(result.observations.every(({ result: outcome }) => outcome === 'indeterminate')).toBe(true);
    expect(calls).toBe(1);
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('keeps delegation unknown when the stream never proves the requested custom child', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        const finalToken = marker(valueAfter(request.argv, '--print'), 'FINAL_TOKEN');
        return successfulStream(finalToken, false, { omitInitModel: true });
      },
    });

    expect(result).toMatchObject({ cacheable: false, detailCode: 'LIVE_CUSTOM_AGENT_PARTIAL' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.markdown'))
      .toMatchObject({ result: 'positive', tier: 'observed' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.model'))
      .toMatchObject({ result: 'indeterminate' });
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.subagent'))
      .toMatchObject({ result: 'indeterminate' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ result: 'indeterminate' });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('keeps all agent evidence indeterminate on a bounded timeout and still removes the workspace', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        return {
          status: null,
          signal: 'SIGKILL',
          stdout: '',
          stderr: '',
          timedOut: true,
          outputOverflow: false,
          processCountOverflow: false,
        };
      },
    });

    expect(result).toMatchObject({ cacheable: false, detailCode: 'LIVE_CUSTOM_AGENT_TIMEOUT' });
    expect(result.observations.every(({ result: outcome }) => outcome === 'indeterminate')).toBe(true);
    expect(fs.existsSync(workspace)).toBe(false);
  });
  test('recognizes real AGY step_type: subagent and accepts duplicated final-token lines', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        const finalToken = marker(valueAfter(request.argv, '--print'), 'FINAL_TOKEN');
        return successfulStream(finalToken, true, {
          stepType: 'subagent',
          response: `${finalToken}\n${finalToken}\n`,
        });
      },
    });

    expect(result).toMatchObject({ cacheable: true, detailCode: 'LIVE_CUSTOM_AGENT_VERIFIED' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ result: 'positive', tier: 'verified' });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('rejects response containing an extra unrelated line', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        const finalToken = marker(valueAfter(request.argv, '--print'), 'FINAL_TOKEN');
        return successfulStream(finalToken, true, {
          response: `${finalToken}\nunrelated extra output\n`,
        });
      },
    });

    expect(result).toMatchObject({ cacheable: false, detailCode: 'LIVE_CUSTOM_AGENT_MALFORMED' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ result: 'indeterminate' });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('rejects child invocation when subagent type_name does not match', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        const finalToken = marker(valueAfter(request.argv, '--print'), 'FINAL_TOKEN');
        return successfulStream(finalToken, true, {
          childTypeName: 'wrong-child-agent-name',
        });
      },
    });

    expect(result).toMatchObject({ cacheable: false, detailCode: 'LIVE_CUSTOM_AGENT_PARTIAL' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ result: 'indeterminate' });
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('rejects static Markdown-child verification if define_subagent step occurs before invoke_subagent', async () => {
    let workspace = '';
    const result = await runCustomAgentLiveCanary({
      executable: '/agy',
      context,
      now: () => '2026-08-31T06:00:30.000Z',
      runner: async (request) => {
        workspace = request.cwd ?? '';
        const finalToken = marker(valueAfter(request.argv, '--print'), 'FINAL_TOKEN');
        return successfulStream(finalToken, true, {
          includeDefineSubagent: true,
        });
      },
    });

    expect(result).toMatchObject({ cacheable: false, detailCode: 'LIVE_CUSTOM_AGENT_PARTIAL' });
    // custom_agent.subagent must NOT be verified because define_subagent was used
    expect(result.observations.find(({ capability }) => capability === 'custom_agent.subagent'))
      .toMatchObject({ result: 'indeterminate' });
    // subagent.define and subagent.invoke can be positive
    expect(result.observations.find(({ capability }) => capability === 'subagent.define'))
      .toMatchObject({ result: 'positive', tier: 'verified' });
    expect(result.observations.find(({ capability }) => capability === 'subagent.invoke'))
      .toMatchObject({ result: 'positive', tier: 'verified' });
    expect(fs.existsSync(workspace)).toBe(false);
  });
});

function successfulStream(
  finalToken: string,
  includeChild: boolean,
  options?: {
    stepType?: 'subagent' | 'tool';
    childTypeName?: string;
    response?: string;
    omitInitModel?: boolean;
    includeDefineSubagent?: boolean;
  },
) {
  const events: unknown[] = [
    {
      event: 'init',
      conversation_id: 'fixture-stream',
      init: {
        cwd: '/workspace',
        tools: ['invoke_subagent'],
        permission_mode: 'request-review',
        ...(options?.omitInitModel === true ? {} : { model: 'fixture-flash' }),
        agent: LIVE_CUSTOM_AGENT_PARENT_V1,
      },
    },
  ];
  if (options?.includeDefineSubagent === true) {
    events.push({
      event: 'step_update',
      step_update: {
        conversation_id: 'fixture-stream',
        step_index: 1,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'define_subagent',
        tool_info: {
          name: 'define_subagent',
          parameters: {
            name: LIVE_CUSTOM_AGENT_CHILD_V1,
          },
        },
      },
    });
  }
  if (includeChild) {
    events.push({
      event: 'step_update',
      step_update: {
        conversation_id: 'fixture-stream',
        step_index: options?.includeDefineSubagent === true ? 2 : 1,
        state: 'DONE',
        step_type: options?.stepType ?? 'tool',
        tool_name: 'invoke_subagent',
        subagent_info: {
          subagents: [{
            type_name: options?.childTypeName ?? LIVE_CUSTOM_AGENT_CHILD_V1,
            role: 'custom',
            conversation_id: 'fixture-child',
            log_uri: 'file:///tmp/fixture-child',
            workspace_uris: ['/workspace'],
          }],
        },
      },
    });
  }
  events.push({
    event: 'result',
    result: {
      conversation_id: 'fixture-stream',
      status: 'SUCCESS',
      response: options?.response ?? finalToken,
      error: null,
    },
  });
  return {
    status: 0,
    signal: null,
    stdout: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    stderr: '',
    timedOut: false,
    outputOverflow: false,
    processCountOverflow: false,
  } as const;
}

function valueAfter(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  if (index < 0 || argv[index + 1] === undefined) throw new Error(`missing ${flag}`);
  return argv[index + 1];
}

function marker(input: string, name: string): string {
  const match = new RegExp(`(?:^|\\n)${name}=([^\\n]+)`, 'u').exec(input);
  if (match?.[1] === undefined) throw new Error(`missing ${name}`);
  return match[1].trim();
}
