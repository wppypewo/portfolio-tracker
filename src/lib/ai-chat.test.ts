import { describe, expect, it, vi } from "vitest";
import {
  briefChatSystem,
  chatHistory,
  ChatInputError,
  freeChatSystem,
  holdingsTable,
  isChatMode,
  MAX_MESSAGE,
  MAX_TURNS,
  newsChatSystem,
  turnsUsed,
} from "./ai-chat";
import { GeminiError, generateChat } from "./gemini";
import type { BriefAccount } from "./weekly-brief";

const env = { GEMINI_API_KEY: "test-key" };

const acct = (over: Partial<BriefAccount>): BriefAccount => ({
  id: "a",
  name: "x",
  asset_class: "stock",
  price_market: "us",
  symbol: "X",
  quantity: 1,
  last_unit_price: 1,
  last_fx_rate: 1,
  manual_value_base: null,
  ...over,
});

describe("isChatMode", () => {
  it("只接受三種模式", () => {
    expect(isChatMode("brief")).toBe(true);
    expect(isChatMode("news")).toBe(true);
    expect(isChatMode("free")).toBe(true);
    expect(isChatMode("roleplay")).toBe(false);
    expect(isChatMode(undefined)).toBe(false);
  });
});

describe("chatHistory", () => {
  it("清洗訊息、保留合法簽章、丟掉格式不對的簽章", () => {
    const out = chatHistory([
      { role: "user", text: "  問 ", signature: "abc" },
      { role: "model", text: "答", signature: "c2ln/+_=-" },
      { role: "user", text: "再問" },
      { role: "model", text: "再答", signature: "<script>" },
      { role: "user", text: "三問" },
    ]);
    expect(out).toEqual([
      { role: "user", text: "問" },
      { role: "model", text: "答", signature: "c2ln/+_=-" },
      { role: "user", text: "再問" },
      { role: "model", text: "再答" },
      { role: "user", text: "三問" },
    ]);
    expect(turnsUsed(out)).toBe(3);
  });

  it("拒絕非陣列、錯的角色、空訊息、過長訊息", () => {
    expect(() => chatHistory("x")).toThrow(ChatInputError);
    expect(() => chatHistory([{ role: "system", text: "x" }])).toThrow(/角色/);
    expect(() => chatHistory([{ role: "user", text: "  " }])).toThrow(/空的/);
    expect(() => chatHistory([{ role: "user", text: "a".repeat(MAX_MESSAGE + 1) }])).toThrow(
      /超過/,
    );
  });

  it("要一問一答交替，最後一則是使用者", () => {
    expect(() => chatHistory([])).toThrow(/最後一則/);
    expect(() =>
      chatHistory([
        { role: "user", text: "a" },
        { role: "user", text: "b" },
      ]),
    ).toThrow(/交替/);
    expect(() =>
      chatHistory([
        { role: "user", text: "a" },
        { role: "model", text: "b" },
      ]),
    ).toThrow(/最後一則/);
  });

  it("opener 模式第一則是模型回覆", () => {
    const out = chatHistory(
      [
        { role: "model", text: "新聞整理" },
        { role: "user", text: "追問" },
      ],
      { opener: true },
    );
    expect(out.map((m) => m.role)).toEqual(["model", "user"]);
    expect(() => chatHistory([{ role: "user", text: "a" }], { opener: true })).toThrow(/交替/);
  });

  it(`超過 ${MAX_TURNS} 輪就拒絕`, () => {
    const long = Array.from({ length: MAX_TURNS * 2 + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "model",
      text: "x",
    }));
    expect(() => chatHistory(long)).toThrow(/20 輪/);
    expect(() => chatHistory(long.slice(0, MAX_TURNS * 2 - 1))).not.toThrow();
  });
});

describe("holdingsTable", () => {
  it("依市值排序、算比重、略過零市值，手動估值用 manual_value_base", () => {
    const out = holdingsTable([
      acct({ name: "小", last_unit_price: 100 }),
      acct({ name: "大", quantity: 3, last_unit_price: 100 }),
      acct({ name: "房", price_market: "manual", symbol: null, manual_value_base: 100 }),
      acct({ name: "空", quantity: 0 }),
    ]);
    expect(out.map((r) => [r.name, r.valueTwd, r.weightPct])).toEqual([
      ["大", 300, 60],
      ["小", 100, 20],
      ["房", 100, 20],
    ]);
  });

  it("最多 30 筆", () => {
    const many = Array.from({ length: 40 }, (_, i) => acct({ name: `a${i}` }));
    expect(holdingsTable(many)).toHaveLength(30);
  });
});

