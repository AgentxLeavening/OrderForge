-- Reverses an order's inventory deductions (e.g. on cancellation or delete),
-- atomically and idempotently. Row-locked per item like
-- deduct_inventory_for_order, and a no-op if this order was already restocked
-- under ANY restock reason — safe to call on every save while an order is
-- Cancelled, and safe to call again on delete for an order that was already
-- cancelled (deleting it afterwards must not restock it a second time).
create or replace function restock_inventory_for_order(
  p_order_id uuid,
  p_reason text default 'order_cancelled_restock'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_already_restocked boolean;
  v_tx record;
  v_prev numeric;
  v_new numeric;
  v_restock_amt numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select exists(
    select 1 from inventory_transactions
    where order_id = p_order_id and user_id = v_uid
      and reason in ('order_cancelled_restock', 'order_deleted_restock')
  ) into v_already_restocked;

  if v_already_restocked then
    return;
  end if;

  for v_tx in
    select inventory_item_id, change
    from inventory_transactions
    where order_id = p_order_id and user_id = v_uid and reason = 'order_template_deduction'
  loop
    v_restock_amt := -coalesce(v_tx.change, 0);
    if v_tx.inventory_item_id is null or v_restock_amt <= 0 then
      continue;
    end if;

    select quantity into v_prev
    from inventory_items
    where id = v_tx.inventory_item_id and user_id = v_uid
    for update;

    if not found then
      continue; -- item deleted since — nothing to restock
    end if;

    v_new := v_prev + v_restock_amt;
    update inventory_items set quantity = v_new where id = v_tx.inventory_item_id;

    insert into inventory_transactions (
      inventory_item_id, user_id, order_id, change,
      previous_quantity, new_quantity, reason, metadata
    ) values (
      v_tx.inventory_item_id, v_uid, p_order_id, v_restock_amt,
      v_prev, v_new, p_reason, '{}'::jsonb
    );
  end loop;
end;
$$;

grant execute on function restock_inventory_for_order(uuid, text) to authenticated;
