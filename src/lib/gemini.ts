/**
 * Gemini API 的最小包裝。只用內建 fetch，不引 @google/genai：這裡只需要兩種呼叫
 * （結構化 JSON、搜尋 grounding），多一個套件不划算。fetchImpl 可注入，測試不打 Google。
 *
 * 結構化輸出用 generationConfig.responseFormat.text，這是官方 REST 範例的寫法
 * （aistudio.google.com/docs/structured-output，2026-11-25 讀，同日實測可用）。
 * schema 不支援 minLength／maxLength 等字串長度限制（同日實測會 400），長度靠 prompt 約束。
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// 3.8 Flash 是 2026-11 文件標 Stable 的 Flash 版本；換模型改環境變數即可。
const DEFAULT_MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 45_000;

export class GeminiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

type Env = Record<string, string | undefined>;
type FetchImpl = typeof fetch;

export function geminiConfig(env: Env = process.env) {
  const apiKey = String(env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) throw new GeminiError(503, "還沒設定 GEMINI_API_KEY");
  const model = String(env.GEMINI_MODEL ?? "").trim() || DEFAULT_MODEL;
  // 模型名會拼進網址路徑，擋掉斜線與問號這類能改變路徑的字元。
  if (!/^[a-z0-9.-]+$/i.test(model)) {
    throw new GeminiError(503, "GEMINI_MODEL 的格式不對");
  }
  return { apiKey, model };
}

type Part = { text?: string; thought?: boolean };
type Candidate = {
  finishReason?: string;
  content?: { parts?: Part[] };
  groundingMetadata?: GroundingMetadata;
};
export type GroundingMetadata = {
  webSearchQueries?: string[];
  searchEntryPoint?: { renderedContent?: string };
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
};

async function callGemini(
  body: Record<string, unknown>,
  env: Env,
  fetchImpl: FetchImpl,
) {
  const { apiKey, model } = geminiConfig(env);
  let res: Response;
  try {
    res = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      // key 放標頭不放網址：網址會進 Vercel 與 Google 兩邊的存取紀錄。
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new GeminiError(504, "Gemini 回應逾時");
    }
    throw new GeminiError(502, "連不上 Gemini");
  }
  // 只回狀態碼，不帶回應原文：原文可能夾著送出去的持倉資料，不該進 log。
  if (res.status === 429) {
    throw new GeminiError(429, "Gemini 的呼叫次數或額度暫時用完");
  }
  if (!res.ok) throw new GeminiError(502, `Gemini 拒絕請求（HTTP ${res.status}）`);

  let data: {
    candidates?: Candidate[];
    modelVersion?: string;
    promptFeedback?: { blockReason?: string };
  };
  try {
    data = await res.json();
  } catch {
    throw new GeminiError(502, "Gemini 回了不是 JSON 的東西");
  }
  const candidate = data?.candidates?.[0];
  // MAX_TOKENS 代表輸出被截斷；SAFETY 等理由可能整段是空的。兩種都不能用。
  if (!candidate || candidate.finishReason !== "STOP") {
    const reason =
      candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? "無候選";
    throw new GeminiError(502, `Gemini 沒有完整回應（${reason}）`);
  }
  // 開了 thinking 時 parts 可能夾帶 thought 摘要；只取正文。
  const text = (candidate.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
  return { text, candidate, model: data.modelVersion ?? model };
}

type Common = {
  system: string;
  prompt: string;
  /** 3.8 Flash 支援 low／medium／high，不支援 minimal（文件的 thinking 表）。 */
  thinking?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  env?: Env;
  fetchImpl?: FetchImpl;
};

/** 要求照 schema 回 JSON，回傳解析後的物件。 */
export async function generateJson<T>({
  system,
  prompt,
  schema,
  thinking = "low",
  maxOutputTokens = 4096,
  env = process.env,
  fetchImpl = fetch,
}: Common & { schema: Record<string, unknown> }): Promise<{
  value: T;
  model: string;
}> {
  const { text, model } = await callGemini(
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: thinking },
        maxOutputTokens,
        responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } },
      },
    },
    env,
    fetchImpl,
  );
  try {
    return { value: JSON.parse(text) as T, model };
  } catch {
    throw new GeminiError(502, "Gemini 回傳的 JSON 不完整");
  }
}

/**
 * 開 Google 搜尋 grounding 的純文字呼叫。
 * 依 Grounding with Google Search 的使用條款，回傳的 renderedContent（Search Suggestions）
 * 必須原樣顯示給發出請求的使用者，結果不得儲存或快取；呼叫端負責遵守。
 */
export async function generateGrounded({
  system,
  prompt,
  thinking = "low",
  maxOutputTokens = 4096,
  env = process.env,
  fetchImpl = fetch,
}: Common): Promise<{
  text: string;
  model: string;
  grounding: GroundingMetadata | null;
}> {
  const { text, candidate, model } = await callGemini(
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: thinking },
        maxOutputTokens,
      },
    },
    env,
    fetchImpl,
  );
  return { text, model, grounding: candidate.groundingMetadata ?? null };
}
