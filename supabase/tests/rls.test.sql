begin;
select plan(20);

-- Hermetic: ignore whatever a local dev stack already holds (rolled back at the end).
delete from public.roles;
insert into public.roles (id, title, org, market, fit) values ('seed', 'T', 'O', 'NL', 'Good');

-- anonymous: no table privileges at all
set local role anon;
select throws_ok($$select count(*) from public.roles$$, '42501', null, 'anon has no access to roles');
reset role;

-- outsider with a Microsoft sign-in
set local role authenticated;
set local request.jwt.claims = '{"email":"eve@example.com","role":"authenticated","app_metadata":{"provider":"azure"}}';
select is((select count(*)::int from public.roles), 0, 'outsider reads nothing');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('e1','T','O','NL','Good')$$, '42501', null, 'outsider cannot insert');
update public.roles set notes = 'hacked' where id = 'seed';
delete from public.roles where id = 'seed';
reset role;
select is((select notes from public.roles where id = 'seed'), '', 'outsider update changed nothing');
select is((select count(*)::int from public.roles where id = 'seed'), 1, 'outsider delete removed nothing');

-- look-alike domains
set local role authenticated;
set local request.jwt.claims = '{"email":"eve@inogen.ai.evil.com","role":"authenticated","app_metadata":{"provider":"azure"}}';
select is((select count(*)::int from public.roles), 0, 'suffix look-alike reads nothing');
set local request.jwt.claims = '{"email":"eve@notinogen.ai","role":"authenticated","app_metadata":{"provider":"azure"}}';
select is((select count(*)::int from public.roles), 0, 'prefix look-alike reads nothing');

-- an inogen.ai address that did NOT come through Microsoft (e.g. a password sign-up)
set local request.jwt.claims = '{"email":"x@inogen.ai","role":"authenticated","app_metadata":{"provider":"email"}}';
select is((select count(*)::int from public.roles), 0, 'inogen.ai email via password provider reads nothing');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('p1','T','O','NL','Good')$$, '42501', null, 'inogen.ai email via password provider cannot insert');

-- insider through Microsoft, mixed case
set local request.jwt.claims = '{"email":"Mike@InoGen.AI","role":"authenticated","app_metadata":{"provider":"azure"}}';
select is((select count(*)::int from public.roles), 1, 'inogen user reads');
select lives_ok($$insert into public.roles (id, title, org, market, fit, created_by, updated_by) values ('m1','T','O','UK','Strong','forged','forged')$$, 'inogen user inserts');
select is((select updated_by from public.roles where id = 'm1'), 'Mike@InoGen.AI', 'audit ignores client-supplied updated_by');
select is((select created_by from public.roles where id = 'm1'), 'Mike@InoGen.AI', 'audit ignores client-supplied created_by');
select lives_ok($$update public.roles set notes = 'called' where id = 'm1'$$, 'inogen user updates');
update public.roles set created_by = 'someone-else', created_at = '2000-01-01' where id = 'm1';
select is((select created_by from public.roles where id = 'm1'), 'Mike@InoGen.AI', 'creator cannot be rewritten');
select ok((select created_at from public.roles where id = 'm1') > now() - interval '1 minute', 'creation time cannot be rewritten');
select is((select notes from public.roles where id = 'm1'), 'called', 'update applied');
select lives_ok($$update public.roles set deleted_at = now() where id = 'm1'$$, 'inogen user soft-deletes');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('m2','T','O','Mars','Good')$$, '23514', null, 'market check constraint');
delete from public.roles where id = 'm1';
reset role;
select is((select count(*)::int from public.roles where id = 'm1'), 1, 'hard delete is not allowed from the app (deletes are soft)');

select * from finish();
rollback;
