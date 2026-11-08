-- SkillQuest 003: log of revamped-resume emails + an atomic "reserve a send" function, used to
-- rate-limit the send-resume Edge Function (so nobody can use our sender address to spam).
-- Apply after 002:  supabase db push --remote
--
-- Privacy: we store WHO sent (user), WHEN, and the recipient's DOMAIN only — never the
-- resume, never the full recipient address.
-- Only the send-resume Edge Function (service role) reads/writes this table. The app can't.
--
-- Flow: send-resume calls reserve_resume_email() BEFORE sending. It locks, checks the limits,
-- and inserts the log row in one transaction, so parallel requests can't slip past the limit.
-- If SES then fails, the function deletes that row (the failed send doesn't count).

create table public.resume_emails (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  plan_id          uuid references public.plans (id) on delete set null,
  recipient_domain text not null check (char_length(recipient_domain) <= 255),
  with_pdf         bool not null default false,
  sent_at          timestamptz not null default now()
);

create index resume_emails_user_sent_idx on public.resume_emails (user_id, sent_at desc);
create index resume_emails_sent_idx on public.resume_emails (sent_at desc);

-- RLS on with no policies = nobody but the service role can touch it.
alter table public.resume_emails enable row level security;
revoke all on public.resume_emails from anon, authenticated;

-- Limits. Per user stops one account spamming; the GLOBAL cap stops many throwaway
-- guest accounts together (guest sign-up is free).
--   per user:   3 / hour, 10 / day
--   everyone:  50 / hour, 200 / day
-- Returns the new row id, or raises 'rate_limited_user' / 'rate_limited_global'.
create or replace function public.reserve_resume_email(
  p_user_id uuid, p_plan_id uuid, p_recipient_domain text, p_with_pdf bool
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_hour int; v_user_day int; v_all_hour int; v_all_day int; v_id uuid;
begin
  -- One global lock for the duration of this transaction: checks + insert are atomic.
  -- (Sends are rare, so serializing them costs nothing.)
  perform pg_advisory_xact_lock(hashtext('resume_emails'));

  select count(*) filter (where sent_at > now() - interval '1 hour'),
         count(*)
    into v_user_hour, v_user_day
    from resume_emails
   where user_id = p_user_id and sent_at > now() - interval '1 day';
  if v_user_hour >= 3 or v_user_day >= 10 then
    raise exception 'rate_limited_user';
  end if;

  select count(*) filter (where sent_at > now() - interval '1 hour'),
         count(*)
    into v_all_hour, v_all_day
    from resume_emails
   where sent_at > now() - interval '1 day';
  if v_all_hour >= 50 or v_all_day >= 200 then
    raise exception 'rate_limited_global';
  end if;

  insert into resume_emails (user_id, plan_id, recipient_domain, with_pdf)
  values (p_user_id, p_plan_id, left(lower(p_recipient_domain), 255), coalesce(p_with_pdf, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- Service role only (the Edge Function). Not callable from the app.
revoke all on function public.reserve_resume_email(uuid, uuid, text, bool) from public, anon, authenticated;
grant execute on function public.reserve_resume_email(uuid, uuid, text, bool) to service_role;
grant select, insert, delete on public.resume_emails to service_role;
