import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDefaultServices } from '../../src/cli/services';

describe('native custom-agent live integration', () => {
  test('live probe proves the custom-agent surface required by agent installation', async () => {
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oma-native-agent-integration-')));
    const executable = path.join(cwd, 'agy');
    fs.writeFileSync(executable, fixtureAgyScript(), { mode: 0o700 });
    let stdout = '';
    let stderr = '';
    const services = createDefaultServices({
      packageRoot: path.resolve(__dirname, '../..'),
      cwd,
      stateRoot: path.join(cwd, 'state'),
      agyCommand: executable,
      pluginAdapter: {
        run: async (argv) => ({
          argv: [...argv],
          code: 1,
          stdout: '',
          stderr: 'registry unavailable',
        }),
      },
      environment: { PATH: process.env.PATH, HOME: cwd },
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });
    try {
      expect(await services.nativeCommand('probe', ['--live', '--json'])).toBe(0);
      expect(stderr).toBe('');
      const body = JSON.parse(stdout) as {
        profile: {
          capabilities: Array<{
            key: string;
            outcome: string;
            tier: string | null;
            source: string | null;
          }>;
        };
      };
      const capability = (key: string) => body.profile.capabilities.find((entry) => entry.key === key);
      for (const key of [
        'custom_agent.markdown',
        'custom_agent.main_agent',
        'custom_agent.subagent',
      ]) {
        expect(capability(key)).toMatchObject({
          outcome: 'supported',
          source: 'live_probe',
        });
      }
      expect(capability('custom_agent.command_execution_policy')).toMatchObject({
        outcome: 'unknown',
      });
      expect(capability('subagent.invoke')).toMatchObject({
        outcome: 'supported',
        tier: 'verified',
        source: 'live_probe',
      });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function fixtureAgyScript(): string {
  return `#!${process.execPath}
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
if (args[0] === '--version') {
  process.stdout.write('agy 2.0.0\\n');
  process.exit(0);
}
if (args[0] === '--help') {
  process.stdout.write('--print --output-format json stream-json --agent --print-timeout\\n');
  process.exit(0);
}
const prompt = valueAfter('--print') || '';
const format = valueAfter('--output-format') || 'text';
const exactTextToken = prompt.includes(': ') ? prompt.slice(prompt.lastIndexOf(': ') + 2).trim() : 'ok';
if (format === 'json') {
  process.stdout.write(JSON.stringify({
    conversation_id: 'fixture-json',
    status: 'SUCCESS',
    response: exactTextToken,
    error: null,
  }) + '\\n');
  process.exit(0);
}
if (format === 'stream-json') {
  const agent = valueAfter('--agent') || 'oma-live-probe-main';
  const finalToken = /FINAL_TOKEN=([^\\s]+)/.exec(prompt)?.[1] || 'oma-final';
  const commandToken = /COMMAND_TOKEN=([^\\s]+)/.exec(prompt)?.[1] || 'oma-command';
  const child = /CHILD_AGENT=([^\\s]+)/.exec(prompt)?.[1] || 'oma-live-probe-child';
  const events = [
    {
      event: 'init',
      conversation_id: 'fixture-stream',
      init: {
        cwd: process.cwd(),
        tools: ['run_command', 'invoke_subagent'],
        permission_mode: 'request-review',
        model: 'fixture-flash',
        agent,
      },
    },
    {
      event: 'step_update',
      step_update: {
        conversation_id: 'fixture-stream',
        step_index: 1,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: {}, output: commandToken },
      },
    },
    {
      event: 'step_update',
      step_update: {
        conversation_id: 'fixture-stream',
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'invoke_subagent',
        subagent_info: {
          subagents: [{
            type_name: child,
            role: 'custom',
            conversation_id: 'fixture-child',
            log_uri: 'file:///tmp/fixture-child',
            workspace_uris: [process.cwd()],
          }],
        },
      },
    },
    {
      event: 'result',
      result: {
        conversation_id: 'fixture-stream',
        status: 'SUCCESS',
        response: finalToken,
        error: null,
      },
    },
  ];
  process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');
  process.exit(0);
}
process.stdout.write(exactTextToken + '\\n');
`;
}
