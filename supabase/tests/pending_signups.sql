-- Integration tests for FR-015; run on a disposable DB after the migration. Fixtures roll back.
begin;
do $$
declare admin uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); player uuid:=gen_random_uuid();
  other_admin uuid:=gen_random_uuid(); grp uuid:=gen_random_uuid(); other_grp uuid:=gen_random_uuid();
  p_game uuid:=gen_random_uuid(); p_inv uuid:=gen_random_uuid(); p_old uuid:=gen_random_uuid();
  p_conf uuid:=gen_random_uuid(); p_bad uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  game uuid; other_game uuid; inv jsonb; res jsonb; claim jsonb; checks int:=0; n int;
  starts timestamptz:=now()+interval '2 days'; ends timestamptz:=now()+interval '2 days 2 hours';
begin
  insert into auth.users(id,email,aud,role,email_confirmed_at) values
    (admin,'admin@fr015.invalid','authenticated','authenticated',now()),(org,'org@fr015.invalid','authenticated','authenticated',now()),
    (player,'player@fr015.invalid','authenticated','authenticated',null),(other_admin,'other@fr015.invalid','authenticated','authenticated',now());
  insert into public.profiles(user_id,display_name) values(admin,'Admin'),(org,'Organiser'),(player,'Player'),(other_admin,'Other');
  insert into public.groups(id,name) values(grp,'FR015'),(other_grp,'Other');
  insert into public.group_members(group_id,user_id,role) values(grp,admin,'admin'),(grp,org,'organiser'),(grp,player,'player'),(other_grp,other_admin,'admin');
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  game:=public.create_game(grp,'Tue social',starts,ends,'Court A',16,null);
  inv:=public.create_invite(grp,30,100);
  perform set_config('request.jwt.claims',json_build_object('sub',other_admin)::text,true);
  other_game:=public.create_game(other_grp,'Other game',starts,ends,'Court B',16,null);

  insert into auth.users(id,email,aud,role,created_at,confirmation_sent_at,raw_user_meta_data) values
    (p_game,'echeong8@yahoo.com.sg','authenticated','authenticated',now()-interval '1 hour',now()-interval '1 hour',jsonb_build_object('pm_pending_game',game)),
    (p_inv,'ab@sc.com','authenticated','authenticated',now()-interval '2 hours',now()-interval '2 hours',
       jsonb_build_object('pm_pending_invite_hash',encode(extensions.digest(inv->>'token','sha256'),'hex'))),
    (p_old,'old@fr015.invalid','authenticated','authenticated',now()-interval '31 days',null,jsonb_build_object('pm_pending_game',game)),
    (p_bad,'bad@fr015.invalid','authenticated','authenticated',now(),null,jsonb_build_object('pm_pending_game','not-a-uuid','pm_pending_invite_hash','x')),
    (p_other,'z@fr015.invalid','authenticated','authenticated',now(),null,jsonb_build_object('pm_pending_game',other_game));
  insert into auth.users(id,email,aud,role,email_confirmed_at,raw_user_meta_data) values
    (p_conf,'conf@fr015.invalid','authenticated','authenticated',now(),jsonb_build_object('pm_pending_game',game));

  -- masking
  if private.mask_email('echeong8@yahoo.com.sg')<>'ec•••@yahoo.com.sg' or private.mask_email('ab@sc.com')<>'a•••@sc.com'
     or private.mask_email('a@b.co')<>'a•••@b.co' or private.mask_email(null) is not null then raise exception 'mask_email'; end if; checks:=checks+1;

  -- admin sees exactly the two attributable, recent, unconfirmed people, newest first, masked only
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  res:=public.list_pending_signups(grp);
  if jsonb_array_length(res)<>2 then raise exception 'expected 2 pending, got %',res; end if; checks:=checks+1;
  if res->0->>'masked_email'<>'ec•••@yahoo.com.sg' or res->0->>'source'<>'game' or res->0->>'game_title'<>'Tue social'
     or res->1->>'source'<>'invite' then raise exception 'pending content %',res; end if; checks:=checks+1;
  if res::text like '%echeong8%' or res::text like '%ab@sc.com%' then raise exception 'full email leaked'; end if; checks:=checks+1;

  -- members list: admin gets confirmation flag, organiser gets null
  res:=public.list_members(grp);
  select count(*) into n from jsonb_array_elements(res) e where e->>'user_id'=player::text and (e->>'email_confirmed')::boolean=false;
  if n<>1 then raise exception 'admin badge flag %',res; end if; checks:=checks+1;
  perform set_config('request.jwt.claims',json_build_object('sub',org)::text,true);
  res:=public.list_members(grp);
  if exists(select 1 from jsonb_array_elements(res) e where e ? 'email_confirmed' and e->'email_confirmed'<>'null'::jsonb) then raise exception 'organiser saw confirmation flag'; end if; checks:=checks+1;

  -- organiser, player and other-group admin are refused
  begin perform public.list_pending_signups(grp); raise exception 'organiser allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin perform public.claim_verification_resend(grp,p_game); raise exception 'organiser claim allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  perform set_config('request.jwt.claims',json_build_object('sub',other_admin)::text,true);
  begin perform public.list_pending_signups(grp); raise exception 'cross-group allowed';
  exception when insufficient_privilege then checks:=checks+1; end;
  begin perform public.claim_verification_resend(other_grp,p_game); raise exception 'cross-group claim allowed';
  exception when no_data_found then checks:=checks+1; end;
  begin perform public.claim_verification_resend(grp,p_game); raise exception 'cross-group claim allowed 2';
  exception when insufficient_privilege then checks:=checks+1; end;

  -- claim: returns redirect info but no email, writes audit, rate limited
  perform set_config('request.jwt.claims',json_build_object('sub',admin)::text,true);
  claim:=public.claim_verification_resend(grp,p_game);
  if claim->>'game_id'<>game::text or claim::text like '%@%' then raise exception 'claim content %',claim; end if; checks:=checks+1;
  begin perform public.claim_verification_resend(grp,p_game); raise exception 'rate limit missing';
  exception when raise_exception then if sqlerrm<>'resend_too_soon' then raise; end if; checks:=checks+1; end;
  claim:=public.claim_verification_resend(grp,p_inv);
  if claim->>'invite_token'<>inv->>'token' then raise exception 'invite redirect %',claim; end if; checks:=checks+1;
  begin perform public.claim_verification_resend(grp,p_conf); raise exception 'confirmed claimable';
  exception when no_data_found then checks:=checks+1; end;
  begin perform public.claim_verification_resend(grp,p_old); raise exception 'old claimable';
  exception when no_data_found then checks:=checks+1; end;
  res:=public.list_pending_signups(grp);
  if res->0->>'resend_available_at' is null or res->0->>'last_email_at' is null then raise exception 'resend timing %',res; end if; checks:=checks+1;
  select count(*) into n from public.audit_events where group_id=grp and action='verification_resent' and actor_id=admin and target_user_id=p_game;
  if n<>1 then raise exception 'audit missing'; end if; checks:=checks+1;
  res:=public.list_activity_log(grp,current_date-1,current_date+1,null,null,'verification_resent');
  if res->'items'->0->'details'->>'masked_email'<>'ec•••@yahoo.com.sg' then raise exception 'log details %',res->'items'->0; end if; checks:=checks+1;

  -- dismiss hides the entry and is audited
  perform public.dismiss_pending_signup(grp,p_inv);
  if jsonb_array_length(public.list_pending_signups(grp))<>1 then raise exception 'dismiss'; end if; checks:=checks+1;
  begin perform public.dismiss_pending_signup(grp,p_inv); raise exception 'double dismiss';
  exception when no_data_found then checks:=checks+1; end;

  -- raw tables are not reachable by clients
  set local role authenticated;
  begin perform 1 from private.verification_resends; raise exception 'private table readable';
  exception when insufficient_privilege then checks:=checks+1; end;
  reset role;
  raise notice 'FR-015 pending sign-ups: % checks passed',checks;
end $$;
rollback;
