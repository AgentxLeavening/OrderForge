-- Service-role counterpart to deduct_inventory_for_order (migration 007),
-- for server-side code (lib/integrations/sync.ts) that has no user session/
-- JWT to supply auth.uid() from — it operates via the service-role client.
--
-- Deliberately a SEPARATE function, not a p_user_id parameter bolted onto
-- the original: that original function is directly callable by any signed-in
-- client via PostgREST (supabase.rpc(...) from the browser), and adding an
-- override parameter there would let any authenticated user pass someone
-- else's user_id and deduct/corrupt their inventory. This one takes
-- p_user_id explicitly and is granted to service_role ONLY — revoked from
-- public (which covers anon/authenticated too), so it's unreachable from
-- any client-side call no matter what parameters are supplied.
create or replace function deduct_inventory_for_order_admin(
  p_user_id uuid,
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
  v_prev numeric;
  v_new numeric;
begin
  select quantity into v_prev
  from inventory_items
  where id = p_inventory_item_id and user_id = p_user_id
  for update;

  if not found then
    return; -- item doesn't exist or isn't this user's — silently no-op, same as the original function
  end if;

  v_new := greatest(0, v_prev - coalesce(p_quantity, 0));

  update inventory_items set quantity = v_new where id = p_inventory_item_id;

  insert into inventory_transactions (
    inventory_item_id, user_id, order_id, change,
    previous_quantity, new_quantity, reason, metadata
  ) values (
    p_inventory_item_id, p_user_id, p_order_id, v_new - v_prev,
    v_prev, v_new, 'order_template_deduction', coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function deduct_inventory_for_order_admin(uuid, uuid, uuid, numeric, jsonb) from public;
grant execute on function deduct_inventory_for_order_admin(uuid, uuid, uuid, numeric, jsonb) to service_role;
