# Supabase SQL 執行順序

從零部署一個全新的 Supabase 專案時，到 SQL Editor 依下面順序逐個跑：

| # | 檔案 | 內容 | 必跑？ |
|---|---|---|---|
| 1 | `schema.sql` | 4 張表（profiles / accounts / transactions / account_snapshots） + RLS policy + 新使用者 trigger | ✅ |
| 2 | `recurring-plans.sql` | `recurring_plans` 表（定期定額計劃） | ✅ |
| 3 | `cost-basis.sql` | `accounts.cost_basis_twd` 欄位 + 回填 | ✅ |
| 4 | `realized-pnl-cashflow.sql` | enum 加 sell/dividend/interest + `accounts.realized_pnl_twd` + `transactions.{realized_pnl, cashflow_twd}` | ✅ |
| 5 | `batch2-schema.sql` | `accounts.{status, cost_basis_native}` + `profiles.allocation_targets` | ✅ |
| 6 | `open-signup.sql` | 移除舊版的 email allowlist trigger（如果跑過 email-allowlist.sql 的話）。改為開放註冊，admin 從 /admin/allowlist 頁面看誰註冊、踢人 | ⭐ 推薦 |
| 7 | `alerts.sql` | `alerts` + `notifications` 兩張表 + RLS（價格警示、配置失衡提醒） | ✅ |
| 8 | `rpc-mutations.sql` | 帳戶異動與定期定額的原子交易函式、執行 ledger | ✅ |
| 9 | `migrations/20260718032234_stackworth_v1.sql` | 決策日誌、決策檢討、帳戶狀態歷史、快照欄位、集中度設定、RLS 與 v1 RPC | ✅ |
| 10 | `migrations/20260810155500_recurring_amount_override.sql` | `execute_recurring_plan_mutation` 加 `p_amount_override`：手動執行可覆寫本期金額，cron 一律沿用計劃金額 | ✅ |
| 11 | `migrations/20260810230000_transaction_fee.sql` | `transactions.fee_twd` / `recurring_plans.fee_twd` / `recurring_plan_runs.fee_twd`；`apply_account_mutation` 寫入手續費，`execute_recurring_plan_mutation` 加 `p_fee_override` | ✅ |
| 12 | `migrations/20260810234500_transaction_reversal.sql` | `transactions.reversal_of` + `reverse_transaction_mutation`（撤銷最新一筆 / 沖銷較早的一筆）；補 `recurring_plan_runs` 的 delete policy | ✅ |

| 13 | `migrations/20260811120000_api_budget.sql` | `api_usage` 表 + `consume_api_quota`：免費報價 API 的全域每日預算，防止共用 key 被打爆 | ✅ |
| 14 | `migrations/20260818130000_reversal_negative_fee.sql` | 放寬 `transactions_fee_twd_check`，讓沖銷列可以帶負數手續費。**修 bug：** 不跑的話「沖銷較早的一筆」只要原始交易記過手續費就會失敗 | ✅ |
| 15 | `migrations/20260930120000_adjust_cost_type.sql` | `txn_type` enum 加 `adjust_cost`（校正成本）。不改任何函式。**要在程式部署前跑：** 沒跑的話「校正成本」表單會收到 `invalid input value for enum txn_type`，整筆 rollback、帳戶不會被改到 | ✅ |
| 16 | `migrations/20260930180000_recurring_tier_config.sql` | `recurring_plans.tier_config`（jsonb，可為空）：定期定額的級距加減碼設定。不改任何函式與 RLS。**要在程式部署前跑：** 沒跑的話帳戶頁的定期定額區塊會顯示「讀不到定期定額計畫」；cron 查到期計劃時也帶這一欄（級距自動套用之後），沒跑的話查詢失敗、log 印 `queryFailed=true`，當天所有計劃都不執行 | ✅ |
| 17 | `migrations/20260930200000_recurring_cron_tier_amount.sql` | `execute_recurring_plan_mutation`：cron 可以對有 `tier_config` 的計劃帶本期金額（級距加減碼自動套用），流水備註寫「定期定額(cron·級距，基準 N)」；固定金額計劃與手續費覆寫照舊拒絕。簽名不變。**要在第 16 支之後跑。** 與程式部署的先後都不會弄壞資料：程式先上的話，級距計劃該期被舊函式拒絕、隔天重試 | ✅ |
| 18 | `migrations/20261023120000_recurring_next_run_from_schedule.sql` | `execute_recurring_plan_mutation` 的下一期改成「晚於本期預定日與實際執行日兩者的第一個扣款日」。**修 bug：** 舊版從執行月推算，跨月提前手動執行下個月那期時 `next_run_date` 不會前進，之後每次執行都撞到同一期、計劃永久卡住；逾期到下個月才補執行時則會跳過一期。簽名不變，與程式部署的先後無關。**要在第 17 支之後跑。** 已經卡住的計劃要另外修，見下方「修復已卡住的定期定額計劃」 | ✅ |
| 19 | `migrations/20261023180000_reversal_sell_quantity_guard.sql` | `reverse_transaction_mutation`：撤銷賣出前先比對帳戶持有數量與賣出列的 `quantity_after`，對不上就拒絕。**修 bug：** 賣出後補記較早日期的交易，賣出仍是「最新一筆」，舊版會用已改動的帳戶狀態反解出錯的賣出股數。簽名不變，與程式部署的先後無關 | ✅ |
| 20 | `migrations/20261023200000_recurring_snapshot_cost.sql` | `execute_recurring_plan_mutation` 寫當天快照時一併寫入成本、已實現損益與帳戶狀態，當天已有快照時也更新這些欄位。**修 bug：** cron 先刷價寫好當天快照，扣款後只更新股數與市值，成本停在扣款前，/history 那天的未實現損益多出一期扣款金額。簽名不變，與程式部署的先後無關。**要在第 18 支之後跑**（以第 18 支為底），與第 19 支（PR #41）沒有先後關係。已寫錯的歷史快照不會自動修正 | ✅ |

