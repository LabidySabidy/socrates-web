# Course — Codebase Assessment Fixture

```yaml
kind: codebase
title: Codebase Assessment Fixture
```

## Unit 1: Policies

> Questions here are grounded in this repository, not in invented text.

### Group: Read the code

- **Module** (`article`) Read the policy
- **Module** (`quiz`) Check your thinking

## Quiz: Policy basics

- **Q** Which condition does the policy use to hide pending rows?
  - **answer:** status = 'approved'
  - **accepts:** status='approved' | status = approved
  - **hint:** Look at the USING clause.
  - **hint:** It compares one column to a single literal.
  - **hint:** The column stores the moderation state.
  - **step:** Open src/migrations/001_policy.sql
  - **step:** The USING clause reads status = 'approved'
  - **step:** Anything not approved is invisible to the public reader.
  - **cite:** src/migrations/001_policy.sql#L4

- **Q** Which command does the policy apply to?
  - **answer:** select
  - **hint:** Read the line above the USING clause.
  - **hint:** It is the read path, not a write.
  - **step:** The for clause names the command a policy governs.
  - **step:** This one is for select.
  - **cite:** src/migrations/001_policy.sql#L3

- **Q** What is the table named in the policy?
  - **answer:** locations
  - **accepts:** public.locations
  - **hint:** It is schema-qualified.
  - **hint:** The schema is public.
  - **step:** The on clause names the table.
  - **step:** public.locations, so the table is locations.
  - **cite:** src/migrations/001_policy.sql#L2
