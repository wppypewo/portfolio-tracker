-- 子表的帳戶擁有者一致性：(account_id, user_id) 必須對得上 accounts(id, user_id)
--
-- 問題（O50 審查）：transactions、account_snapshots、account_status_history、
-- recurring_plans、recurring_plan_runs、alerts、investment_decisions 的 RLS
-- 只檢查 user_id = auth.uid()，不檢查 account_id 是不是自己的帳戶；而外鍵檢查
-- 不受 RLS 限制。知道別人帳戶 UUID 的使用者可以插入「自己的 user_id＋別人的
-- account_id」。例如在 account_snapshots 預先插一筆未來日期的快照，等 cron
-- 執行對方的定期定額時，RPC 的 on conflict (account_id, snapshot_date) do update
-- 不改 user_id，對方當天的股數與市值就寫進攻擊者讀得到的那一列。
--
-- 修法：父表加 (id, user_id) 唯一鍵，子表加複合外鍵。比在每條 policy 加
-- exists 子查詢好：外鍵對 service role、security definer 函式也生效，而且
-- 不會因為日後新增 policy 漏寫而失效。
--
-- 用 not valid：舊資料不擋 migration，但從這裡開始的 insert / update 一律檢查。
-- 套用後請先跑檔尾的查詢確認沒有不一致的舊列，再 validate constraint。
--
-- 原本的單欄外鍵保留不動：on delete 行為（cascade / set null）照舊由它負責，
-- 複合外鍵只負責擁有者一致。複合外鍵也寫同樣的 on delete，避免刪帳戶時
-- 兩條外鍵的處理順序造成違反。
-- 需要 PostgreSQL 15 以上（on delete set null (欄位清單) 語法）。

alter table public.accounts
  add constraint accounts_id_user_id_key unique (id, user_id);

alter table public.recurring_plans
  add constraint recurring_plans_id_user_id_key unique (id, user_id);

alter table public.transactions
  add constraint transactions_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete cascade not valid;

alter table public.account_snapshots
  add constraint account_snapshots_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete cascade not valid;

alter table public.account_status_history
  add constraint account_status_history_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete cascade not valid;

alter table public.recurring_plans
  add constraint recurring_plans_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete cascade not valid;

alter table public.recurring_plan_runs
  add constraint recurring_plan_runs_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete cascade not valid;

alter table public.recurring_plan_runs
  add constraint recurring_plan_runs_plan_owner_fkey
  foreign key (plan_id, user_id) references public.recurring_plans (id, user_id)
  on delete cascade not valid;

-- account_id 可為 null（allocation_drift）：MATCH SIMPLE 下 null 不檢查。
alter table public.alerts
  add constraint alerts_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete cascade not valid;

-- 刪帳戶時只把 account_id 設 null，user_id 不能跟著變 null（not null）。
alter table public.investment_decisions
  add constraint investment_decisions_account_owner_fkey
  foreign key (account_id, user_id) references public.accounts (id, user_id)
  on delete set null (account_id) not valid;

-- ── 套用後手動執行 ─────────────────────────────────────────────
-- 1) 找不一致的舊列（每個數字都應該是 0）：
--
-- select 'transactions' t, count(*) from public.transactions c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id
-- union all select 'account_snapshots', count(*) from public.account_snapshots c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id
-- union all select 'account_status_history', count(*) from public.account_status_history c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id
-- union all select 'recurring_plans', count(*) from public.recurring_plans c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id
-- union all select 'recurring_plan_runs(account)', count(*) from public.recurring_plan_runs c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id
-- union all select 'recurring_plan_runs(plan)', count(*) from public.recurring_plan_runs c
--   join public.recurring_plans p on p.id = c.plan_id where p.user_id <> c.user_id
-- union all select 'alerts', count(*) from public.alerts c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id
-- union all select 'investment_decisions', count(*) from public.investment_decisions c
--   join public.accounts a on a.id = c.account_id where a.user_id <> c.user_id;
--
-- 2) 全部為 0 才 validate（不為 0 代表可能已有人利用過，先查那些列再決定）：
--
-- alter table public.transactions validate constraint transactions_account_owner_fkey;
-- alter table public.account_snapshots validate constraint account_snapshots_account_owner_fkey;
-- alter table public.account_status_history validate constraint account_status_history_account_owner_fkey;
-- alter table public.recurring_plans validate constraint recurring_plans_account_owner_fkey;
-- alter table public.recurring_plan_runs validate constraint recurring_plan_runs_account_owner_fkey;
-- alter table public.recurring_plan_runs validate constraint recurring_plan_runs_plan_owner_fkey;
-- alter table public.alerts validate constraint alerts_account_owner_fkey;
-- alter table public.investment_decisions validate constraint investment_decisions_account_owner_fkey;
