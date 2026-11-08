-- SkillQuest 006: remember which skills the player EARNED by beating a stage boss, so the map's
-- "To learn" list stops showing them. is_gap stays as it was (the original gap from the resume):
-- the resume revamp needs it to tell "skills you already had" from "skills you earned".
-- Apply after 005:  supabase db push --remote

alter table public.skills add column earned_at timestamptz;

-- Back-fill: skills whose stage boss is already beaten.
update public.skills sk
   set earned_at = now()
 where earned_at is null
   and exists (select 1 from public.stages st join public.levels lv on lv.stage_id = st.id
                where st.skill_id = sk.id and lv.type = 'boss' and lv.status = 'completed');

-- complete_level: same as 002, plus marking the stage's skill earned when its boss is beaten.
create or replace function public.complete_level(level_id uuid, score int, xp_earned int default 0)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level   levels%rowtype;
  v_stage   stages%rowtype;
  v_plan    plans%rowtype;
  v_profile profiles%rowtype;
  v_next_id uuid;
  v_score   int := least(greatest(coalesce(score, 0), 0), 100);
  v_award   int := 0;
  v_today   date := (now() at time zone 'utc')::date;
begin
  select * into v_level from levels where id = complete_level.level_id for update;
  if not found then raise exception 'Level not found'; end if;
  select * into v_stage from stages where id = v_level.stage_id;
  select * into v_plan from plans where id = v_stage.plan_id;
  if v_plan.user_id is distinct from auth.uid() then raise exception 'Not your level'; end if;
  if v_level.status = 'locked' then raise exception 'Level is locked'; end if;
  if v_score < 60 then raise exception 'Score % is below the 60%% pass mark', v_score; end if;

  if v_level.status <> 'completed' then
    v_award := greatest(0, least(coalesce(xp_earned, 0), 500));                 -- first completion
  elsif v_score > coalesce(v_level.best_score, 0) then
    v_award := greatest(0, least(coalesce(xp_earned, 0), 500))
               * (v_score - coalesce(v_level.best_score, 0)) / 100;             -- only the improvement
  end if;

  update levels
     set status = 'completed',
         best_score = greatest(coalesce(best_score, 0), v_score)
   where id = v_level.id;

  -- Next level in this stage, else the first level of the next stage.
  select id into v_next_id from levels
   where stage_id = v_stage.id and idx > v_level.idx
   order by idx limit 1;
  if v_next_id is null then
    select lv.id into v_next_id
      from stages st join levels lv on lv.stage_id = st.id
     where st.plan_id = v_plan.id and st.idx > v_stage.idx
     order by st.idx, lv.idx limit 1;
  end if;
  if v_next_id is not null then
    update levels set status = 'unlocked' where id = v_next_id and status = 'locked';
  end if;

  -- Beating a stage's boss earns that stage's skill: it leaves "To learn" (migration 006).
  if v_level.type = 'boss' then
    update skills set earned_at = coalesce(earned_at, now()) where id = v_stage.skill_id;
  end if;

  update plans
     set match_pct = compute_match_pct(v_plan.id),
         xp = xp + v_award
   where id = v_plan.id
   returning * into v_plan;

  -- Profile: total XP + streak (+1 if last active yesterday, same if today, else 1).
  insert into profiles (id) values (v_plan.user_id) on conflict (id) do nothing;
  update profiles
     set total_xp = total_xp + v_award,
         streak = case
                    when last_active_date = v_today then greatest(streak, 1)
                    when last_active_date = v_today - 1 then streak + 1
                    else 1
                  end,
         last_active_date = v_today
   where id = v_plan.user_id
   returning * into v_profile;

  return json_build_object(
    'match_pct', v_plan.match_pct,
    'xp', v_plan.xp,
    'xp_awarded', v_award,
    'total_xp', v_profile.total_xp,
    'streak', v_profile.streak,
    'next_level_id', v_next_id);
end;
$$;


revoke all on function public.complete_level(uuid, int, int) from public, anon;
grant execute on function public.complete_level(uuid, int, int) to authenticated;
