-- 001_policy.sql
create policy "public reads approved spots"
  on public.locations for select
  using (status = 'approved');
