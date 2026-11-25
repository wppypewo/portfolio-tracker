"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { mfaSatisfied } from "@/lib/supabase/mfa-guard";
import { todayTaipei } from "@/lib/dates";
import { GeminiError, generateGrounded } from "@/lib/gemini";
import {
  buildNewsPrompt,
  groundingSources,
  NEWS_SYSTEM,
  pickHoldings,
  suggestionsDocument,
  type NewsAccount,
} from "@/lib/holdings-news";

export type NewsResult =
  | {
      ok: true;
      text: string;
      sources: { uri: string; title: string }[];
      suggestionsDoc: string | null;
      symbols: string[];
      model: string;
      at: string;
    }
  | { ok: false; error: string };

/**
 * 每按一次就即時查一次，結果只回給這次請求，不寫 DB、不快取：
 * Grounding with Google Search 的條款不允許儲存或快取搜尋結果，也不允許用排程自動跑。
 */
export async function fetchHoldingsNews(): Promise<NewsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 只給 admin：Gemini 條款要求使用者滿 18 歲，對外開放前要先有同意流程。
  if (!user || !isAdmin(user.email)) return { ok: false, error: "需要 admin 權限" };
  // 縱深防禦：proxy 已擋 AAL1，這裡再檢查一次，見 mfa-guard.ts
  if (!(await mfaSatisfied(supabase))) {
    return { ok: false, error: "請先完成兩步驟驗證再操作" };
  }

  // 用使用者自己的 client 讀，RLS 保證只拿得到自己的帳戶。
  const { data, error } = await supabase
    .from("accounts")
    .select("name,symbol,price_market,quantity,last_unit_price,last_fx_rate")
    .eq("status", "active");
  if (error) {
    console.error(`[admin/news] 讀帳戶失敗 code=${error.code ?? "unknown"}`);
    return { ok: false, error: "讀取持股失敗，請稍後再試" };
  }
  const holdings = pickHoldings((data ?? []) as NewsAccount[]);
  if (holdings.length === 0) {
    return { ok: false, error: "沒有帶代號的持股可以查（手動估值的帳戶不查）" };
  }

  try {
    const res = await generateGrounded({
      system: NEWS_SYSTEM,
      prompt: buildNewsPrompt(holdings, todayTaipei()),
      thinking: "low",
      maxOutputTokens: 4096,
    });
    return {
      ok: true,
      text: res.text.trim(),
      sources: groundingSources(res.grounding),
      suggestionsDoc: suggestionsDocument(res.grounding?.searchEntryPoint?.renderedContent),
      symbols: holdings.map((h) => h.symbol),
      model: res.model,
      at: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error(`[admin/news] Gemini status=${err.status}`);
      return { ok: false, error: err.message };
    }
    console.error("[admin/news] 例外", err);
    return { ok: false, error: "查詢失敗，請稍後再試" };
  }
}
