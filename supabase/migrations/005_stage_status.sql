-- SkillQuest 005: build the map faster. create-plan now designs only stage 1 (so the map shows
-- sooner) and saves the other stages as 'pending'; the build-stage function designs them in the
-- background while the player starts playing.
-- Apply after 004:  supabase db push --remote

alter table public.stages
  add column status      text not null default 'ready' check (status in ('ready', 'pending', 'building')),
  add column mode        text not null default 'gap' check (mode in ('gap', 'polish')), -- "polish" = review stage
  add column building_at timestamptz; -- when build-stage claimed it (a stale claim can be retried)

-- Existing stages (and the demo plan via import_plan) are already built: 'ready' by default.