describe("系統提示", () => {
  const ctx = { today: "2026-11-25", digest: null, accounts: [acct({ name: "台積電" })] };

  it("三種模式都禁止操作建議", () => {
    const prompts = [
      briefChatSystem({ ...ctx, brief: null }),
      freeChatSystem(ctx),
      newsChatSystem("2026-11-25"),
    ];
    for (const p of prompts) {
      expect(p).toContain("不給買");
      expect(p).toContain("不預測價格");
    }
  });

  it("週報模式帶週報全文與產生日期，資料放在資料區塊", () => {
    const p = briefChatSystem({
      ...ctx,
      brief: { title: "本週週報", body: "持平", createdAt: "2026-11-23T06:00:00Z" },
    });
    expect(p).toContain("2026-11-23 產生");
    expect(p).toMatch(/<資料>\n\{"brief":\{"title":"本週週報"/);
    expect(p).toContain('"name":"台積電"');
  });

  it("沒有搜尋的模式會說明查不到新聞", () => {
    expect(freeChatSystem(ctx)).toContain("不能上網搜尋");
    expect(newsChatSystem("2026-11-25")).toContain("Google 搜尋");
  });
});

const geminiReply = (candidate: Record<string, unknown>) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ candidates: [candidate], modelVersion: "gemini-test" }), {
        status: 200,
      }),
  );

describe("generateChat", () => {
  it("送出多輪內容與簽章，回傳正文、最後一個簽章", async () => {
    const fetchImpl = geminiReply({
      finishReason: "STOP",
      content: {
        parts: [
          { text: "想一下", thought: true },
          { text: "答案", thoughtSignature: "sig1" },
          { text: "補充", thoughtSignature: "sig2" },
        ],
      },
    });
    const out = await generateChat({
      system: "S",
      contents: [
        { role: "user", text: "問" },
        { role: "model", text: "答", signature: "old" },
        { role: "user", text: "再問" },
      ],
      env,
      fetchImpl,
    });
    expect(out).toMatchObject({
      text: "答案補充",
      signature: "sig2",
      truncated: false,
      model: "gemini-test",
      grounding: null,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.contents[1]).toEqual({
      role: "model",
      parts: [{ text: "答", thoughtSignature: "old" }],
    });
    expect(body.tools).toBeUndefined();
  });

  it("grounded 時開 Google 搜尋並回傳 grounding", async () => {
    const fetchImpl = geminiReply({
      finishReason: "STOP",
      content: { parts: [{ text: "新聞" }] },
      groundingMetadata: { searchEntryPoint: { renderedContent: "<div>chip</div>" } },
    });
    const out = await generateChat({
      system: "S",
      contents: [{ role: "user", text: "問" }],
      grounded: true,
      env,
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).tools).toEqual([{ google_search: {} }]);
    expect(out.grounding?.searchEntryPoint?.renderedContent).toBe("<div>chip</div>");
  });

  it("截斷的回覆照樣回傳並標記；其他未完成理由丟錯", async () => {
    const truncated = await generateChat({
      system: "S",
      contents: [{ role: "user", text: "問" }],
      env,
      fetchImpl: geminiReply({ finishReason: "MAX_TOKENS", content: { parts: [{ text: "前半" }] } }),
    });
    expect(truncated).toMatchObject({ text: "前半", truncated: true });

    await expect(
      generateChat({
        system: "S",
        contents: [{ role: "user", text: "問" }],
        env,
        fetchImpl: geminiReply({ finishReason: "SAFETY", content: { parts: [] } }),
      }),
    ).rejects.toThrow(GeminiError);
    await expect(
      generateChat({
        system: "S",
        contents: [{ role: "user", text: "問" }],
        env,
        fetchImpl: geminiReply({ finishReason: "MAX_TOKENS", content: { parts: [] } }),
      }),
    ).rejects.toThrow(/沒有完整回應/);
  });
});
