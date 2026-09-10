-- A deck a person wrote is not a draft.
--
-- 0017 made `accepted_at is null` the draft state and gated assignment on it,
-- for the sets a model builds: a generated set is unreviewed until a grown-up
-- looks it over. It left the column null on every deck a person had typed —
-- and the gate, whose whole predicate is one `is not null`, then refused to
-- set those as work too, with a message about a review nobody could perform.
--
-- The rule stays as 0017 states it. What changes is who counts as reviewed:
-- a set with no `source_id` was written by a person, or by an assistant into
-- the library where a person saves it, and the API now stamps it accepted on
-- save. This corrects the rows that predate that. Word lists get the same
-- treatment so the next gate on `accepted_at` does not repeat the mistake.
--
-- Deliberately NOT edited: 0017. It is the historical record.
--
-- Re-runnable: the where clause matches nothing the second time.

update public.decks
   set accepted_at = created_at
 where source_id is null and accepted_at is null;

update public.word_lists
   set accepted_at = created_at
 where source_id is null and accepted_at is null;
