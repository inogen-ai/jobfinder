begin;
select plan(23);

-- Hermetic setup (rolled back at the end). Deleting roles cascades to documents.
delete from public.usage_log;
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
-- spend limit cannot be dodged by rewriting history
insert into public.documents (role_id, kind, title, body, model, created_at) values ('r1', 'pitch', 'old', 'b', 'm', '2000-01-01');
select ok((select created_at from public.documents where title = 'old') > now() - interval '1 minute', 'insert cannot backdate created_at');
update public.documents set created_at = '2000-01-01', model = 'forged', input_tokens = 0, kind = 'cv' where title = 'old';
select ok((select created_at from public.documents where title = 'old') > now() - interval '1 minute', 'update cannot backdate created_at');
select is((select model || '/' || kind from public.documents where title = 'old'), 'm/pitch', 'update cannot change model or kind');
select is(public.claim_usage('generate', 'r1', 2), null, 'first claim is allowed');
select is(public.claim_usage('generate', 'r1', 2), null, 'second claim is allowed');
select isnt(public.claim_usage('generate', 'r1', 2), null, 'third claim over the limit returns a retry time');
select is((select count(*)::int from public.usage_log where action = 'generate'), 2, 'refused claims are not recorded');
insert into public.usage_log (action, role_id, created_at) values ('fetch', 'r1', '2000-01-01');
update public.usage_log set created_at = '2000-01-01';
delete from public.usage_log;
reset role;
select is((select count(*)::int from public.usage_log where created_at > now() - interval '1 minute'), 3, 'usage rows cannot be backdated, edited or deleted by the user');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"a@inogen.ai","role":"authenticated","app_metadata":{"provider":"azure"}}';
reset role;
select is((select user_id::text from public.documents limit 1), '00000000-0000-0000-0000-00000000000a', 'document owner cannot be reassigned');

-- grouped counts for the badge: own live drafts only, grouped by role
insert into public.roles (id, title, org, market, fit) values ('r2', 'T', 'O', 'NL', 'Good');
reset role;
insert into public.roles (id, title, org, market, fit) values ('r2', 'T', 'O', 'NL', 'Good') on conflict do nothing;
set local role authenticated;
insert into public.documents (role_id, kind, title, body, model) values ('r2', 'cv', 't', 'b', 'm'), ('r2', 'cv', 't', 'b', 'm');
update public.documents set deleted_at = now() where role_id = 'r2' and title = 't' and id = (select id from public.documents where role_id = 'r2' limit 1);
select is((select n from public.document_counts() where role_id = 'r2'), 1::bigint, 'counts exclude soft-deleted drafts');
select is((select sum(n) from public.document_counts()), 3::numeric, 'counts cover all of the user''s live drafts');

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
