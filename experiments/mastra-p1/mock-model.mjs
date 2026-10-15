import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';

/**
 * In-memory, deterministic model; never calls a provider or the network.
 * responder({ ...options, prompt, tools, callIndex, mode }) may be async and returns:
 *   'answer', or { text?, reasoning?, toolCalls?: [{ id?, name, args }] }.
 * model.calls contains detached prompt/tool snapshots for test assertions.
 * Usage values are synthetic counters, not token or billing estimates.
 */
export function makeScriptedModel(responder) {
  if (typeof responder !== 'function') throw new TypeError('responder must be a function');
  const calls = [];
  async function respond(options, mode) {
    const callIndex = calls.length;
    calls.push({
      mode, callIndex,
      prompt: structuredClone(options.prompt),
      tools: structuredClone(options.tools ?? []),
    });
    const value = await responder({ ...options, callIndex, mode });
    const answer = typeof value === 'string' ? { text: value } : value;
    if (!answer || typeof answer !== 'object') throw new TypeError('Invalid scripted model response');
    const content = [];
    if (answer.reasoning !== undefined) content.push({ type: 'reasoning', text: String(answer.reasoning) });
    if (answer.text !== undefined) content.push({ type: 'text', text: String(answer.text) });
    for (const [index, call] of (answer.toolCalls ?? []).entries()) {
      if (!call.name || typeof call.name !== 'string') throw new TypeError('toolCalls require a name');
      content.push({
        type: 'tool-call', toolCallId: call.id ?? `synthetic-call-${callIndex}-${index}`,
        toolName: call.name, input: JSON.stringify(call.args ?? {}),
      });
    }
    return {
      content,
      finishReason: answer.toolCalls?.length ? 'tool-calls' : 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    };
  }
  const model = new MastraLanguageModelV2Mock({
    provider: 'doon-synthetic', modelId: 'scripted-offline-v1', supportedUrls: {},
    doGenerate: options => respond(options, 'generate'),
    doStream: async options => {
      const result = await respond(options, 'stream');
      const chunks = [{ type: 'stream-start', warnings: [] }];
      for (const [index, part] of result.content.entries()) {
        if (part.type === 'tool-call') chunks.push(part);
        else {
          const id = `synthetic-${part.type}-${index}`;
          chunks.push({ type: `${part.type}-start`, id });
          chunks.push({ type: `${part.type}-delta`, id, delta: part.text });
          chunks.push({ type: `${part.type}-end`, id });
        }
      }
      chunks.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage });
      return { stream: new ReadableStream({ start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      } }) };
    },
  });
  Object.defineProperty(model, 'calls', { value: calls, enumerable: true });
  return model;
}
