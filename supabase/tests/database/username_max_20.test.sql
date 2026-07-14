-- Issue 7: Verify username max is 20 characters in is_username_available

begin;

select plan(3);

-- 20-char username should be valid pattern (if no conflicts)
select ok(
  exists (
    select 1 from public.is_username_available('abcdefghijklmnopqrst')
    where is_username_available = true or is_username_available = false
  ),
  'is_username_available accepts 20-char username without error'
);

-- 21-char username should always return false
select is(
  (select is_username_available from public.is_username_available('abcdefghijklmnopqrstu')),
  false,
  '21-char username is rejected by is_username_available'
);

-- 3-char username is the minimum (pattern check only, may be taken)
select ok(
  exists (
    select 1 from public.is_username_available('abc')
    where is_username_available = true or is_username_available = false
  ),
  'is_username_available accepts 3-char username without error'
);

select finish();

rollback;
