import { runOma } from './helper';

describe('Native agents CLI e2e', () => {
  test('TC-T2-26: oma agents list stays on the compiled structured CLI surface', async () => {
    const result = await runOma(['agents', 'list', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const body = JSON.parse(result.stdout) as {
      schema: string;
      agents: Array<{ id: string }>;
    };
    expect(body.schema).toBe('oma.agents-list/v1');
    expect(body.agents.map(({ id }) => id)).toEqual([
      'orchestrator',
      'explorer',
      'librarian',
      'oracle',
      'fixer',
      'designer',
      'observer',
    ]);
  });
});
