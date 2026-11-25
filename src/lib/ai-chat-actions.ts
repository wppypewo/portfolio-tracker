"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { mfaSatisfied } from "@/lib/supabase/mfa-guard";
import { todayTaipei } from "@/lib/dates";
import { GeminiError, generateChat, type ChatContent } from "@/lib/gemini";
import {
  groundingSources,
  pickHoldings,
  suggestionsDocument,
  type NewsAccount,
} from "@/lib/holdings-news";
import { loadWeeklyDigest, WEEKLY_BRIEF_TYPE } from "@/lib/weekly-brief";
import {
  briefChatSystem,
  chatHistory,
  ChatInputError,
  freeChatSystem,
  isChatMode,
  MAX_TURNS,
  newsChatSystem,
  newsOpener,
  turnsUsed,
} from "@/lib/ai-chat";

const TAG = "[ai-chat]";

export type AiChatMessage = { role: "user" | "model"; text: string; signature?: string };

export type AiChatResult =
  | {
      ok: true;
      text: string;
      signature: string | null;
      /** 回覆因長度上限被截斷，畫面要標記。 */
      truncated: boolean;
      turnsLeft: number;
      model: string;
      at: string;
      /** 只有新聞模式有；每一輪的搜尋結果各自顯示，不累積、不保存。 */
      sources: { uri: string; title: string }[];
      suggestionsDoc: string | null;
    }
  | { ok: false; error: string };

/**
 * 一輪對話。mode：brief＝追問週報、news＝追問持股新聞、free＝自由提問。
 *
 * 前端只送問答文字與簽章；週報、持股與數字都在這裡重新從 DB 讀（使用者自己的 client，
 * RLS 生效），不採用前端送來的任何數字。結果不寫 DB：對話只留在頁面上。
 * 新聞模式每一輪都重新搜尋，Search Suggestions 每輪原樣回給畫面（grounding 條款）。
 */
export async function askAi(input: { mode: unknown; messages: unknown }): Promise<AiChatResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 只給 admin：Gemini 條款要求使用者滿 18 歲、輸出不得當成財務建議，對外開放前要先有同意流程。
  if (!user || !isAdmin(user.email)) return { ok: false, error: "需要 admin 權限" };
  // 縱深防禦：proxy 已擋 AAL1，這裡再檢查一次，見 mfa-guard.ts
  if (!(await mfaSatisfied(supabase))) {
    return { ok: false, error: "請先完成兩步驟驗證再操作" };
  }

  const mode = input?.mode;
  if (!isChatMode(mode)) return { ok: false, error: "不認得的對話模式" };
  let messages: ChatContent[];
  try {
    messages = chatHistory(input?.messages, { opener: mode === "news" });
  } catch (err) {
    if (err instanceof ChatInputError) return { ok: false, error: err.message };
    throw err;
  }

  const today = todayTaipei();
  let system: string;
  let contents: ChatContent[] = messages;

  if (mode === "news") {
    const { data, error } = await supabase
      .from("accounts")
      .select("name,symbol,price_market,quantity,last_unit_price,last_fx_rate")
      .eq("status", "active");
    if (error) {
      console.error(`${TAG} 讀帳戶失敗 code=${error.code ?? "unknown"}`);
      return { ok: false, error: "讀取持股失敗，請稍後再試" };
    }
    const holdings = pickHoldings((data ?? []) as NewsAccount[]);
    if (holdings.length === 0) {
      return { ok: false, error: "沒有帶代號的持股可以查（手動估值的帳戶不查）" };
    }
    system = newsChatSystem(today);
    // 頁面上那份新聞整理是第一則 model 訊息；它前面那則 user 由伺服器補上。
    contents = [{ role: "user", text: newsOpener(holdings, today) }, ...messages];
  } else {
    const [loaded, briefRes] = await Promise.all([
      loadWeeklyDigest(supabase, user.id, today),
      mode === "brief"
        ? supabase
            .from("notifications")
            .select("title,body,created_at")
            .eq("user_id", user.id)
            .eq("type", WEEKLY_BRIEF_TYPE)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (!loaded.ok || briefRes.error) {
      const code = loaded.ok ? (briefRes.error?.code ?? "unknown") : loaded.code;
      console.error(`${TAG} 讀投資組合失敗 code=${code}`);
      return { ok: false, error: "讀取投資組合失敗，請稍後再試" };
    }
    const ctx = { today, digest: loaded.digest, accounts: loaded.accounts };
    if (mode === "brief") {
      const row = briefRes.data as { title: string; body: string | null; created_at: string } | null;
      system = briefChatSystem({
        ...ctx,
        brief: row ? { title: row.title, body: row.body, createdAt: row.created_at } : null,
      });
    } else {
      system = freeChatSystem(ctx);
    }
  }

  try {
    const res = await generateChat({
      system,
      contents,
      grounded: mode === "news",
      thinking: "low",
      maxOutputTokens: 4096,
    });
    return {
      ok: true,
      text: res.text,
      signature: res.signature,
      truncated: res.truncated,
      turnsLeft: MAX_TURNS - turnsUsed(messages),
      model: res.model,
      at: new Date().toISOString(),
      sources: mode === "news" ? groundingSources(res.grounding) : [],
      suggestionsDoc:
        mode === "news"
          ? suggestionsDocument(res.grounding?.searchEntryPoint?.renderedContent)
          : null,
    };
  } catch (err) {
    if (err instanceof GeminiError) {
      // 只記狀態碼：回應原文可能夾著送出去的持倉資料。
      console.error(`${TAG} Gemini status=${err.status}`);
      return { ok: false, error: err.message };
    }
    console.error(`${TAG} 例外`, err);
    return { ok: false, error: "回覆失敗，請稍後再試" };
  }
}