既有 StackWorth 部署若已完成 1–17，依序執行第 18、19、20 個 versioned migration（第 19、20 個之間沒有先後關係）。先在測試或預覽資料庫驗證，再套用正式環境；本 repository 不會自動修改 production schema。

## 修復已卡住的定期定額計劃

第 18 支 migration 只修之後的推算，不改既有資料。跑第 18 支之前若有計劃在跨月提前手動執行後卡住（`next_run_date` 那一期已經有執行紀錄），先用下面的查詢找出來：

```sql
-- 找出 next_run_date 那一期已經執行過的計劃
select p.id, p.account_id, p.day_of_month, p.next_run_date
from public.recurring_plans p
where exists (
  select 1 from public.recurring_plan_runs r
  where r.plan_id = p.id and r.scheduled_date = p.next_run_date
);
```

確認清單無誤後，把這些計劃推到下一個扣款日（晚於目前 `next_run_date` 的第一個 `day_of_month`）：

```sql
update public.recurring_plans p
set next_run_date = (
      make_date(extract(year from p.next_run_date)::int,
                extract(month from p.next_run_date)::int,
                p.day_of_month)
      + case when p.day_of_month <= extract(day from p.next_run_date)::int
             then interval '1 month' else interval '0' end
    )::date,
    updated_at = now()
where exists (
  select 1 from public.recurring_plan_runs r
  where r.plan_id = p.id and r.scheduled_date = p.next_run_date
);
```

推完後若新的 `next_run_date` 已經過了，cron 隔天會照常執行那一期；只補一期，不會把中間錯過的月份全部補齊。

## 注意事項

- **`alter type ... add value`** 加 enum 值跟後面的 `update` 不能在同一個 transaction。如果 SQL Editor 跑檔案 4 卡 "unsafe use of new value of enum type"，把 `alter type` 那三行單獨跑一次，再跑剩下。
- 跑完任何 schema 變更（加欄位 / 改 enum）建議手動：
  ```sql
  notify pgrst, 'reload schema';
  ```
  讓 PostgREST 立刻看到新欄位（部分檔案已自帶這行）。
- 所有 RLS policy 都綁 `auth.uid()`，使用者只能存取自己的資料；service-role key（給 cron 用）會繞過 RLS。
- v1 migration 會為 `account_status_history`、`investment_decisions`、`decision_reviews` 建立逐操作 RLS policy，並限制函式執行權限。決策情境快照由 trigger 阻止後續改寫。
- `save_decision_review` 與更新後的 `apply_account_mutation` 使用 `security invoker`；呼叫者仍受 RLS 限制。
- migration 不是可逆資料刪除腳本。若要回退，先備份並另寫經審核的 forward migration，不要直接刪除新表。

## 使用者管理

開放註冊後，admin 從 app 內的 `/admin/allowlist` 看誰註冊了、踢出特定人。
不需要再手動跑 SQL 加 email。

admin 認定：env var `ADMIN_EMAILS`（逗號分隔）。未設則無任何 admin。
