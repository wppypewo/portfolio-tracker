-- 撤銷賣出前，先確認帳戶持有數量仍等於賣出列記下的 quantity_after。
--
-- 為什麼要改：20260810234500_transaction_reversal.sql 的 undo 賣出用
--   v_sell_qty := 帳戶當前數量 × 被賣部位成本 / 帳戶當前成本
-- 反解賣出股數，前提是帳戶當前狀態就是賣出後的狀態。undo 雖然只允許
-- 「最新一筆」，但排序依 created_at，而 trade-actions 的回溯日期會把
-- created_at 設成發生時間。重現步驟（帳戶原本 10 股、成本 1000）：
--   1. 今天賣 4 股：剩 6 股、成本 600，賣出列 quantity_after = 6
--   2. 補記上週加碼 4 股、成本 800：created_at 早於賣出，帳戶變 10 股、成本 1400
--   3. 撤銷賣出：賣出仍是最新一筆，算出 10 × 400 / 1400 = 2.857 股，應為 4 股
-- 撤銷後帳戶變 12.857 股，數量憑空少了 1.143 股，且沒有任何錯誤訊息。
--
-- 修法：只加守門，不改計算。賣出列的 quantity_after 是寫入當下的持有數量，
-- 帳戶數量對不上就擋下。校正成本（adjust_cost）只改成本不改數量，守門抓不到，
-- 但它一律以 now() 寫入、不能回溯日期，寫入後賣出就不再是最新一筆，undo 本來就會擋。
-- 仍抓不到的情形：賣出後補記的交易剛好讓數量回到原值（例如補記一買一賣同股數），
-- 這需要賣出列另存賣出前的成本，留待 schema 變更時處理。
--
-- 函式其餘部分與 20260810234500 相同；整份重建是因為 plpgsql 沒有局部修改。

