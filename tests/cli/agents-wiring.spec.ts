import { CLI_HELP, CliServices, runCli } from '../../src/cli/application';
import { parseCliArguments } from '../../src/cli/parser';
import { ok } from '../../src/runtime/types';

function services(): CliServices {
  const processResult = ok({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    processIdentity: null,
  });
  return {
    version: 'test',
    launchMode: async () => processResult,
    passThrough: async () => processResult,
    autopilotCommand: async () => 0,
    teamCommand: async () => 0,
    setupCommand: async () => 0,
    doctorCommand: async () => 0,
    skillCommand: async () => 0,
    nativeCommand: async () => 0,
    extendedCommand: async () => 0,
  };
}

describe('agents CLI wiring', () => {
  test('parser owns agents instead of passing it through to agy', () => {
    expect(parseCliArguments(['agents', 'list'])).toEqual({ kind: 'agents', args: ['list'] });
  });

  test('application dispatches list through the native agents command surface', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['agents', 'list', '--json'], services(), {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).schema).toBe('oma.agents-list/v1');
    expect(stderr).toBe('');
  });

  test('help documents install scope and doctor', () => {
    expect(CLI_HELP).toContain('oma agents list');
    expect(CLI_HELP).toContain('oma agents install --scope project|user');
    expect(CLI_HELP).toContain('oma agents doctor');
  });
});
