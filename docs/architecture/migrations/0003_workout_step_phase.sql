-- PAU-10: preserve the semantic role of executable workout steps.
-- Repeat containers remain phase-neutral; executable steps may be warmup, active,
-- recovery or cooldown.

alter table workout_steps
  add column phase text;

alter table workout_steps
  add constraint workout_step_phase_valid check (
    (kind = 'repeat' and phase is null)
    or
    (kind = 'step' and phase in ('warmup', 'active', 'recovery', 'cooldown'))
  );

comment on column workout_steps.phase is
  'Semantic workout phase for executable steps: warmup, active, recovery or cooldown.';
