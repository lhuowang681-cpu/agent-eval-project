const markLastNonThinkingBlock = (message: any) => {
  if (typeof message.content === 'string') {
    message.content = [
      { type: 'text', text: message.content, cache_control: { type: 'ephemeral' } },
    ];
    return;
  }

  if (Array.isArray(message.content)) {
    for (let i = message.content.length - 1; i >= 0; i--) {
      const block = message.content[i];
      if (block && block.type !== 'thinking' && block.type !== 'redacted_thinking') {
        (block as any).cache_control = { type: 'ephemeral' };
        return;
      }
    }
  }
};

// Anthropic 每次请求最多 4 个 cache_control 断点,渲染顺序 tools → system → messages,前缀匹配。
// 这里参考 Claude Code 的做法把 4 个断点位铺满:
//   1. tools 尾部           —— 稳定的工具定义前缀
//   2. system 尾部          —— 冻结的系统提示
//   3. 最近的非末尾 user 消息 —— 上一轮对话的用户输入,作为历史稳定前缀,新一轮的断点作废后仍能读到
//   4. 最后一条消息          —— 当前轮次的动态末尾
// 首轮对话(只有 1 条 user)时,第 3 个断点跳过。
export const injectOpenAICacheControl = (payload: any): any => {
  // 1. System prompt
  if (payload.system) {
    if (typeof payload.system === 'string') {
      payload.system = [
        { type: 'text', text: payload.system, cache_control: { type: 'ephemeral' } },
      ];
    } else if (Array.isArray(payload.system)) {
      const lastBlock = payload.system.at(-1);
      if (lastBlock && lastBlock.type === 'text') {
        (lastBlock as any).cache_control = { type: 'ephemeral' };
      }
    }
  }

  // 2. Messages
  if (payload.messages?.length) {
    const lastMessageIndex = payload.messages.length - 1;
    const lastMessage = payload.messages[lastMessageIndex];

    // 2a. 历史稳定前缀:从末尾往前找到的第一条 role === 'user' 的历史消息末尾。
    //     打在 user 上而不是 assistant/tool_result 上,语义最稳定 —— 对应"这一轮开始"的分界。
    for (let i = lastMessageIndex - 1; i >= 0; i--) {
      if (payload.messages[i]?.role === 'user') {
        markLastNonThinkingBlock(payload.messages[i]);
        break;
      }
    }

    // 2b. 当前轮次末尾:最后一条消息的最后一个非 thinking 块
    markLastNonThinkingBlock(lastMessage);
  }

  // 3. Tools: last tool definition
  if (payload.tools?.length) {
    const lastTool = payload.tools.at(-1);
    if (lastTool) {
      (lastTool as any).cache_control = { type: 'ephemeral' };
    }
  }

  return payload;
};
