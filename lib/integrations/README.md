# Integration layer

Provider integrations live behind domain interfaces. Canonical training data must never be mutated to match provider-specific formats. Translate at the boundary, validate with QA, persist provider IDs and sync jobs separately, and classify transient failures for retry.
