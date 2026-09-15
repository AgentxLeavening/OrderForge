-- Service-role counterpart to restock_inventory_for_order (migration 015),
-- for server-side code with no user session to supply auth.uid() from — the
-- Etsy webhook / sync path, when a marketplace reports an order cancelled
-- (lib/integrations/sync.ts).
--
-- Separate function rather than a p_user_id parameter on the original, for the
-- same reason as deduct_inventory_for_order_admin (migration 024): the original
-- is callable by any signed-in client, so an override parameter there would let
-- one user restock (inflate) another user's inventory. This one is granted to
-- service_role ONLY.
--
-- Same idempotency contract as the original: a no-op once the order has been
-- restocked under ANY restock reason, so a webhook retry, a later poll that
-- also sees the cancellation, and a subsequent manual delete can never
-- double-credit stock.
create or replace function restock_inventory_for_order_admin(
  p_user_id uuid,
  p_order_id uuid,
  p_reason text default 'order_cancelled_restock'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_restocked boolean;
  v_tx record;
  v_prev numeric;
  v_new numeric;
  v_restock_amt numeric;
begin
  -- Serialise concurrent restocks of the same order (e.g. a webhook and the
  -- scheduled poll landing together). Without this, both could pass the
  -- already-restocked check before either inserts its transactions.
  perform 1 from orders where id = p_order_id and user_id = p_user_id for update;
  if not found then
    return;
  end if;

  select exists(
    select 1 from inventory_transactions
    where order_id = p_order_id and user_id = p_user_id
      and reason in ('order_cancelled_restock', 'order_deleted_restock')
  ) into v_already_restocked;

  if v_already_restocked then
    return;
  end if;

  for v_tx in
    select inventory_item_id, change
    from inventory_transactions
    where order_id = p_order_id and user_id = p_user_id and reason = 'order_template_deduction'
  loop
    v_restock_amt := -coalesce(v_tx.change, 0);
    if v_tx.inventory_item_id is null or v_restock_amt <= 0 then
      continue;
    end if;

    select quantity into v_prev
    from inventory_items
    where id = v_tx.inventory_item_id and user_id = p_user_id
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
      v_tx.inventory_item_id, p_user_id, p_order_id, v_restock_amt,
      v_prev, v_new, p_reason, '{"source": "marketplace"}'::jsonb
    );
  end loop;
end;
$$;

revoke all on function restock_inventory_for_order_admin(uuid, uuid, text) from public;
grant execute on function restock_inventory_for_order_admin(uuid, uuid, text) to service_role;
