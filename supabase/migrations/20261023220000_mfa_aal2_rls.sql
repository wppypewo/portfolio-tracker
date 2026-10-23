-- 已綁 MFA 的帳號，資料庫層也要求 aal2：每張有 RLS 的表加一條 restrictive policy。
--
-- 為什麼要改：MFA 目前只在 src/lib/supabase/proxy.ts 擋「頁面」。
-- 已綁 TOTP 的使用者用密碼登入後拿到的是 aal1 的 JWT，proxy 會把頁面導去 /auth/mfa，
-- 但這顆 JWT 本身就能直接打 PostgREST（/rest/v1/accounts、/rest/v1/rpc/...），
-- RLS 只看 auth.uid() = user_id，不看 aal，所以讀寫全部照常。
-- 也就是說密碼外洩時，第二道驗證只擋得住走網頁介面的人。
--
-- 改了什麼：
--   1. public.mfa_satisfied()：JWT 的 aal 是 aal2，或這個使用者沒有任何 verified factor，就回 true。
--      寫成 security definer，因為要讀 auth.mfa_factors；
--      不依賴 authenticated 角色對 auth schema 的權限（Supabase 沒有承諾這件事）。
--      只回傳呼叫者自己的狀態，不接受參數，查不到別人的。
--   2. 下面 12 張表各加一條 mfa_required（as restrictive、for all、to authenticated）。
--      restrictive 會和既有的 permissive policy 以 AND 結合：
--      原本「只能碰自己的列」不變，再加上「已綁 MFA 就必須是 aal2」。
--      寫法依 Supabase 官方文件「Enforce only for users that have opted-in」：
--      https://supabase.com/docs/guides/auth/auth-mfa
--
-- 影響範圍：
--   - 沒綁 MFA 的使用者：mfa_satisfied() 恆為 true，行為不變。
--   - 綁了 MFA、已完成驗證（aal2）：行為不變。
--   - 綁了 MFA、只有 aal1：讀不到任何列，寫入被 RLS 拒絕。security invoker 的 RPC
--     （apply_account_mutation、execute_recurring_plan_mutation、reverse_transaction_mutation、
--     save_decision_review）在函式裡查表時一樣受限，會走各自的「不存在或無權限」分支。
--   - 只有 unverified factor（設定 MFA 到一半）：不算綁定，行為不變。
--   - service_role（cron、admin 頁、profile-actions）繞過 RLS，不受影響。
--   - /auth/mfa 驗證頁只呼叫 supabase.auth.mfa.*（走 GoTrue，不經 PostgREST），不讀 public 表。
--
-- 為什麼 api_usage 也加：它目前沒有任何一般使用者的 policy，加了不改變現況；
-- 以後若有人替它補 permissive policy，這條仍會把關。
--
-- 執行順序：
--   與其他 migration 沒有相依（不改任何函式與欄位），與程式部署的先後也無關。
--   跑之前確認 12 張表都存在：少一張會整支報錯、什麼都不建，不會只建一半。
--
-- 可以整個貼進 SQL Editor 一次跑完，重跑也安全（create or replace、drop policy if exists）。

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    );
$$;

comment on function public.mfa_satisfied() is
  'RLS 用：呼叫者是 aal2，或沒有 verified MFA factor。見 migration 20261023220000。';

-- Supabase 的預設權限會把新函式的 execute 給 anon／authenticated／service_role，
-- 只 revoke from public 收不回來，要逐一 revoke。
revoke all on function public.mfa_satisfied() from public;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mfa_satisfied() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.mfa_satisfied() to authenticated;
  end if;
end
$grants$;

do $policies$
declare
  t text;
  tables text[] := array[
    'profiles',
    'accounts',
    'transactions',
    'account_snapshots',
    'recurring_plans',
    'recurring_plan_runs',
    'alerts',
    'notifications',
    'account_status_history',
    'investment_decisions',
    'decision_reviews',
    'api_usage'
  ];
begin
  -- 先全部檢查一遍再建，少一張就整支停下，避免只保護到一部分。
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception '找不到資料表 public.%，請先跑完它所屬的 schema 檔或 migration', t;
    end if;
  end loop;

  foreach t in array tables loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    -- (select ...) 讓函式每個 statement 只算一次，不是每一列算一次。
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated '
      'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      t
    );
  end loop;
end
$policies$;

notify pgrst, 'reload schema';
