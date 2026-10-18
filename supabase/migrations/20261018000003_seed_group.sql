-- Seed the first group and its bootstrap admin (becomes admin automatically on first sign-in).
insert into public.groups (name, timezone, default_capacity)
values ('Tuesday Socials @CBP1', 'Asia/Singapore', 16);

insert into private.bootstrap_admins (email, group_id)
select 'jon@doblados.net', id from public.groups where name = 'Tuesday Socials @CBP1';