create or replace function public.reverse_transaction_mutation(
  p_transaction_id uuid,
  p_mode text
) returns table (
  mode text,
  reversal_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_txn public.transactions%rowtype;
  v_account public.accounts%rowtype;
  v_latest_id uuid;
  v_is_manual boolean;
  v_d_quantity numeric := 0;
  v_d_cost_twd numeric := 0;
  v_d_cost_native numeric := 0;
  v_d_realized numeric := 0;
  v_d_manual numeric := 0;
  v_allocated numeric;
  v_sell_qty numeric;
  v_new_quantity numeric;
  v_new_cost_twd numeric;
  v_new_cost_native numeric;
  v_new_realized numeric;
  v_new_manual numeric;
  v_new_value numeric;
  v_txn_date date;
  v_today date;
  v_run public.recurring_plan_runs%rowtype;
  v_reversal_id uuid;
begin
  if p_mode not in ('undo', 'reverse') then
    raise exception '模式無效';
  end if;

  select * into v_txn from public.transactions where id = p_transaction_id;
  if not found then
    raise exception '交易不存在或無權限';
  end if;
  if v_txn.reversal_of is not null then
    raise exception '沖銷交易本身不能再撤銷';
  end if;
  if exists (
    select 1 from public.transactions where reversal_of = v_txn.id
  ) then
    raise exception '這筆交易已經沖銷過了';
  end if;

  select * into v_account
  from public.accounts
  where id = v_txn.account_id
  for update;

  if not found or v_account.user_id <> v_txn.user_id then
    raise exception '帳戶不存在、無權限或擁有者不一致';
  end if;

  select id into v_latest_id
  from public.transactions
  where account_id = v_txn.account_id
  order by created_at desc, id desc
  limit 1;

  if p_mode = 'undo' and v_latest_id is distinct from v_txn.id then
    raise exception '只能撤銷該帳戶最新一筆交易，較早的請用沖銷';
  end if;

  if v_txn.type = 'create' then
    raise exception '建立帳戶的紀錄不能撤銷，要移除請刪除整個帳戶';
  end if;
  if v_txn.type = 'price_update' then
    raise exception '更新報價沒有現金流，撤銷沒有意義';
  end if;
  if v_txn.type = 'adjust_quantity'
     and (v_txn.cashflow_twd is null or v_txn.cashflow_twd >= 0) then
    raise exception '往下調整持有數量的紀錄無法撤銷：成本是按比例縮放的，這一列的資訊不足以回推';
  end if;
  if v_txn.type = 'sell' and p_mode = 'reverse' then
    raise exception '賣出只能撤銷該帳戶最新一筆，較早的賣出無法沖銷：賣出股數只能從當下的帳戶狀態回推';
  end if;

  v_is_manual := v_account.price_market = 'manual';

  if v_txn.type = 'adjust_quantity' then
    if v_txn.unit_price is null or v_txn.unit_price <= 0
       or v_txn.fx_rate is null or v_txn.fx_rate <= 0 then
      raise exception '這筆交易沒有可用的成交價或匯率，無法回推股數';
    end if;
    v_d_cost_twd := -v_txn.cashflow_twd;
    v_d_cost_native := -v_txn.cashflow_twd / v_txn.fx_rate;
    -- 費用內含：買到股票的錢是金額扣掉手續費。舊資料 fee 為 null，
    -- 當初也就是照全額換算的，當 0 才對得上。
    v_d_quantity := (-v_txn.cashflow_twd - coalesce(v_txn.fee_twd, 0))
      / (v_txn.unit_price * v_txn.fx_rate);

  elsif v_txn.type = 'sell' then
    -- 被賣部位的成本 = 收入 − 已實現損益。平均成本法下這是加法量，可精確回推。
    v_allocated := coalesce(v_txn.cashflow_twd, 0) - coalesce(v_txn.realized_pnl, 0);
    v_d_cost_twd := -v_allocated;
    v_d_realized := coalesce(v_txn.realized_pnl, 0);
    if v_account.cost_basis_twd <= 0 then
      raise exception '這個帳戶的成本已歸零（可能已全數賣出），無法回推賣出股數';
    end if;
    -- 等比例反解的前提是「帳戶當前狀態就是賣出後的狀態」。
    -- 「最新一筆」排序看的是 created_at，而回溯日期的交易會把 created_at 設成
    -- 發生時間：賣出之後才補記一筆更早日期的加碼，賣出仍是「最新一筆」，
    -- 帳戶卻已多了那筆加碼，反解出的股數就錯了（例：應還原 4 股算成 2.857 股）。
    -- 賣出列的 quantity_after 記的是寫入當下的持有數量，對不上就代表之後還有
    -- 別的交易動過持有數量，擋下改請使用者手動調整。容差只吸收 numeric 捨入。
    if abs(v_account.quantity - v_txn.quantity_after) > 0.00000001 then
      raise exception '賣出之後還有其他交易改動過持有數量（可能是補記較早日期的交易），無法回推賣出股數，請改用調整數量更正';
    end if;
    v_sell_qty := v_account.quantity * v_allocated / v_account.cost_basis_twd;
    v_d_quantity := -v_sell_qty;
    -- 平均成本法等比例分攤，賣出前後的混合匯率相同，所以這個換算也是精確的。
    v_d_cost_native := v_d_cost_twd
      * (v_account.cost_basis_native / v_account.cost_basis_twd);

  elsif v_txn.type in ('dividend', 'interest') then
    v_d_realized := coalesce(v_txn.realized_pnl, 0);

  elsif v_txn.type = 'adjust_balance' then
    -- 修改餘額會把 manual_value_base 與兩個成本欄一起設成新餘額，
    -- 前一筆餘額 = 新餘額 + cashflow（cashflow 記的是 −(新 − 舊)）。
    v_d_manual := -coalesce(v_txn.cashflow_twd, 0);
    v_d_cost_twd := v_d_manual;
    v_d_cost_native := v_d_manual;

  else
    raise exception '這個交易型別不支援撤銷';
  end if;

  v_new_quantity := v_account.quantity - v_d_quantity;
  v_new_cost_twd := v_account.cost_basis_twd - v_d_cost_twd;
  v_new_cost_native := v_account.cost_basis_native - v_d_cost_native;
  v_new_realized := v_account.realized_pnl_twd - v_d_realized;
  v_new_manual := coalesce(v_account.manual_value_base, 0) - v_d_manual;

  -- 帳戶狀態如果已經被其他操作改動到對不上，寧可擋下也不要寫出負數。
  -- 容差只吸收 numeric 捨入，不吸收真正的不一致。
  if v_new_quantity < -0.00000001 then
    raise exception '撤銷後持有數量會變成負數，帳戶狀態可能已被其他操作改動';
  end if;
  if v_new_cost_twd < -0.005 or v_new_cost_native < -0.00000001 then
    raise exception '撤銷後成本會變成負數，帳戶狀態可能已被其他操作改動';
  end if;
  if v_is_manual and v_new_manual < -0.005 then
    raise exception '撤銷後餘額會變成負數，帳戶狀態可能已被其他操作改動';
  end if;

  v_new_quantity := greatest(v_new_quantity, 0);
  v_new_cost_twd := greatest(v_new_cost_twd, 0);
  v_new_cost_native := greatest(v_new_cost_native, 0);
  v_new_manual := greatest(v_new_manual, 0);

  v_new_value := case
    when v_is_manual then v_new_manual
    else v_new_quantity
      * coalesce(v_account.last_unit_price, 0)
      * coalesce(v_account.last_fx_rate, 1)
  end;

  update public.accounts set
    quantity = v_new_quantity,
    cost_basis_twd = v_new_cost_twd,
    cost_basis_native = v_new_cost_native,
    realized_pnl_twd = v_new_realized,
    manual_value_base = case when v_is_manual then v_new_manual else manual_value_base end,
    updated_at = now()
  where id = v_account.id;

  v_today := (now() at time zone 'Asia/Taipei')::date;
  v_txn_date := (v_txn.created_at at time zone 'Asia/Taipei')::date;

  if p_mode = 'undo' then
    -- undo 只允許最新一筆，所以這筆必然也是當日最後一筆，
    -- 該日快照重算成撤銷後的狀態即為正確。單價與匯率沿用快照原本記的值。
    update public.account_snapshots set
      quantity = v_new_quantity,
      value_base = case
        when v_is_manual then v_new_manual
        else v_new_quantity * coalesce(unit_price, 0) * coalesce(fx_rate, 1)
      end,
      cost_basis_twd = v_new_cost_twd,
      cost_basis_native = v_new_cost_native,
      realized_pnl_twd = v_new_realized
    where account_id = v_account.id
      and snapshot_date = v_txn_date;

    select * into v_run
    from public.recurring_plan_runs
    where transaction_id = v_txn.id;

    if found then
      delete from public.recurring_plan_runs where id = v_run.id;
      -- 排程退回這一期，last_run_date 退回剩下的最後一次執行。
      update public.recurring_plans set
        next_run_date = v_run.scheduled_date,
        last_run_date = (
          select max(executed_date)
          from public.recurring_plan_runs
          where plan_id = v_run.plan_id
        ),
        updated_at = now()
      where id = v_run.plan_id;
    end if;

    delete from public.transactions where id = v_txn.id;

  else
    insert into public.transactions (
      user_id, account_id, type, quantity_after, unit_price, fx_rate,
      value_after_base, note, created_at, cashflow_twd, realized_pnl,
      fee_twd, reversal_of
    ) values (
      v_txn.user_id,
      v_account.id,
      v_txn.type,
      v_new_quantity,
      v_txn.unit_price,
      v_txn.fx_rate,
      v_new_value,
      format('沖銷 %s 的紀錄', to_char(v_txn_date, 'YYYY-MM-DD')),
      now(),
      case when v_txn.cashflow_twd is null then null else -v_txn.cashflow_twd end,
      case when v_txn.realized_pnl is null then null else -v_txn.realized_pnl end,
      case when v_txn.fee_twd is null then null else -v_txn.fee_twd end,
      v_txn.id
    )
    returning id into v_reversal_id;
  end if;

  -- 兩種模式都改到了帳戶的當前狀態，今天的快照要跟著走，
  -- 否則趨勢圖要等到下次更新報價才會反映這次更正。
  insert into public.account_snapshots (
    user_id, account_id, snapshot_date, quantity, unit_price, fx_rate,
    value_base, cost_basis_twd, cost_basis_native, realized_pnl_twd,
    account_status
  ) values (
    v_txn.user_id,
    v_account.id,
    v_today,
    v_new_quantity,
    v_account.last_unit_price,
    coalesce(v_account.last_fx_rate, 1),
    v_new_value,
    v_new_cost_twd,
    v_new_cost_native,
    v_new_realized,
    v_account.status
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

  return query select p_mode, v_reversal_id;
end;
$$;

revoke execute on function public.reverse_transaction_mutation(uuid, text)
  from public, anon;
grant execute on function public.reverse_transaction_mutation(uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
