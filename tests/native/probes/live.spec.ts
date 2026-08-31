import {
  LIVE_CAPABILITY_PROBE_PLAN_V1,
  LIVE_MODEL_CANARY_OUTER_TIMEOUT_MS,
  LIVE_MODEL_CANARY_PRINT_TIMEOUT_MS,
  completeLiveCapabilityProbeCoverage,
  runExplicitLiveProbe,
} from '../../../src/native/probes/live';
import { LiveProbeContextV1 } from '../../../src/native/probes/types';
import { absentPluginIdentity } from '../../../src/native/probes/identity';
import { LIVE_MODEL_CANARY_MAXIMUM_PROCESSES_V1 } from '../../../src/native/capability-profile';

const context: LiveProbeContextV1 = {
  mode: 'live', liveOptIn: true, evaluationTimestamp: '2026-07-31T12:00:00.000Z', identityDigest: 'd'.repeat(64),
  hostIdentity: { realpath: '/agy', binarySha256: 'a'.repeat(64), version: null, versionOutputSha256: 'b'.repeat(64), helpOutputSha256: 'c'.repeat(64), platform: 'darwin', arch: 'arm64' },
  pluginIdentity: absentPluginIdentity(),
};

describe('explicit live probe', () => {
  it('defines a bounded plan for every non-passive live-capable domain', () => {
    expect(new Set(LIVE_CAPABILITY_PROBE_PLAN_V1.map(({ sideEffect }) => sideEffect))).toEqual(
      new Set(['agent', 'artifact_review', 'conversation', 'hook', 'mcp', 'model', 'sidecar']),
    );
    expect(LIVE_CAPABILITY_PROBE_PLAN_V1.every(({ timeoutMs, maximumOutputBytes, maximumProcesses }) =>
      timeoutMs > 0 && maximumOutputBytes > 0 && maximumProcesses > 0)).toBe(true);
    const coverage = completeLiveCapabilityProbeCoverage([], context);
    expect(new Set(coverage.map(({ capability }) => capability))).toEqual(
      new Set(LIVE_CAPABILITY_PROBE_PLAN_V1.map(({ capability }) => capability)),
    );
    expect(coverage.every(({ result, source, detailCode }) =>
      result === 'indeterminate' && source === 'live_probe' && detailCode.endsWith('_PROBE_UNAVAILABLE'))).toBe(true);

    const passiveDoesNotSuppressLiveCoverage = completeLiveCapabilityProbeCoverage([{
      capability: 'hook.stop',
      source: 'plugin_readback',
      tier: 'loadable',
      result: 'positive',
      observedAt: context.evaluationTimestamp,
      identityDigest: context.identityDigest,
      detailCode: 'HOOK_REGISTERED',
      diagnostic: null,
    }], context);
    expect(passiveDoesNotSuppressLiveCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'hook.stop',
        source: 'live_probe',
        result: 'indeterminate',
        detailCode: 'LIVE_HOOK_PROBE_UNAVAILABLE',
      }),
    ]));
  });

  it('lets positive live evidence supersede only weak unproven reads for the same capability', () => {
    const weakUnproven = [
      { source: 'structured_init' as const, tier: 'observed' as const, detailCode: 'STRUCTURED_INIT_FIELD_UNAVAILABLE' },
      { source: 'config' as const, tier: 'configured' as const, detailCode: 'CONFIG_FIELD_UNPROVEN' },
      { source: 'plugin_readback' as const, tier: 'configured' as const, detailCode: 'PLUGIN_READBACK_UNPROVEN' },
    ];
    const coverage = completeLiveCapabilityProbeCoverage([
      ...weakUnproven.map(({ source, tier, detailCode }) => ({
        capability: 'custom_agent.markdown',
        source,
        tier,
        result: 'indeterminate' as const,
        observedAt: context.evaluationTimestamp,
        identityDigest: context.identityDigest,
        detailCode,
        diagnostic: null,
      })),
      {
        capability: 'custom_agent.markdown',
        source: 'live_probe',
        tier: 'observed',
        result: 'positive',
        observedAt: context.evaluationTimestamp,
        identityDigest: context.identityDigest,
        detailCode: 'LIVE_CUSTOM_AGENT_VERIFIED',
        diagnostic: null,
      },
      {
        capability: 'custom_agent.model',
        source: 'config',
        tier: 'configured',
        result: 'indeterminate',
        observedAt: context.evaluationTimestamp,
        identityDigest: context.identityDigest,
        detailCode: 'CONFIG_FIELD_UNPROVEN',
        diagnostic: null,
      },
      {
        capability: 'custom_agent.markdown',
        source: 'plugin_readback',
        tier: 'configured',
        result: 'indeterminate',
        observedAt: context.evaluationTimestamp,
        identityDigest: context.identityDigest,
        detailCode: 'PLUGIN_READBACK_MALFORMED',
        diagnostic: null,
      },
    ], context);

    expect(coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'custom_agent.markdown',
        source: 'live_probe',
        result: 'positive',
      }),
      expect.objectContaining({
        capability: 'custom_agent.model',
        source: 'config',
        result: 'indeterminate',
        detailCode: 'CONFIG_FIELD_UNPROVEN',
      }),
      expect.objectContaining({
        capability: 'custom_agent.markdown',
        source: 'plugin_readback',
        result: 'indeterminate',
        detailCode: 'PLUGIN_READBACK_MALFORMED',
      }),
    ]));
    for (const { source, detailCode } of weakUnproven) {
      expect(coverage).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          capability: 'custom_agent.markdown',
          source,
          detailCode,
        }),
      ]));
    }
  });

  it('requires explicit opt-in and preserves malformed/timeout as indeterminate', async () => {
    await expect(runExplicitLiveProbe({ live: false, executable: '/agy', argv: [], capability: 'headless.print', expectedToken: 'ok', context })).rejects.toThrow(/OPT_IN/);
    const malformed = await runExplicitLiveProbe({ live: true, executable: '/agy', argv: [], capability: 'headless.print', expectedToken: 'ok', context, runner: async () => ({ status: 0, signal: null, stdout: 'deceptive', stderr: '', timedOut: false, outputOverflow: false, processCountOverflow: false }) });
    expect(malformed.observations[0]).toMatchObject({ result: 'indeterminate', detailCode: 'LIVE_MALFORMED' });
    const timeout = await runExplicitLiveProbe({ live: true, executable: '/agy', argv: [], capability: 'headless.print', expectedToken: 'ok', context, runner: async () => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: true, outputOverflow: false, processCountOverflow: false }) });
    expect(timeout).toMatchObject({ cacheable: false, detailCode: 'LIVE_TIMEOUT' });
  });

  it('keeps the live model lineage budget at 32 and rejects overflow', async () => {
    expect.assertions(3);
    expect(LIVE_MODEL_CANARY_MAXIMUM_PROCESSES_V1).toBe(32);
    const processOverflow = await runExplicitLiveProbe({
      live: true,
      executable: '/agy',
      argv: [],
      capability: 'headless.print',
      expectedToken: 'ok',
      context,
      runner: async (request) => {
        expect(request.maximumProcesses).toBe(LIVE_MODEL_CANARY_MAXIMUM_PROCESSES_V1);
        return {
          status: null,
          signal: 'SIGKILL',
          stdout: 'ok',
          stderr: '',
          timedOut: false,
          outputOverflow: false,
          processCountOverflow: true,
        };
      },
    });
    expect(processOverflow).toMatchObject({
      cacheable: false,
      detailCode: 'LIVE_PROCESS_OVERFLOW',
      observations: [expect.objectContaining({ result: 'indeterminate' })],
    });
  });

  it('allows the advertised model timeout plus bounded startup overhead', async () => {
    expect(LIVE_MODEL_CANARY_OUTER_TIMEOUT_MS).toBeGreaterThan(LIVE_MODEL_CANARY_PRINT_TIMEOUT_MS);
    let observedTimeoutMs = 0;
    const result = await runExplicitLiveProbe({
      live: true,
      executable: '/agy',
      argv: [],
      capability: 'headless.print',
      expectedToken: 'ok',
      timeoutMs: LIVE_MODEL_CANARY_OUTER_TIMEOUT_MS,
      context,
      runner: async (request) => {
        observedTimeoutMs = request.timeoutMs;
        expect(request.maximumProcesses).toBe(LIVE_MODEL_CANARY_MAXIMUM_PROCESSES_V1);
        return { status: 0, signal: null, stdout: 'ok\n', stderr: '', timedOut: false, outputOverflow: false, processCountOverflow: false };
      },
    });
    expect(observedTimeoutMs).toBe(LIVE_MODEL_CANARY_OUTER_TIMEOUT_MS);
    expect(result).toMatchObject({ cacheable: true, detailCode: 'LIVE_VERIFIED' });
    await expect(runExplicitLiveProbe({
      live: true,
      executable: '/agy',
      argv: [],
      capability: 'headless.print',
      expectedToken: 'ok',
      timeoutMs: LIVE_MODEL_CANARY_OUTER_TIMEOUT_MS + 1,
      context,
    })).rejects.toThrow(/E_LIVE_PROBE_LIMIT/);
  });

  it('timestamps live evidence only after the canary finishes', async () => {
    const events: string[] = [];
    const result = await runExplicitLiveProbe({
      live: true,
      executable: '/agy',
      argv: [],
      capability: 'headless.print',
      expectedToken: 'ok',
      context,
      runner: async () => {
        events.push('canary-complete');
        return { status: 0, signal: null, stdout: 'ok\n', stderr: '', timedOut: false, outputOverflow: false, processCountOverflow: false };
      },
      now: () => {
        events.push('clock');
        return '2026-07-31T12:00:45.000Z';
      },
    });
    expect(events).toEqual(['canary-complete', 'clock']);
    expect(result.observations[0].observedAt).toBe('2026-07-31T12:00:45.000Z');
  });

  it('accepts only an exact successful Antigravity JSON terminal response', async () => {
    const request = {
      live: true,
      executable: '/agy',
      argv: [],
      capability: 'headless.json',
      expectedToken: 'canary',
      outputContract: 'agy_json' as const,
      context,
    };
    const verified = await runExplicitLiveProbe({
      ...request,
      runner: async () => ({
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          conversation_id: 'conversation',
          status: 'SUCCESS',
          response: 'canary',
          error: null,
        }),
        stderr: '',
        timedOut: false,
        outputOverflow: false,
        processCountOverflow: false,
      }),
    });
    expect(verified).toMatchObject({ cacheable: true, detailCode: 'LIVE_VERIFIED' });
    for (const stdout of [
      JSON.stringify({ conversation_id: 'conversation', status: 'ERROR', response: 'canary' }),
      JSON.stringify({ conversation_id: 'conversation', status: 'FAILED', response: 'canary' }),
      JSON.stringify({ conversation_id: 'conversation', status: 'CANCELLED', response: 'canary' }),
      JSON.stringify({ conversation_id: 'conversation', status: 'TIMED_OUT', response: 'canary' }),
      JSON.stringify({ conversation_id: 'conversation', status: 'PENDING', response: 'canary' }),
      JSON.stringify({ conversation_id: 'conversation', status: 'SUCCESS', response: 'near-canary' }),
      'not-json',
    ]) {
      const rejected = await runExplicitLiveProbe({
        ...request,
        runner: async () => ({
          status: 0,
          signal: null,
          stdout,
          stderr: '',
          timedOut: false,
          outputOverflow: false,
          processCountOverflow: false,
        }),
      });
      expect(rejected).toMatchObject({ cacheable: false, detailCode: 'LIVE_MALFORMED' });
    }
  });
});
