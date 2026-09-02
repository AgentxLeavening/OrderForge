-- Atomic inventory deduction + audit log for order-template BOM items.
-- Replaces the previous client-side read/modify/write (which raced under
-- concurrent orders and could lose deductions). The row is locked FOR UPDATE
-- so concurrent callers serialize on it.

create or replace function deduct_inventory_for_order(
  p_order_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prev numeric;
  v_new numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the caller's own row; ignore silently if it doesn't exist or isn't theirs.
  select quantity into v_prev
  from inventory_items
  where id = p_inventory_item_id and user_id = v_uid
  for update;

  if not found then
    return;
  end if;

  v_new := greatest(0, v_prev - coalesce(p_quantity, 0));

  update inventory_items set quantity = v_new where id = p_inventory_item_id;

  insert into inventory_transactions (
    inventory_item_id, user_id, order_id, change,
    previous_quantity, new_quantity, reason, metadata
  ) values (
    p_inventory_item_id, v_uid, p_order_id, v_new - v_prev,
    v_prev, v_new, 'order_template_deduction', coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

grant execute on function deduct_inventory_for_order(uuid, uuid, numeric, jsonb) to authenticated;
