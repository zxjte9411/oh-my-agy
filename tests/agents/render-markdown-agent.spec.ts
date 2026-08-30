import { renderAllCanonicalAgents, renderCanonicalAgent } from '../../src/agents/render-markdown-agent';
import { CANONICAL_AGENT_IDS_V1 } from '../../src/agents/types';

describe('native Markdown agent rendering', () => {
  test('renders exactly the seven canonical agents with stable AGY frontmatter', () => {
    const rendered = renderAllCanonicalAgents();
    expect(rendered.map(({ id }) => id)).toEqual(CANONICAL_AGENT_IDS_V1);

    for (const agent of rendered) {
      expect(agent.markdown).toContain(`name: \"${agent.id}\"`);
      expect(agent.markdown).toContain('description: ');
      expect(agent.markdown).toContain('tools:\n');
      expect(agent.markdown).toMatch(/mainAgent: (true|false)/u);
      expect(agent.markdown).toMatch(/subagent: (true|false)/u);
      expect(agent.markdown).toMatch(/model: (inherit|flash|pro)/u);
      expect(agent.markdown).toMatch(/commandExecutionPolicy: (off|sandbox)/u);
      expect(agent.markdown.endsWith('\n')).toBe(true);
      expect(renderCanonicalAgent(agent.id).markdown).toBe(agent.markdown);
    }
  });

  test('projects read-only and bounded-write tool posture from the registry', () => {
    for (const id of ['explorer', 'librarian', 'oracle', 'observer'] as const) {
      const rendered = renderCanonicalAgent(id);
      expect(rendered.tools).toEqual(['view_file', 'grep_search']);
      expect(rendered.commandExecutionPolicy).toBe('off');
      expect(rendered.markdown).not.toContain('replace_file_content');
      expect(rendered.markdown).not.toContain('run_command');
    }

    for (const id of ['orchestrator', 'fixer', 'designer'] as const) {
      const rendered = renderCanonicalAgent(id);
      expect(rendered.tools).toEqual([
        'view_file', 'grep_search', 'replace_file_content', 'run_command',
      ]);
      expect(rendered.commandExecutionPolicy).toBe('sandbox');
    }
  });

  test('uses the modular prompt registry without changing the current orchestrator posture', () => {
    const orchestrator = renderCanonicalAgent('orchestrator');
    expect(orchestrator.markdown).toContain("You are OMA's orchestration-focused main agent.");
    expect(orchestrator.markdown).toContain('Native subagent routing policy is owned by OMA orchestration');
  });

  test('does not render legacy aliases as additional visible agents', () => {
    expect(() => renderCanonicalAgent('reviewer')).toThrow(/non-canonical/u);
    expect(() => renderCanonicalAgent('executor')).toThrow(/non-canonical/u);
  });
});
