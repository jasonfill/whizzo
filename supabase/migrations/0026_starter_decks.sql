-- ============================================================================
-- Whizzo — the starter decks a learner has added
--
-- Starter decks ship with the app as client constants. They used to be folded
-- into every learner's list, so a six-year-old opened Flashcards to find 312
-- cards of Spanish, anatomy and the solar system already "theirs", and every
-- total counted them. Now they are a catalog: nothing reaches a learner
-- uninvited (docs/ux-coherence.md). A deck is in the learner's list only once
-- somebody added it, and this column is the list of what was added.
--
-- Plain text ids, no foreign key and no enum: the catalog is a client concept
-- and will grow, and an id the client no longer ships is simply not drawn. The
-- constraint bounds the shape (a short list of short ids), not the contents.
--
-- No new policy. `learners_update` gates on can_manage_learner_content(),
-- which admits exactly the three writers this needs: the owner, the learner
-- themselves, and a guardian holding can_manage_content. A child adding a
-- starter deck from their own session is covered the same way `theme` is.
--
-- The one-time backfill adds any starter deck the learner had already
-- practiced, so nobody's progress goes quiet: the mastery rows are keyed
-- `quiz` / `<deckId>:<cardId>`, and the deck id is the first segment.
-- ============================================================================

alter table public.learners
  add column if not exists starter_decks text[] not null default '{}';

-- A check constraint may not contain a subquery, so the per-entry length test
-- lives in an immutable helper.
create or replace function public.short_ids_ok(p_ids text[], p_max_len int)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(x is not null and char_length(x) between 1 and p_max_len), true)
    from unnest(p_ids) as x
$$;

alter table public.learners
  drop constraint if exists learners_starter_decks_shape;

alter table public.learners
  add constraint learners_starter_decks_shape
  check (cardinality(starter_decks) <= 50 and public.short_ids_ok(starter_decks, 64));

comment on column public.learners.starter_decks is
  'Ids of the starter decks the learner has added to their list. Starters are a client catalog; an id not in the shipped set is ignored.';

-- Backfill once: a starter deck already practiced stays in the list, so the
-- mastery earned on it is still visible. Runs only over learners whose list is
-- still empty, so a rerun by hand cannot undo a removal.
update public.learners l
   set starter_decks = s.ids
  from (
    select learner_id,
           array_agg(distinct split_part(item_key, ':', 1)) as ids
      from public.item_mastery
     where subject = 'quiz' and item_key like 'starter-%'
     group by learner_id
  ) s
 where s.learner_id = l.id
   and l.starter_decks = '{}';
