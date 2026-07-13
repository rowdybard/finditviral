insert into private.app_owners (user_id)
select id from auth.users where email = 'ally@finditviral.com'
on conflict (user_id) do nothing;
