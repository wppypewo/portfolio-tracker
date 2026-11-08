import type { SupabaseClient } from "@supabase/supabase-js";

// apply_account_mutation RPC 的 TS 包裝（見 supabase/rpc-mutations.sql）。
// 「更新帳戶 + 寫流水 + upsert 快照」在 Postgres 端是單一交易：
// 任一步失敗整體回滾，不會再有「帳已變、流水沒寫」的 partial state。
// 權限走 security invoker + RLS：user client 只能動自己的帳戶，
// cron 的 service client 行為與直接寫表相同。

/** accounts 可部分更新的欄位；未出現的鍵保持原值（無法藉此設 NULL） */
export type AccountPatch = {
  quantity?: number;
  cost_basis_twd?: number;
  cost_basis_native?: number;
  realized_pnl_twd?: number;
  last_unit_price?: number;
  last_fx_rate?: number;
  last_priced_at?: string;
  manual_value_base?: number;
  /**
   * 呼叫端讀到的 accounts.updated_at。帶了就由 RPC 在鎖住帳戶後比對，
   * 不同代表讀取後有別的寫入，整筆拒絕。只用來比對，不寫入。
   * 從讀到的值算出新絕對值（股數、成本、已實現損益、餘額）的寫入都要帶。
   */
  expected_updated_at?: string;
};

export type MutationTransaction = {
  type: string;
  quantity_after?: number | null;
  unit_price?: number | null;
  fx_rate?: number | null;
  value_after_base?: number | null;
  note?: string | null;
  created_at?: string;
  cashflow_twd?: number | null;
  realized_pnl?: number | null;
  /** 手續費（TWD）。null / 省略 = 未記錄，不等於 0。 */
  fee_twd?: number | null;
};

export type MutationSnapshot = {
  snapshot_date: string;
  quantity: number;
  unit_price: number | null;
  fx_rate: number;
  value_base: number;
};

export async function applyAccountMutation(
  supabase: SupabaseClient,
  args: {
    accountId: string;
    patch?: AccountPatch;
    transaction?: MutationTransaction | null;
    snapshots?: MutationSnapshot[];
  },
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("apply_account_mutation", {
    p_account_id: args.accountId,
    p_account_patch: args.patch ?? {},
    p_transaction: args.transaction ?? null,
    p_snapshots: args.snapshots ?? [],
  });
  if (!error) return { error: null };
  // 與 reversal-actions.ts、contributions.ts 同一套判準。這個回傳值會被 9 個
  // 呼叫端直接顯示在畫面上（含 refreshMyPrices 的 errors[0]）：
  // P0001 是 plpgsql raise exception，訊息是 SQL 裡自己寫的中文說明
  // （帳戶不存在或無權限、剛被其他操作更新），顯示出來才有用。
  // 其他 SQLSTATE 是底層錯誤（RLS、約束違反），原文會帶出表名與 policy 名稱，只印 code 到 log。
  if (error.code === "P0001") return { error: error.message };
  console.error(
    `[applyAccountMutation] RPC 失敗 code=${error.code ?? "unknown"}`,
  );
  return { error: "寫入失敗，資料未變更。請重新整理後再試" };
}
