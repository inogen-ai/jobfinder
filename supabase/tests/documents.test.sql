begin;
select plan(14);

-- Hermetic setup (rolled back at the end). Deleting roles cascades to documents.
delete from public.fetch_log;
delete from public.profiles;
delete from public.roles;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@inogen.ai'),
  ('00000000-0000-0000-0000-00000000000b', 'b@inogen.ai'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com')
on conflict (id) do nothing;
insert into public.roles (id, title, org, market, fit) values ('r1', 'T', 'O', 'NL', 'Good');
insert into public.roles (id, title, org, market, fit, deleted_at) values ('gone', 'T', 'O', 'NL', 'Good', now());

-- A: inogen.ai via Microsoft
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"a@inogen.ai","role":"authenticated","app_metadata":{"provider":"azure"}}';
select lives_ok($$insert into public.profiles (cv_text) values ('A cv')$$, 'user creates own profile');
select throws_ok($$insert into public.profiles (user_id, cv_text) values ('00000000-0000-0000-0000-00000000000b', 'x')$$, '42501', null, 'cannot create a profile for someone else');
select lives_ok($$insert into public.documents (role_id, kind, title, body, model) values ('r1', 'cover_letter', 't', 'b', 'm')$$, 'user creates a document for a visible role');
select throws_ok($$insert into public.documents (role_id, kind, title, body, model) values ('gone', 'pitch', 't', 'b', 'm')$$, '42501', null, 'cannot attach a document to a deleted role');
select is((select count(*)::int from public.documents), 1, 'user reads own documents');
select lives_ok($$update public.roles set job_description = 'JD' where id = 'r1'$$, 'job_description is editable like other role fields');
update public.documents set user_id = '00000000-0000-0000-0000-00000000000b';
select lives_ok($$insert into public.fetch_log (role_id) values ('r1')$$, 'user logs a fetch');
reset role;
select is((select user_id::text from public.documents limit 1), '00000000-0000-0000-0000-00000000000a', 'document owner cannot be reassigned');

-- B: another inogen.ai user
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"b@inogen.ai","role":"authenticated","app_metadata":{"provider":"azure"}}';
select is((select count(*)::int from public.profiles), 0, 'B cannot read A''s profile');
select is((select count(*)::int from public.documents), 0, 'B cannot read A''s documents');
update public.documents set body = 'hijacked';
reset role;
select is((select body from public.documents limit 1), 'b', 'B cannot change A''s document');

-- A again, but through the password provider
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"a@inogen.ai","role":"authenticated","app_metadata":{"provider":"email"}}';
select is((select count(*)::int from public.documents), 0, 'non-Microsoft sign-in reads no documents');
-- outsider
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000e","email":"eve@example.com","role":"authenticated","app_metadata":{"provider":"azure"}}';
select is((select count(*)::int from public.profiles), 0, 'outsider reads no profiles');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.documents$$, '42501', null, 'anon has no access to documents');
reset role;

select * from finish();
rollback;
