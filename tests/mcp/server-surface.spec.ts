import { McpOperationContextV1 } from '../../src/mcp/operations';
import {
  McpToolSurfaceV1,
  handleMcpJsonRpc,
} from '../../src/mcp/server';

const context: McpOperationContextV1 = {
  repositoryRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.agy/state`,
};

const privateSurface: McpToolSurfaceV1 = {
  serverName: 'private-test',
  listTools: () => [{
    name: 'private.echo',
    description: 'Echo one value.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }],
  invoke: async (name, rawArguments) => {
    if (name !== 'private.echo') throw new Error(`unexpected tool ${name}`);
    const args = rawArguments as { value?: unknown };
    if (typeof args.value !== 'string') throw new Error('value is required');
    return { value: args.value };
  },
};

describe('MCP server tool-surface injection', () => {
  test('tools/list and tools/call use the explicitly supplied surface', async () => {
    const listed = await handleMcpJsonRpc({
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    }, context, privateSurface);
    expect((listed?.result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name))
      .toEqual(['private.echo']);

    const called = await handleMcpJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'private.echo', arguments: { value: 'ok' } },
    }, context, privateSurface);
    expect((called?.result as { structuredContent: unknown }).structuredContent)
      .toEqual({ value: 'ok' });
  });

  test('initialize reports the supplied server identity', async () => {
    const response = await handleMcpJsonRpc({
      jsonrpc: '2.0', id: 3, method: 'initialize',
    }, context, privateSurface);
    expect(response?.result).toEqual(expect.objectContaining({
      serverInfo: { name: 'private-test', version: '1' },
    }));
  });
});
