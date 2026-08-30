/**
 * LLM 析出帖子的抽象接口。业务逻辑(chat-room.ts)只认 LlmClient 这个接口,
 * 不知道背后具体是 Workers AI 还是别的供应商——想换供应商只用换这个文件里的
 * 实现,不用动调用方。
 *
 * 用标准的 function calling 让模型自己判断"这段聊天有没有形成一个主题":
 * 模型选择调用 extract_post 这个工具,就是它认为"形成了";不调用,就是判断
 * "只是闲聊,没有形成主题"——不需要额外解析一个"是否形成"的布尔值,工具调用
 * 本身就是那个判断。
 */

export interface ExtractedPost {
  title: string;
  summary: string;
  keyPoints: string[];
}

export interface ChatMessageForExtraction {
  nickname: string;
  hashSuffix: string;
  text: string;
}

export interface LlmClient {
  extractPost(messages: ChatMessageForExtraction[]): Promise<ExtractedPost | null>;
}

const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "extract_post",
    description:
      "如果这段聊天记录形成了一段可以独立阅读、有明确主题的讨论(有实质内容交流、结论或分歧),调用这个函数把它提取出来。如果只是零散的闲聊、打招呼、跑题,没有形成主题,不要调用这个函数。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "简短的标题,概括这段讨论的主题" },
        summary: { type: "string", description: "两三句话的摘要" },
        key_points: {
          type: "array",
          items: { type: "string" },
          description: "主要观点、结论或分歧,每条一句话,3-6条",
        },
      },
      required: ["title", "summary", "key_points"],
    },
  },
};

interface WorkersAiToolCall {
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

interface WorkersAiChatResponse {
  choices?: Array<{
    message?: {
      tool_calls?: WorkersAiToolCall[];
    };
  }>;
}

export function parseExtraction(raw: unknown): ExtractedPost | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.title !== "string" || typeof obj.summary !== "string" || !Array.isArray(obj.key_points)) {
    return null;
  }

  const keyPoints = obj.key_points.filter((p): p is string => typeof p === "string");
  if (keyPoints.length === 0) return null;

  return { title: obj.title.trim(), summary: obj.summary.trim(), keyPoints };
}

export function createWorkersAiClient(ai: Ai): LlmClient {
  return {
    async extractPost(messages: ChatMessageForExtraction[]): Promise<ExtractedPost | null> {
      if (messages.length === 0) return null;

      const transcript = messages.map((m) => `${m.nickname}(${m.hashSuffix}): ${m.text}`).join("\n");

      let response: WorkersAiChatResponse;
      try {
        // glm-4.7-flash 是近期上线的模型,@cloudflare/workers-types 里的 Ai.run
        // 重载类型还没收录它,这里用 any 绕过——运行时接口是标准 OpenAI 风格
        // chat completions + tools,已经用真实调用验证过
        response = (await (ai as unknown as { run: (id: string, input: unknown) => Promise<unknown> }).run(
          MODEL_ID,
          {
            messages: [
              {
                role: "system",
                content:
                  "你在观察一个公共聊天室的实时聊天记录,任务是判断这段记录有没有形成一个可以独立阅读的主题讨论。只有真正形成了明确主题、有实质内容交流的才提取,普通闲聊不要提取。" +
                  "如果判断形成了主题,你必须调用 extract_post 工具来提取,绝对不要用普通文字回复、总结或复述聊天内容——只有工具调用会被系统读取,你直接输出的文字不会被任何人看到。" +
                  "如果没有形成明确主题,不要调用任何工具,直接不输出任何内容。提取内容(标题/摘要/要点)用聊天记录本身使用的语言。",
              },
              { role: "user", content: transcript },
            ],
            tools: [EXTRACT_TOOL],
          },
        )) as WorkersAiChatResponse;
      } catch (err) {
        console.error("[llm] extractPost call failed", err);
        return null;
      }

      const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.function?.name !== "extract_post") return null;

      const rawArgs = toolCall.function.arguments;
      let args: unknown;
      try {
        args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
      } catch {
        return null;
      }

      return parseExtraction(args);
    },
  };
}
