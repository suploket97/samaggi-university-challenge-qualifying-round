// Copy of supabase/setup.sql, run automatically by db-setup.ts. Keep the two in sync.
export const SETUP_SQL = String.raw`-- Samaggi University Challenge – Qualifying Round: question bank tables.
-- The app runs this automatically the first time the host dashboard opens (using
-- Vercel's POSTGRES_URL). You can also run it by hand in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.quiz_packs (
  quiz_pack_id            text primary key check (quiz_pack_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  title                   text not null,
  description             text,
  default_time_limit_sec  integer not null default 30 check (default_time_limit_sec between 5 and 600),
  default_base_points     integer not null default 100 check (default_base_points between 0 and 1000),
  speed_tiers             jsonb,
  tags                    text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists public.questions (
  question_id   text primary key check (question_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  quiz_pack_id  text not null references public.quiz_packs (quiz_pack_id) on delete cascade,
  position      integer not null default 0,
  type          text not null check (type in ('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'TEXT_INPUT', 'SUB_QUESTIONS_TEXT', 'ORDERING', 'MATCHING')),
  data          jsonb not null,  -- the full question, including answers
  updated_at    timestamptz not null default now()
);

create index if not exists questions_pack_position_idx on public.questions (quiz_pack_id, position);

-- Keep answers secret: Row Level Security on, and no policies at all.
-- Browsers (anon / logged-in keys) can read nothing. Only the server, using
-- the service-role key, can read or write these tables.
alter table public.quiz_packs enable row level security;
alter table public.questions  enable row level security;
revoke all on public.quiz_packs from anon, authenticated;
revoke all on public.questions  from anon, authenticated;

-- Allow time limits up to 10 minutes (for databases created with an older version of this file).
alter table public.quiz_packs drop constraint if exists quiz_packs_default_time_limit_sec_check;
alter table public.quiz_packs add constraint quiz_packs_default_time_limit_sec_check
  check (default_time_limit_sec between 5 and 600);

-- Allow every question type, including TRUE_FALSE, ORDERING and MATCHING (for databases created with an older version of this file).
alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check
  check (type in ('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'TEXT_INPUT', 'SUB_QUESTIONS_TEXT', 'ORDERING', 'MATCHING'));

-- Competition log: a permanent record of every game, for settling disputes.
-- Written by the server as the game runs; read-only in the app.
create table if not exists public.competitions (
  competition_id    text primary key,
  room_code         text not null,
  pack_id           text,
  pack_title        text,
  status            text not null default 'LIVE' check (status in ('LIVE', 'FINISHED')),
  created_at        timestamptz not null,
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz,
  question_total    integer not null default 0,
  questions_played  integer not null default 0,
  settings          jsonb,
  teams             jsonb not null default '[]',   -- [{team_id, name, joined_at, flags}]
  standings         jsonb not null default '[]',   -- leaderboard after the latest reveal
  qualification     jsonb
);

create table if not exists public.competition_questions (
  competition_id  text not null references public.competitions (competition_id) on delete cascade,
  question_index  integer not null,
  question        jsonb not null,  -- the question exactly as it was asked, with its answers
  effective       jsonb not null,  -- time limit, points and speed bonus actually used
  started_at      timestamptz,
  planned_end_at  timestamptz,
  closed_at       timestamptz,
  closed_by       text,            -- HOST (locked early) or TIMER
  revealed_at     timestamptz,
  results         jsonb,           -- every team's answer, how it was marked, points
  stats           jsonb,
  primary key (competition_id, question_index)
);

create table if not exists public.competition_events (
  event_id        bigint generated always as identity primary key,
  competition_id  text not null references public.competitions (competition_id) on delete cascade,
  at              timestamptz not null,
  kind            text not null,
  question_index  integer,
  detail          jsonb
);

create index if not exists competitions_created_idx on public.competitions (created_at desc);
create index if not exists competition_events_idx on public.competition_events (competition_id, event_id);

alter table public.competitions          enable row level security;
alter table public.competition_questions enable row level security;
alter table public.competition_events    enable row level security;
revoke all on public.competitions          from anon, authenticated;
revoke all on public.competition_questions from anon, authenticated;
revoke all on public.competition_events    from anon, authenticated;

-- Storage for question pictures, audio and video. Files are public so the
-- stage and phones can load them; only the server can create upload links.
-- (Wrapped so a storage permission problem never blocks the tables above;
-- the app also creates this bucket itself on the first upload.)
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('quiz-media', 'quiz-media', true, 52428800)
  on conflict (id) do update set public = true;
exception when others then
  raise notice 'quiz-media bucket not created: %', sqlerrm;
end
$$;

-- Tell Supabase's API to pick up the new tables straight away.
notify pgrst, 'reload schema';
`;
