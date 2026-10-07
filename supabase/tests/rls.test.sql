begin;
select plan(11);

insert into public.roles (id, title, org, market, fit) values ('seed', 'T', 'O', 'NL', 'Good');

-- anonymous
set local role anon;
select is((select count(*)::int from public.roles), 0, 'anon reads nothing');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('a1','T','O','NL','Good')$$, '42501', null, 'anon cannot insert');
reset role;

-- outsider
set local role authenticated;
set local request.jwt.claims = '{"email":"eve@example.com","role":"authenticated"}';
select is((select count(*)::int from public.roles), 0, 'outsider reads nothing');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('e1','T','O','NL','Good')$$, '42501', null, 'outsider cannot insert');
update public.roles set notes = 'hacked' where id = 'seed';
reset role;
select is((select notes from public.roles where id = 'seed'), '', 'outsider update changed nothing');

-- look-alike domains
set local role authenticated;
set local request.jwt.claims = '{"email":"eve@inogen.ai.evil.com","role":"authenticated"}';
select is((select count(*)::int from public.roles), 0, 'suffix look-alike reads nothing');
set local request.jwt.claims = '{"email":"eve@notinogen.ai","role":"authenticated"}';
select is((select count(*)::int from public.roles), 0, 'prefix look-alike reads nothing');

-- insider, mixed case
set local request.jwt.claims = '{"email":"Mike@InoGen.AI","role":"authenticated"}';
select is((select count(*)::int from public.roles), 1, 'inogen user reads');
select lives_ok($$insert into public.roles (id, title, org, market, fit) values ('m1','T','O','UK','Strong')$$, 'inogen user inserts');
select is((select updated_by from public.roles where id = 'm1'), 'Mike@InoGen.AI', 'audit trigger records the editor');
select throws_ok($$insert into public.roles (id, title, org, market, fit) values ('m2','T','O','Mars','Good')$$, '23514', null, 'market check constraint');
reset role;

select * from finish();
rollback;
