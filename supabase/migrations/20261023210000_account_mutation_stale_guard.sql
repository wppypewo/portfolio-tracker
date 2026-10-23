-- apply_account_mutation：可選的樂觀鎖，擋掉「先讀後寫」覆蓋同時發生的異動。
--
-- 為什麼要改：賣出、加碼、增減股數、校正成本、配息、改餘額都是 server action 在交易外
-- 讀出帳戶，在 JS 算出新的股數與成本，再用這支 RPC 整筆覆寫絕對值。中間若有別的寫入，
-- 那筆異動會被吞掉。
--   例：帳戶 100 股。台北 14:00 cron 的定期定額加了 10 股（110 股），同一刻使用者賣出
--   60 股，server action 先前讀到的是 100 股，寫回 40 股。帳戶少了 10 股，
--   定期定額那筆流水卻還在，流水和餘額對不上。
--
-- 改了什麼（簽名、回傳、權限不變）：
--   1. 讀帳戶改成 select ... for update，鎖到交易結束。
--   2. p_account_patch 可以多帶 expected_updated_at（呼叫端讀到的 accounts.updated_at）。
--      帶了而且和目前的值不同就 raise，整筆不寫。沒帶的呼叫（cron 刷價）行為不變。
--   expected_updated_at 只用來比對，不會寫進任何欄位。
--
-- 執行順序：與程式部署的先後都不會弄壞資料。
--   程式先上：舊函式不認得 expected_updated_at，直接忽略，等於沒有這道檢查（和現在一樣）。
--   migration 先上：舊程式不帶這個鍵，同樣不檢查。
--
-- 可以整個貼進 SQL Editor 一次跑完，重跑也安全（create or replace）。

create or replace function public.apply_account_mutation(
  p_account_id uuid,
  p_account_patch jsonb default '{}'::jsonb,
  p_transaction jsonb default null,
  p_snapshots jsonb default '[]'::jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_updated_at timestamptz;
  v_account public.accounts%rowtype;
  snap jsonb;
begin
  -- for update：鎖住帳戶列直到交易結束，比對與寫入之間不會再有別的寫入插進來。
  select user_id, updated_at into v_user_id, v_updated_at
  from public.accounts
  where id = p_account_id
  for update;

  if v_user_id is null then
    raise exception '帳戶不存在或無權限';
  end if;

  -- 呼叫端在交易外讀出帳戶、在 JS 算好新的股數與成本再整筆覆寫。
  -- 讀取之後若有別的寫入（cron 定期定額、另一個分頁），updated_at 已經變了，
  -- 照寫會把那筆異動吞掉，所以直接拒絕，讓使用者重新整理後再送一次。
  if p_account_patch ? 'expected_updated_at'
     and v_updated_at is distinct from (p_account_patch->>'expected_updated_at')::timestamptz then
    raise exception '帳戶剛被其他操作更新，請重新整理後再試一次';
  end if;

  update public.accounts set
    quantity = coalesce((p_account_patch->>'quantity')::numeric, quantity),
    cost_basis_twd = coalesce((p_account_patch->>'cost_basis_twd')::numeric, cost_basis_twd),
    cost_basis_native = coalesce((p_account_patch->>'cost_basis_native')::numeric, cost_basis_native),
    realized_pnl_twd = coalesce((p_account_patch->>'realized_pnl_twd')::numeric, realized_pnl_twd),
    last_unit_price = coalesce((p_account_patch->>'last_unit_price')::numeric, last_unit_price),
    last_fx_rate = coalesce((p_account_patch->>'last_fx_rate')::numeric, last_fx_rate),
    last_priced_at = coalesce((p_account_patch->>'last_priced_at')::timestamptz, last_priced_at),
    manual_value_base = coalesce((p_account_patch->>'manual_value_base')::numeric, manual_value_base),
    updated_at = now()
  where id = p_account_id
  returning * into v_account;

  if p_transaction is not null then
    insert into public.transactions (
      user_id, account_id, type, quantity_after, unit_price,
      fx_rate, value_after_base, note, created_at, cashflow_twd, realized_pnl,
      fee_twd
    ) values (
      v_user_id,
      p_account_id,
      (p_transaction->>'type')::txn_type,
      (p_transaction->>'quantity_after')::numeric,
      (p_transaction->>'unit_price')::numeric,
      (p_transaction->>'fx_rate')::numeric,
      (p_transaction->>'value_after_base')::numeric,
      p_transaction->>'note',
      coalesce((p_transaction->>'created_at')::timestamptz, now()),
      (p_transaction->>'cashflow_twd')::numeric,
      (p_transaction->>'realized_pnl')::numeric,
      (p_transaction->>'fee_twd')::numeric
    );
  end if;

  for snap in select * from jsonb_array_elements(p_snapshots) loop
    insert into public.account_snapshots (
      user_id, account_id, snapshot_date, quantity, unit_price, fx_rate,
      value_base, cost_basis_twd, cost_basis_native, realized_pnl_twd,
      account_status
    ) values (
      v_user_id,
      p_account_id,
      (snap->>'snapshot_date')::date,
      (snap->>'quantity')::numeric,
      (snap->>'unit_price')::numeric,
      coalesce((snap->>'fx_rate')::numeric, 1),
      (snap->>'value_base')::numeric,
      coalesce((snap->>'cost_basis_twd')::numeric, v_account.cost_basis_twd),
      coalesce((snap->>'cost_basis_native')::numeric, v_account.cost_basis_native),
      coalesce((snap->>'realized_pnl_twd')::numeric, v_account.realized_pnl_twd),
      coalesce((snap->>'account_status')::account_status, v_account.status)
    )
    on conflict (account_id, snapshot_date) do update set
      quantity = excluded.quantity,
      unit_price = excluded.unit_price,
      fx_rate = excluded.fx_rate,
      value_base = excluded.value_base,
      cost_basis_twd = excluded.cost_basis_twd,
      cost_basis_native = excluded.cost_basis_native,
      realized_pnl_twd = excluded.realized_pnl_twd,
      account_status = excluded.account_status;
  end loop;
end;
$$;

revoke execute on function public.apply_account_mutation(uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.apply_account_mutation(uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
