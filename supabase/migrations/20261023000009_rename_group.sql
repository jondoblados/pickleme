-- FR-011: group admins can rename their group. Organisers and players cannot.
create or replace function public.rename_group(p_group_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare old_name text; new_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  perform private.require_uid();
  if not private.has_role(p_group_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(new_name) not between 1 and 80 then raise exception 'invalid_group_name' using errcode = '22023'; end if;
  select name into old_name from public.groups where id = p_group_id for update;
  if old_name is distinct from new_name then
    update public.groups set name = new_name where id = p_group_id;
    perform private.audit(p_group_id, null, 'group_renamed', null, jsonb_build_object('from', old_name, 'to', new_name));
  end if;
  return jsonb_build_object('id', p_group_id, 'name', new_name, 'changed', old_name is distinct from new_name);
end $$;
revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;
