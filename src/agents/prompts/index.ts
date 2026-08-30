import { CanonicalAgentIdV1 } from '../types';
import { DESIGNER_PROMPT_V1 } from './designer';
import { EXPLORER_PROMPT_V1 } from './explorer';
import { FIXER_PROMPT_V1 } from './fixer';
import { LIBRARIAN_PROMPT_V1 } from './librarian';
import { OBSERVER_PROMPT_V1 } from './observer';
import { ORACLE_PROMPT_V1 } from './oracle';
import { orchestratorPromptV1 } from './orchestrator';

export interface CanonicalAgentPromptOptionsV1 {
  readonly nativeDelegationAvailable?: boolean;
}

const STATIC_AGENT_PROMPTS_V1 = Object.freeze({
  explorer: EXPLORER_PROMPT_V1,
  librarian: LIBRARIAN_PROMPT_V1,
  oracle: ORACLE_PROMPT_V1,
  fixer: FIXER_PROMPT_V1,
  designer: DESIGNER_PROMPT_V1,
  observer: OBSERVER_PROMPT_V1,
} satisfies Record<Exclude<CanonicalAgentIdV1, 'orchestrator'>, string>);

export function canonicalAgentPromptV1(
  id: CanonicalAgentIdV1,
  options: Readonly<CanonicalAgentPromptOptionsV1> = {},
): string {
  return id === 'orchestrator'
    ? orchestratorPromptV1(options.nativeDelegationAvailable === true)
    : STATIC_AGENT_PROMPTS_V1[id];
}
