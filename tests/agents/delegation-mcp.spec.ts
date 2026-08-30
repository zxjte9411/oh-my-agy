import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AGENT_DELEGATION_MCP_OPERATION_NAMES_V1,
  AGENT_DELEGATION_MCP_SURFACE_V1,
  invokeAgentDelegationMcpOperation,
  listAgentDelegationMcpTools,
} from '../../src/agents/delegation-mcp';
import { MCP_OPERATION_NAMES_V1 } from '../../src/mcp/operations';

describe('agent-private delegation MCP surface', () => {
  test('keeps delegation tools private from the stable public MCP surface', () => {
    expect(MCP_OPERATION_NAMES_V1).toEqual([
      'run_status.read',
      'recovery_manifest.read',
      'wiki.search',
      'team_status.read',
      'mailbox.list',
      'proposal.create',
    ]);
    expect(AGENT_DELEGATION_MCP_OPERATION_NAMES_V1)
      .toEqual(['delegation.plan', 'delegation.reconcile']);
    expect(listAgentDelegationMcpTools().map(({ name }) => name))
      .toEqual(AGENT_DELEGATION_MCP_OPERATION_NAMES_V1);
    expect(AGENT_DELEGATION_MCP_SURFACE_V1.serverName).toBe('oh-my-agy-agents');
  });

  test('plans and reconciles immutable dependency-gated evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-delegation-mcp-'));
    const context = { repositoryRoot: root, stateRoot: path.join(root, '.agy', 'state') };
    try {
      const planned = await invokeAgentDelegationMcpOperation('delegation.plan', {
        lanes: [
          { id: 'docs', task: 'Check current docs.', intent: 'external-research' },
          { id: 'scan', task: 'Inspect the codebase.', intent: 'codebase-discovery' },
          {
            id: 'impl',
            task: 'Implement the bounded change.',
            intent: 'implementation',
            depends_on: ['docs', 'scan'],
          },
        ],
      }, context) as {
        plan_digest: string;
        plan_path: string;
        plan: { waves: Array<{ laneIds: string[]; parallel: boolean }> };
      };

      expect(planned.plan.waves).toEqual([
        { index: 0, laneIds: ['docs', 'scan'], parallel: true },
        { index: 1, laneIds: ['impl'], parallel: false },
      ]);
      const planPath = path.join(root, planned.plan_path);
      expect(fs.statSync(planPath).mode & 0o777).toBe(0o400);

      const continued = await invokeAgentDelegationMcpOperation('delegation.reconcile', {
        plan_digest: planned.plan_digest,
        outcomes: [
          { lane_id: 'docs', status: 'completed', summary: 'Docs confirmed.' },
          { lane_id: 'scan', status: 'completed', summary: 'Code seam located.' },
        ],
      }, context) as {
        reconciliation: { status: string; nextLaneIds: string[] };
        reconciliation_path: string;
      };
      expect(continued.reconciliation).toMatchObject({
        status: 'continue', nextLaneIds: ['impl'],
      });
      expect(fs.statSync(path.join(root, continued.reconciliation_path)).mode & 0o777).toBe(0o400);

      const ready = await invokeAgentDelegationMcpOperation('delegation.reconcile', {
        plan_digest: planned.plan_digest,
        outcomes: [
          { lane_id: 'docs', status: 'completed', summary: 'Docs confirmed.' },
          { lane_id: 'scan', status: 'completed', summary: 'Code seam located.' },
          { lane_id: 'impl', status: 'completed', summary: 'Implemented.', evidence: ['tests:unit'] },
        ],
      }, context) as { reconciliation: { status: string } };
      expect(ready.reconciliation.status).toBe('ready-for-verification');
      expect(fs.existsSync(path.join(root, '.agy', 'state'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed for unknown explicit roles and skipped dependency waves', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-agent-delegation-invalid-'));
    const context = { repositoryRoot: root, stateRoot: path.join(root, '.agy', 'state') };
    try {
      await expect(invokeAgentDelegationMcpOperation('delegation.plan', {
        lanes: [{ id: 'bad', task: 'Do work.', requested_role: 'wizard', intent: 'implementation' }],
      }, context)).rejects.toThrow('unknown requested agent role');

      const planned = await invokeAgentDelegationMcpOperation('delegation.plan', {
        lanes: [
          { id: 'scan', task: 'Inspect first.', intent: 'codebase-discovery' },
          { id: 'impl', task: 'Implement later.', intent: 'implementation', depends_on: ['scan'] },
        ],
      }, context) as { plan_digest: string };

      await expect(invokeAgentDelegationMcpOperation('delegation.reconcile', {
        plan_digest: planned.plan_digest,
        outcomes: [{ lane_id: 'impl', status: 'completed', summary: 'Should not have run.' }],
      }, context)).rejects.toThrow('skipped a dependency wave');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
