interface ToolRenderRuleTarget {
  apiName: string;
  identifier: string;
}

export const shouldRenderToolCall = (_target: ToolRenderRuleTarget) => true;
