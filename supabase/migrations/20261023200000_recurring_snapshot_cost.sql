-- execute_recurring_plan_mutation：扣款當天的快照一併寫入扣款後的成本。
--
-- 為什麼要改：cron 每天先刷價、寫好當天快照，之後才執行到期的定期定額。
-- 扣款時快照走 on conflict do update，只更新 quantity / unit_price / fx_rate / value_base，
-- 成本欄位沿用刷價時寫的值；快照的 trigger（fill_account_snapshot_history_fields）
-- 只在欄位為 null 時補值，不會修正。結果每個扣款日的快照都是「股數已增加、成本沒增加」，
-- 在 /history 選那一天時，未實現損益會多出一期的扣款金額。
--   例：持有 10 股、成本 1000，cron 刷價寫入快照（10 股、成本 1000），
--   接著扣款 200 買 2 股，快照變成 12 股、成本仍是 1000，應為 1200。
-- apply_account_mutation 與 reverse_transaction_mutation 早已明寫這幾欄，只有這支漏了。
--
-- 改了什麼（簽名、回傳欄位、權限、其餘檢查與寫入都不變）：
--   快照 insert 與 on conflict 都帶 cost_basis_twd / cost_basis_native /
--   realized_pnl_twd / account_status。
--
-- 沒改的：已經寫錯的歷史快照不會自動修正。
--
-- 執行順序：
--   要在 20261023120000_recurring_next_run_from_schedule.sql 之後跑（以那一版為底）。
--   不需要配合程式部署。
--
-- 可以整個貼進 SQL Editor 一次跑完，重跑也安全（create or replace）。

