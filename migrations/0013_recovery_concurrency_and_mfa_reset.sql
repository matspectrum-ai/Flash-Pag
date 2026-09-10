create unique index if not exists account_recovery_challenges_active_key_idx
  on public.account_recovery_challenges(user_id, key_id)
  where status in ('verified','consuming');

create or replace function public.flashpag_begin_recovery_reset(
  p_challenge_id uuid,
  p_token_hash text
)
returns table(user_id uuid, key_id text, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.account_recovery_challenges c
  set status = 'consuming'
  where c.id = p_challenge_id
    and c.token_hash = p_token_hash
    and c.status = 'verified'
    and c.expires_at > now()
    and exists (
      select 1 from public.account_recovery_kits k
      where k.user_id = c.user_id and k.key_id = c.key_id and k.status = 'active'
    )
  returning c.user_id, c.key_id, c.status;
end;
$$;

create or replace function public.flashpag_reset_user_mfa(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.mfa_factors where user_id = p_user_id;
$$;

revoke all on function public.flashpag_begin_recovery_reset(uuid,text) from public, anon, authenticated;
revoke all on function public.flashpag_reset_user_mfa(uuid) from public, anon, authenticated;
grant execute on function public.flashpag_begin_recovery_reset(uuid,text) to service_role;
grant execute on function public.flashpag_reset_user_mfa(uuid) to service_role;
