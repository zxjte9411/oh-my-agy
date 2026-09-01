import { renderAllCanonicalAgents, renderCanonicalAgent } from '../../src/agents/render-markdown-agent';
import { CANONICAL_AGENT_IDS_V1 } from '../../src/agents/types';

describe('native Markdown agent rendering', () => {
  test('renders exactly the seven canonical agents omitting unproven model and command policy by default', () => {
    const rendered = renderAllCanonicalAgents();
    expect(rendered.map(({ id }) => id)).toEqual(CANONICAL_AGENT_IDS_V1);

    for (const agent of rendered) {
      expect(agent.markdown).toContain(`name: \"${agent.id}\"`);
      expect(agent.markdown).toContain('description: ');
      expect(agent.markdown).toContain('tools:\n');
      expect(agent.markdown).toMatch(/mainAgent: (true|false)/u);
      expect(agent.markdown).toMatch(/subagent: (true|false)/u);
      expect(agent.markdown).not.toContain('model:');
      expect(agent.markdown).not.toContain('commandExecutionPolicy:');
      expect(agent.markdown.endsWith('\n')).toBe(true);
      expect(renderCanonicalAgent(agent.id).markdown).toBe(agent.markdown);
    }
  });

  test('renders model and commandExecutionPolicy when capabilities are proven', () => {
    const rendered = renderAllCanonicalAgents({
      modelProjectionAvailable: true,
      commandExecutionPolicyAvailable: true,
    });
    for (const agent of rendered) {
      expect(agent.markdown).toMatch(/model: (inherit|flash|pro)/u);
      expect(agent.markdown).toMatch(/commandExecutionPolicy: (off|sandbox)/u);
    }
  });

  test('projects read-only and bounded-write tool posture from the registry', () => {
    for (const id of ['explorer', 'librarian', 'oracle', 'observer'] as const) {
      const rendered = renderCanonicalAgent(id);
      expect(rendered.tools).toEqual(['view_file', 'grep_search']);
      expect(rendered.commandExecutionPolicy).toBe(null);
      expect(rendered.omaMcpConfigured).toBe(false);
      expect(rendered.markdown).not.toContain('replace_file_content');
      expect(rendered.markdown).not.toContain('run_command');
      expect(rendered.markdown).not.toContain('invoke_subagent');

      const proven = renderCanonicalAgent(id, { commandExecutionPolicyAvailable: true });
      expect(proven.commandExecutionPolicy).toBe('off');
      expect(proven.markdown).toContain('commandExecutionPolicy: off');
    }

    for (const id of ['orchestrator', 'fixer', 'designer'] as const) {
      const rendered = renderCanonicalAgent(id);
      expect(rendered.tools).toEqual([
        'view_file', 'grep_search', 'replace_file_content', 'run_command',
      ]);
      expect(rendered.commandExecutionPolicy).toBe(null);
      expect(rendered.omaMcpConfigured).toBe(false);

      const proven = renderCanonicalAgent(id, { commandExecutionPolicyAvailable: true });
      expect(proven.commandExecutionPolicy).toBe('sandbox');
      expect(proven.markdown).toContain('commandExecutionPolicy: sandbox');
    }
  });

  test('orchestrator Markdown never exposes invoke_subagent even when native delegation is available in environment', () => {
    const orchestrator = renderCanonicalAgent('orchestrator', { nativeDelegationAvailable: true });
    expect(orchestrator.tools).toEqual([
      'view_file', 'grep_search', 'replace_file_content', 'run_command',
    ]);
    expect(orchestrator.tools).not.toContain('invoke_subagent');
    expect(orchestrator.omaMcpConfigured).toBe(false);
    expect(orchestrator.markdown).not.toContain('invoke_subagent');
    expect(orchestrator.markdown).not.toContain('mcpServers:');
    expect(orchestrator.markdown).toContain("You are OMA's orchestration-focused main agent.");
    expect(orchestrator.markdown).toContain('Native subagent delegation operates in the root/in-session conversation');

    for (const id of CANONICAL_AGENT_IDS_V1.filter((agentId) => agentId !== 'orchestrator')) {
      const child = renderCanonicalAgent(id, { nativeDelegationAvailable: true });
      expect(child.tools).not.toContain('invoke_subagent');
      expect(child.omaMcpConfigured).toBe(false);
      expect(child.markdown).not.toContain('mcpServers:');
    }
  });

  test('regression P0-I2: root-session evidence does not project invoke_subagent into orchestrator agent.md', () => {
    const orchestrator = renderCanonicalAgent('orchestrator', {
      nativeDelegationAvailable: true,
      modelProjectionAvailable: true,
      commandExecutionPolicyAvailable: true,
    });
    expect(orchestrator.markdown).not.toContain('invoke_subagent');
    expect(orchestrator.tools).not.toContain('invoke_subagent');
  });

  test('keeps the non-native orchestrator on its base posture when capability is unavailable', () => {
    const orchestrator = renderCanonicalAgent('orchestrator');
    expect(orchestrator.markdown).toContain("You are OMA's orchestration-focused main agent.");
    expect(orchestrator.markdown).toContain('Native subagent routing policy is owned by OMA orchestration');
    expect(orchestrator.markdown).not.toContain('delegation.plan');
    expect(orchestrator.markdown).not.toContain('invoke_subagent');
    expect(orchestrator.markdown).not.toContain('mcpServers:');
  });

  test('does not render legacy aliases as additional visible agents', () => {
    expect(() => renderCanonicalAgent('reviewer')).toThrow(/non-canonical/u);
    expect(() => renderCanonicalAgent('executor')).toThrow(/non-canonical/u);
  });
});