create or replace function public.execute_recurring_plan_mutation(
  p_plan_id uuid,
  p_expected_run_date date,
  p_executed_at timestamptz,
  p_unit_price numeric,
  p_fx_rate numeric,
  p_priced_at timestamptz,
  p_source text default 'cron',
  p_amount_override numeric default null,
  p_fee_override numeric default null
) returns table (
  executed boolean,
  shares_added numeric,
  new_quantity numeric,
  next_run_date date
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan public.recurring_plans%rowtype;
  v_account public.accounts%rowtype;
  v_run_id uuid;
  v_transaction_id uuid;
  v_execution_date date;
  v_base_date date;
  v_next_run_date date;
  v_amount numeric;
  v_fee numeric;
  v_invested numeric;
  v_shares_added numeric;
  v_new_quantity numeric;
  v_new_cost_twd numeric;
  v_new_cost_native numeric;
  v_value_after numeric;
  v_note text;
begin
  if p_source not in ('cron', 'manual') then
    raise exception '執行來源無效';
  end if;
  if p_expected_run_date is null or p_executed_at is null or p_priced_at is null then
    raise exception '排程日期或報價時間缺失';
  end if;
  if p_unit_price is null or p_unit_price <= 0 or p_fx_rate is null or p_fx_rate <= 0 then
    raise exception '成交價或匯率無效';
  end if;
  if p_source = 'cron' and p_fee_override is not null then
    raise exception '自動執行不接受覆寫手續費';
  end if;

  v_execution_date := (p_executed_at at time zone 'Asia/Taipei')::date;

  select * into v_plan
  from public.recurring_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception '計劃不存在或無權限';
  end if;
  -- cron 的金額只能來自級距：固定金額計劃沒有任何理由在無人值守時換金額。
  if p_source = 'cron' and p_amount_override is not null
     and v_plan.tier_config is null then
    raise exception '自動執行不接受覆寫金額';
  end if;
  if not v_plan.active then
    raise exception '計劃已暫停';
  end if;
  if p_source = 'cron' and p_expected_run_date > v_execution_date then
    raise exception '計劃尚未到執行日';
  end if;

  -- stale caller 或並行重試：plan 已被前一交易推進，直接回傳未執行。
  if v_plan.next_run_date <> p_expected_run_date then
    return query select false, null::numeric, null::numeric, v_plan.next_run_date;
    return;
  end if;

  select * into v_account
  from public.accounts
  where id = v_plan.account_id
  for update;

  if not found or v_account.user_id <> v_plan.user_id then
    raise exception '帳戶不存在、無權限或擁有者不一致';
  end if;
  if v_account.status = 'archived' then
    raise exception '帳戶已歸檔';
  end if;
  if v_account.price_market = 'manual' or v_account.symbol is null then
    raise exception '手動帳戶無法執行定期定額';
  end if;
  if v_plan.amount_twd is null or v_plan.amount_twd <= 0 then
    raise exception '定期定額金額無效';
  end if;

  -- ledger 與 recurring_plans 都是 numeric(20,2)，先四捨五入再驗證，
  -- 讓 ledger 金額、cashflow 與成本增量三者用的是同一個數。
  v_amount := round(coalesce(p_amount_override, v_plan.amount_twd), 2);
  if v_amount <= 0 then
    raise exception '本期金額需為正數';
  end if;
  if v_amount > 100000000 then
    raise exception '本期金額不得超過 1 億';
  end if;

  v_fee := round(coalesce(p_fee_override, v_plan.fee_twd, 0), 2);
  if v_fee < 0 then
    raise exception '手續費不得為負數';
  end if;
  -- 費用內含：手續費吃掉整筆金額就沒有錢買股票了，擋在這裡比讓股數變 0 好懂。
  if v_fee >= v_amount then
    raise exception '手續費不得大於或等於本期金額';
  end if;

  v_invested := v_amount - v_fee;
  v_shares_added := v_invested / (p_unit_price * p_fx_rate);
  if v_shares_added <= 0 then
    raise exception '換算股數無效';
  end if;

  v_new_quantity := v_account.quantity + v_shares_added;
  v_new_cost_twd := v_account.cost_basis_twd + v_amount;
  v_new_cost_native := v_account.cost_basis_native + (v_amount / p_fx_rate);
  v_value_after := v_new_quantity * p_unit_price * p_fx_rate;
  v_note := format(
    '加碼 %s TWD%s · %s',
    v_amount::text,
    case when v_fee > 0 then format('（含手續費 %s）', v_fee::text) else '' end,
    case
      when p_source = 'cron' and p_amount_override is not null
        then format('定期定額(cron·級距，基準 %s)', v_plan.amount_twd::text)
      when p_source = 'cron' then '定期定額(cron)'
      when p_amount_override is not null or p_fee_override is not null
        then '定期定額(本期調整)'
      else '定期定額'
    end
  );

  insert into public.recurring_plan_runs (
    plan_id, user_id, account_id, scheduled_date, executed_date, executed_at,
    source, amount_twd, shares_added, unit_price, fx_rate, fee_twd
  ) values (
    v_plan.id, v_plan.user_id, v_plan.account_id, p_expected_run_date,
    v_execution_date, p_executed_at, p_source, v_amount,
    v_shares_added, p_unit_price, p_fx_rate, v_fee
  )
  on conflict (plan_id, scheduled_date) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    return query select false, null::numeric, null::numeric, v_plan.next_run_date;
    return;
  end if;

  update public.accounts set
    quantity = v_new_quantity,
    cost_basis_twd = v_new_cost_twd,
    cost_basis_native = v_new_cost_native,
    last_unit_price = p_unit_price,
    last_fx_rate = p_fx_rate,
    last_priced_at = p_priced_at,
    updated_at = now()
  where id = v_account.id;

  insert into public.transactions (
    user_id, account_id, type, quantity_after, unit_price, fx_rate,
    value_after_base, note, created_at, cashflow_twd, fee_twd
  ) values (
    v_plan.user_id, v_account.id, 'adjust_quantity', v_new_quantity,
    p_unit_price, p_fx_rate, v_value_after, v_note, p_executed_at,
    -v_amount, v_fee
  )
  returning id into v_transaction_id;

  -- 成本與狀態欄位要明寫：當天已有快照（cron 先刷價寫過）時走 on conflict，
  -- fill_account_snapshot_history_fields 只在欄位為 null 時補值，不會更新舊值。
  insert into public.account_snapshots (
    user_id, account_id, snapshot_date, quantity, unit_price, fx_rate, value_base,
    cost_basis_twd, cost_basis_native, realized_pnl_twd, account_status
  ) values (
    v_plan.user_id, v_account.id, v_execution_date, v_new_quantity,
    p_unit_price, p_fx_rate, v_value_after,
    v_new_cost_twd, v_new_cost_native, v_account.realized_pnl_twd, v_account.status
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

  update public.recurring_plan_runs
  set transaction_id = v_transaction_id
  where id = v_run_id;

  -- 下一期 = 晚於「本期預定日」與「實際執行日」兩者的第一個扣款日。
  -- 提前手動執行下個月那期時，預定日比較晚，計劃照樣往後推一期；
  -- 逾期補執行時，執行日比較晚，但只要還沒過下一個扣款日就不會跳期。
  -- day_of_month 限 1–28，每個月都有這一天，加一個月也不會溢位。
  v_base_date := greatest(p_expected_run_date, v_execution_date);
  v_next_run_date := make_date(
    extract(year from v_base_date)::integer,
    extract(month from v_base_date)::integer,
    v_plan.day_of_month
  );
  if v_next_run_date <= v_base_date then
    v_next_run_date := (v_next_run_date + interval '1 month')::date;
  end if;

  update public.recurring_plans set
    last_run_date = v_execution_date,
    next_run_date = v_next_run_date,
    updated_at = now()
  where id = v_plan.id;

  return query select true, v_shares_added, v_new_quantity, v_next_run_date;
end;
$$;

-- create or replace 會保留既有權限；這一段只是讓這支檔單獨看也完整，重跑無害。
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.execute_recurring_plan_mutation(
      uuid, date, timestamptz, numeric, numeric, timestamptz, text, numeric, numeric
    ) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.execute_recurring_plan_mutation(
      uuid, date, timestamptz, numeric, numeric, timestamptz, text, numeric, numeric
    ) to service_role;
  end if;
end
$grants$;

notify pgrst, 'reload schema';
