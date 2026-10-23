-- Fix: a browser can keep a valid sign-in session (JWT) for up to an hour after its account is deleted
-- (e.g. from the Supabase dashboard). Previously the app then showed the onboarding screen and failed
-- with a raw "profiles_user_id_fkey" error. Now every RPC that requires sign-in reports account_not_found,
-- and the app signs out and asks the user to sign in again.

create or replace function private.require_uid()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from auth.users where id = v) then
    raise exception 'account_not_found' using errcode = '28000';
  end if;
  return v;
end;
$$;
revoke all on function private.require_uid() from public, anon, authenticated;

create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_uid();
begin
  return jsonb_build_object(
    'user_id', v,
    'display_name', (select p.display_name from public.profiles p where p.user_id = v),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', m.role,
                                          'timezone', g.timezone, 'default_capacity', g.default_capacity)
                       order by g.name)
      from public.group_members m join public.groups g on g.id = m.group_id
      where m.user_id = v), '[]'::jsonb));
end;
$$;
