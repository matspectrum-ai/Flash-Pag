-- Recovery reset is a retryable external-auth workflow. The database must
-- never consume the challenge unless the active kit is consumed in the same
-- transaction, and an expired in-progress challenge must not remain reusable.

create or replace function public.flashpag_begin_recovery_reset(
  p_challenge_id uuid,
  p_token_hash text
)
returns table(user_id uuid, key_id text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_user_id uuid;
  current_key_id text;
  current_expires_at timestamptz;
begin
  select c.status, c.user_id, c.key_id, c.expires_at
    into current_status, current_user_id, current_key_id, current_expires_at
  from public.account_recovery_challenges c
  where c.id = p_challenge_id and c.token_hash = p_token_hash
  for update;

  if current_status is null then
    return;
  end if;

  if current_status in ('verified', 'consuming') and current_expires_at <= now() then
    update public.account_recovery_challenges
    set status = 'expired'
    where id = p_challenge_id and status = current_status;
    return;
  end if;

  if current_status = 'verified' then
    update public.account_recovery_challenges c
    set status = 'consuming'
    where c.id = p_challenge_id
      and c.status = 'verified'
      and c.expires_at > now()
      and exists (
        select 1
        from public.account_recovery_kits k
        where k.user_id = c.user_id
          and k.key_id = c.key_id
          and k.status = 'active'
      );
    if not found then
      return;
    end if;
    current_status := 'consuming';
  elsif current_status <> 'consuming' then
    return;
  end if;

  return query select current_user_id, current_key_id, current_status;
end;
$$;

create or replace function public.flashpag_finalize_recovery_reset(
  p_challenge_id uuid,
  p_user_id uuid,
  p_key_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_recovery_kits
  set status = 'used', used_at = now(), revoked_at = now()
  where user_id = p_user_id
    and key_id = p_key_id
    and status = 'active';
  if not found then
    return false;
  end if;

  update public.account_recovery_challenges
  set status = 'consumed', consumed_at = now()
  where id = p_challenge_id
    and user_id = p_user_id
    and key_id = p_key_id
    and status = 'consuming'
    and expires_at > now();
  if not found then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.flashpag_begin_recovery_reset(uuid,text) from public, anon, authenticated;
revoke all on function public.flashpag_finalize_recovery_reset(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.flashpag_begin_recovery_reset(uuid,text) to service_role;
grant execute on function public.flashpag_finalize_recovery_reset(uuid,uuid,text) to service_role;
