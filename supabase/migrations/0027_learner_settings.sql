-- ============================================================================
-- Whizzo — the learner's own settings
--
-- Sound on or off, the on-screen keyboard and hand guide in typing, and the
-- flip-or-slide layout in flashcards. These used to live in one browser's
-- localStorage, so a child who turned the keyboard off on the iPad found it
-- back on the laptop, and two siblings sharing a tablet shared one set of
-- switches. Now they ride on the learner, the way `theme` does (0012).
--
-- Cosmetic only: nothing here changes the curriculum, the difficulty, or what
-- earns a reward, and none of it appears in `attempts`.
--
-- One jsonb object rather than a column per switch. The set of settings is a
-- client concept and will grow; a new switch should not need a migration, and
-- a key the client no longer reads is simply ignored. The check bounds the
-- shape (an object, and a small one), not the keys. The API validates keys.
--
-- No new policy. `learners_update` gates on can_manage_learner_content(),
-- which admits exactly the three writers this needs: the owner, the learner
-- themselves, and a guardian holding can_manage_content. "The learner picks
-- it or a grown-up sets it" is already spelled out.
--
-- The API merges a patch into the stored object (`settings || $n`), so a
-- request that only carries one key never wipes the rest.
-- ============================================================================

alter table public.learners
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.learners
  drop constraint if exists learners_settings_shape;

alter table public.learners
  add constraint learners_settings_shape
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096);

comment on column public.learners.settings is
  'The learner''s own switches: sound, typing helpers, flashcard layout. A small jsonb object, merged on write. Display state only: never affects curriculum, difficulty, or what earns a reward.';
