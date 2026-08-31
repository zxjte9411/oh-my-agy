import { canonicalAgentPromptV1 } from './prompts';
import { canonicalAgentDefinition, isCanonicalAgentId } from './registry';
import {
  CANONICAL_AGENT_IDS_V1,
  CanonicalAgentCapabilityModeV1,
  CanonicalAgentIdV1,
} from './types';

export type NativeAgentCommandExecutionPolicyV1 = 'off' | 'sandbox';

const READ_ONLY_TOOLS = Object.freeze(['view_file', 'grep_search'] as const);
const READ_WRITE_TOOLS = Object.freeze([
  'view_file',
  'grep_search',
  'replace_file_content',
  'run_command',
] as const);
const NATIVE_ORCHESTRATOR_TOOLS = Object.freeze([
  ...READ_WRITE_TOOLS,
  'invoke_subagent',
] as const);

export interface RenderCanonicalAgentOptionsV1 {
  readonly nativeDelegationAvailable?: boolean;
  readonly modelProjectionAvailable?: boolean;
  readonly commandExecutionPolicyAvailable?: boolean;
}

export interface RenderedNativeAgentV1 {
  readonly id: CanonicalAgentIdV1;
  readonly markdown: string;
  readonly tools: readonly string[];
  readonly commandExecutionPolicy: NativeAgentCommandExecutionPolicyV1 | null;
  readonly model: string | null;
  readonly omaMcpConfigured: boolean;
}

/**
 * 將 canonical registry 投影成 Antigravity Markdown custom-agent frontmatter。
 * 只使用官方穩定 tool 名稱；invoke_subagent 僅在 capability-proven orchestrator 上暴露。
 * Native orchestrator 使用 agent-private OMA MCP surface，不擴張既有 public MCP contract。
 */
export function renderCanonicalAgent(
  id: unknown,
  options: Readonly<RenderCanonicalAgentOptionsV1> = {},
): RenderedNativeAgentV1 {
  if (!isCanonicalAgentId(id)) {
    throw new Error(`Cannot render non-canonical agent role: ${String(id)}`);
  }
  const definition = canonicalAgentDefinition(id);
  const nativeDelegationAvailable = id === 'orchestrator'
    && options.nativeDelegationAvailable === true;
  const tools = nativeDelegationAvailable
    ? NATIVE_ORCHESTRATOR_TOOLS
    : toolsForCapability(definition.capabilityFloor);
  const commandExecutionPolicy = definition.capabilityFloor === 'read-only' ? 'off' : 'sandbox';
  const lines = [
    '---',
    `name: ${yamlScalar(definition.id)}`,
    `description: ${yamlScalar(definition.description)}`,
    'tools:',
    ...tools.map((tool) => `  - ${tool}`),
    `mainAgent: ${String(definition.mainAgent)}`,
    `subagent: ${String(definition.subagent)}`,
    ...(options.modelProjectionAvailable === true ? [`model: ${definition.preferredModelTier}`] : []),
    ...(options.commandExecutionPolicyAvailable === true ? [`commandExecutionPolicy: ${commandExecutionPolicy}`] : []),
    '---',
    '',
    canonicalAgentPromptV1(id, { nativeDelegationAvailable }).trim(),
    '',
  ];
  return Object.freeze({
    id,
    markdown: lines.join('\n'),
    tools,
    commandExecutionPolicy: options.commandExecutionPolicyAvailable === true ? commandExecutionPolicy : null,
    model: options.modelProjectionAvailable === true ? definition.preferredModelTier : null,
    omaMcpConfigured: nativeDelegationAvailable,
  });
}

export function renderAllCanonicalAgents(
  options: Readonly<RenderCanonicalAgentOptionsV1> = {},
): readonly RenderedNativeAgentV1[] {
  return Object.freeze(CANONICAL_AGENT_IDS_V1.map((id) => renderCanonicalAgent(id, options)));
}

function toolsForCapability(mode: CanonicalAgentCapabilityModeV1): readonly string[] {
  return mode === 'read-only' ? READ_ONLY_TOOLS : READ_WRITE_TOOLS;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
