-- FR-011 tests. Run after migration 20261023000009 in the same script. Always rolls back.
do $$
declare admin uuid := gen_random_uuid(); org uuid := gen_random_uuid(); player uuid := gen_random_uuid(); x_admin uuid := gen_random_uuid();
  grp uuid; grp_b uuid; r jsonb; log text := ''; i int; n int; t text;
begin
  insert into auth.users (id,email,aud,role,email_confirmed_at) values
    (admin,'rg-a@test.local','authenticated','authenticated',now()),(org,'rg-o@test.local','authenticated','authenticated',now()),
    (player,'rg-p@test.local','authenticated','authenticated',now()),(x_admin,'rg-x@test.local','authenticated','authenticated',now());
  insert into public.groups (name,timezone) values ('RG Group','Asia/Singapore') returning id into grp;
  insert into public.groups (name,timezone) values ('RG Other','Asia/Singapore') returning id into grp_b;
  insert into public.group_members (group_id,user_id,role) values (grp,admin,'admin'),(grp,org,'organiser'),(grp,player,'player'),(grp_b,x_admin,'admin');

  perform set_config('request.jwt.claims', json_build_object('sub',org,'role','authenticated')::text, true);
  begin perform public.rename_group(grp,'Hacked'); log := log || E'R1 organiser blocked: false\n';
  exception when others then log := log || format(E'R1 organiser cannot rename: %s\n', sqlerrm='forbidden'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',player,'role','authenticated')::text, true);
  begin perform public.rename_group(grp,'Hacked'); log := log || E'R2 player blocked: false\n';
  exception when others then log := log || format(E'R2 player cannot rename: %s\n', sqlerrm='forbidden'); end;
  perform set_config('request.jwt.claims', json_build_object('sub',x_admin,'role','authenticated')::text, true);
  begin perform public.rename_group(grp,'Hacked'); log := log || E'R3 other admin blocked: false\n';
  exception when others then log := log || format(E'R3 admin of another group cannot rename: %s\n', sqlerrm='forbidden'); end;
  perform set_config('request.jwt.claims', '', true);
  begin perform public.rename_group(grp,'Hacked'); log := log || E'R4 signed-out blocked: false\n';
  exception when others then log := log || format(E'R4 signed-out cannot rename: %s\n', sqlerrm='not_signed_in'); end;
  select name into t from public.groups where id=grp;
  log := log || format(E'R5 name unchanged after blocked attempts: %s\n', t='RG Group');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',admin,'role','authenticated')::text, true);
  begin update public.groups set name='Direct' where id=grp; get diagnostics n=row_count;
    log := log || format(E'R6 direct table update has no effect: %s\n', n=0);
  exception when insufficient_privilege then log := log || E'R6 direct table update denied: true\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',admin,'role','authenticated')::text, true);
  r := public.rename_group(grp,'   Tuesday   Socials  @CBP2  ');
  select name into t from public.groups where id=grp;
  log := log || format(E'R7 admin renames; spaces tidied: %s\n', t='Tuesday Socials @CBP2' and r->>'changed'='true');
  select count(*) into n from public.audit_events where group_id=grp and action='group_renamed' and actor_id=admin
    and details->>'from'='RG Group' and details->>'to'='Tuesday Socials @CBP2';
  log := log || format(E'R8 rename logged with old and new name: %s\n', n=1);
  r := public.rename_group(grp,'Tuesday Socials @CBP2');
  select count(*) into n from public.audit_events where group_id=grp and action='group_renamed';
  log := log || format(E'R9 same name is a no-op, not logged twice: %s\n', r->>'changed'='false' and n=1);
  begin perform public.rename_group(grp,'   '); log := log || E'R10 blank rejected: false\n';
  exception when others then log := log || format(E'R10 blank name rejected: %s\n', sqlerrm='invalid_group_name'); end;
  begin perform public.rename_group(grp,repeat('x',81)); log := log || E'R11 81 chars rejected: false\n';
  exception when others then log := log || format(E'R11 over 80 characters rejected: %s\n', sqlerrm='invalid_group_name'); end;
  r := public.rename_group(grp,repeat('y',80));
  log := log || format(E'R12 exactly 80 characters accepted: %s\n', r->>'changed'='true');
  select name into t from public.groups where id=grp_b;
  log := log || format(E'R13 other group untouched: %s\n', t='RG Other');
  r := public.get_me();
  log := log || format(E'R14 get_me returns the new name: %s\n', exists(select 1 from jsonb_array_elements(r->'groups') g where g->>'name'=repeat('y',80)));

  select count(*) filter (where l ~ ': (t|true)$'), count(*) filter (where l <> '' and l !~ ': (t|true)$'),
         coalesce(string_agg(l, ' | ') filter (where l <> '' and l !~ ': (t|true)$'), 'none')
    into i, n, t from unnest(string_to_array(log, E'\n')) l;
  raise exception 'RESULTS passed=% failed=% failing=[%]%', i, n, t, E'\n' || log;
end $$;
