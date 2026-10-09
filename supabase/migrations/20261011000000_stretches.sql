/*
  # Stretches as workout items

  1. Changes
    - workout_exercises.stretch_for: the exercise this stretch prepares for / follows (catalog id)
    - workout_exercises.stretch_when: 'before' or 'after'
    Rows with stretch_when set are stretches; they never affect lift progression.
*/

ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS stretch_for text;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS stretch_when text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_exercises_stretch_when_check') THEN
    ALTER TABLE workout_exercises ADD CONSTRAINT workout_exercises_stretch_when_check
      CHECK (stretch_when IS NULL OR stretch_when IN ('before', 'after'));
  END IF;
END $$;
