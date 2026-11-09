-- import_transactions_csv：CSV 匯入的三段寫入包進同一個交易。
--
-- 為什麼要改：app/activity/actions.ts 原本分三步直接寫表——
--   1. insert 匯入的交易
--   2. delete 被匯入歷史取代的 create 占位紀錄（只有一筆 create 的帳戶）
--   3. 逐一 update 帳戶終態（股數、成本、已實現損益、價格）
-- 第 2、3 步任一失敗，前面寫進去的不會回滾：流水在、帳戶餘額沒跟上，
-- 而且重試會被「帳戶已有交易」擋住，只能請使用者手動對帳。
--
-- 改了什麼：新增一支 RPC，三步在 Postgres 端同一個交易裡跑，任一步 raise 整筆回滾。
--   - 先依 id 排序鎖住所有要更新的帳戶（for update），固定順序避免兩個匯入互相死鎖。
--   - 每個帳戶 patch 可帶 expected_updated_at（呼叫端讀到的 accounts.updated_at），
--     與目前值不同就拒絕：匯入規劃是在交易外算的，中間若有加碼、賣出或 cron 寫入，
--     照寫會用舊的狀態覆蓋。與 apply_account_mutation 的樂觀鎖同一套做法。
--   - 刪除的 create 必須真的刪到同樣筆數，否則 raise（RLS 擋下時 delete 不報錯，只刪 0 列）。
--   - patch 裡出現的鍵才更新，值為 null 就寫 null，與原本 .update(patch) 的語意一致。
--
-- 權限：security invoker，走呼叫者的 RLS（own accounts / own transactions / mfa_required），
-- 只能動自己的帳戶；anon 不可執行。
--
-- 執行順序：先跑 migration 再部署程式。程式先上的話，RPC 不存在，匯入會整份失敗
-- （不寫任何資料），不會寫壞資料。
--
-- 可以整個貼進 SQL Editor 一次跑完，重跑也安全（create or replace）。

create or replace function public.import_transactions_csv(
  p_transactions jsonb default '[]'::jsonb,
  p_account_patches jsonb default '[]'::jsonb,
  p_replaced_ids uuid[] default '{}'::uuid[]
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  p jsonb;
  v_account_id uuid;
  v_user_id uuid;
  v_updated_at timestamptz;
  v_owner uuid;
  v_deleted integer;
  v_owners jsonb := '{}'::jsonb;
begin
  -- 1. 依 id 排序鎖住要更新的帳戶，並做樂觀鎖比對。
  for item in
    select value from jsonb_array_elements(p_account_patches)
    order by value->>'account_id'
  loop
    v_account_id := (item->>'account_id')::uuid;
    select user_id, updated_at into v_user_id, v_updated_at
    from public.accounts
    where id = v_account_id
    for update;

    if v_user_id is null then
      raise exception '帳戶不存在或無權限';
    end if;

    p := coalesce(item->'patch', '{}'::jsonb);
    if p ? 'expected_updated_at'
       and v_updated_at is distinct from (p->>'expected_updated_at')::timestamptz then
      raise exception '帳戶剛被其他操作更新，請重新整理後再匯入一次';
    end if;

    v_owners := v_owners || jsonb_build_object(v_account_id::text, v_user_id);
  end loop;

  -- 2. 刪除被取代的 create。加 type = create 條件，id 對錯也不會刪到別種交易。
  if coalesce(array_length(p_replaced_ids, 1), 0) > 0 then
    delete from public.transactions
    where id = any(p_replaced_ids) and type = 'create';
    get diagnostics v_deleted = row_count;
    if v_deleted <> array_length(p_replaced_ids, 1) then
      raise exception '帳戶原本的建立紀錄已變動，請重新整理後再匯入一次';
    end if;
  end if;

  -- 3. 寫入交易。user_id 取自帳戶本身；只有配息的帳戶不在 patch 裡，這裡補查。
  for item in select value from jsonb_array_elements(p_transactions) loop
    v_account_id := (item->>'account_id')::uuid;
    v_owner := (v_owners->>(v_account_id::text))::uuid;
    if v_owner is null then
      select user_id into v_owner from public.accounts where id = v_account_id;
      if v_owner is null then
        raise exception '帳戶不存在或無權限';
      end if;
      v_owners := v_owners || jsonb_build_object(v_account_id::text, v_owner);
    end if;

    insert into public.transactions (
      user_id, account_id, type, quantity_after, unit_price, fx_rate,
      value_after_base, cashflow_twd, realized_pnl, fee_twd, note, created_at
    ) values (
      v_owner,
      v_account_id,
      (item->>'type')::txn_type,
      (item->>'quantity_after')::numeric,
      (item->>'unit_price')::numeric,
      (item->>'fx_rate')::numeric,
      (item->>'value_after_base')::numeric,
      (item->>'cashflow_twd')::numeric,
      (item->>'realized_pnl')::numeric,
      (item->>'fee_twd')::numeric,
      item->>'note',
      coalesce((item->>'created_at')::timestamptz, now())
    );
  end loop;

  -- 4. 更新帳戶終態。鍵出現才改；值為 null 就寫 null（與 .update(patch) 相同）。
  for item in select value from jsonb_array_elements(p_account_patches) loop
    v_account_id := (item->>'account_id')::uuid;
    p := coalesce(item->'patch', '{}'::jsonb);
    update public.accounts set
      quantity = case when p ? 'quantity' then (p->>'quantity')::numeric else quantity end,
      cost_basis_twd = case when p ? 'cost_basis_twd' then (p->>'cost_basis_twd')::numeric else cost_basis_twd end,
      cost_basis_native = case when p ? 'cost_basis_native' then (p->>'cost_basis_native')::numeric else cost_basis_native end,
      realized_pnl_twd = case when p ? 'realized_pnl_twd' then (p->>'realized_pnl_twd')::numeric else realized_pnl_twd end,
      last_unit_price = case when p ? 'last_unit_price' then (p->>'last_unit_price')::numeric else last_unit_price end,
      last_fx_rate = case when p ? 'last_fx_rate' then (p->>'last_fx_rate')::numeric else last_fx_rate end,
      manual_value_base = case when p ? 'manual_value_base' then (p->>'manual_value_base')::numeric else manual_value_base end,
      updated_at = now()
    where id = v_account_id;
  end loop;
end;
$$;

revoke execute on function public.import_transactions_csv(jsonb, jsonb, uuid[])
  from public, anon;
grant execute on function public.import_transactions_csv(jsonb, jsonb, uuid[])
  to authenticated, service_role;

notify pgrst, 'reload schema';
