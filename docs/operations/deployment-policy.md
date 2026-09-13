# Deployment policy

## Purpose

Keep Vercel production deployments reliable on the Hobby plan while avoiding repeated Preview resource-provisioning failures on feature-branch pushes.

## Automatic deployment policy

- `main` is the only Git branch that automatically deploys to Vercel.
- Feature branches and pull requests do **not** automatically create Vercel Preview deployments.
- Pull requests are validated by the independent GitHub Actions `Quality gate`, which runs `npm ci` and `npm run build` without production credentials.
- Merge to `main` only after the GitHub quality gate passes and the change has been reviewed for scope/risk.
- The merge commit then produces the single authoritative Vercel production deployment.

This policy is enforced in the repository `vercel.json` using `git.deploymentEnabled` with `* = false` and `main = true`.

## Why

Recent feature-branch deployments failed before normal build logs were produced with Vercel reporting `BUILD_FAILED: Resource provisioning failed`, while the same changes deployed successfully after merge to `main`. The repository already has an independent CI build gate, so repeated Preview provisioning is not providing useful code validation and consumes limited deployment resources.

## Working practice

1. Create one feature branch for a coherent change.
2. Keep intermediate commits local where practical; push consolidated work rather than every small edit.
3. Open/update the PR and use the GitHub Actions quality gate as the branch build check.
4. Fix any CI failures on the same branch.
5. Merge once the quality gate is green.
6. Verify the resulting `main` production deployment and smoke-test the affected route/API.
7. Delete stale branches after merge.

## Intentional previews

Automatic previews are disabled. If a preview environment is deliberately reintroduced later, use one dedicated non-production Neon database (or a dedicated Neon preview branch) and bind its `DATABASE_URL` only to Vercel Preview. Do not point preview builds at the production database.

Any re-enabling of automatic previews should first confirm that the Vercel/Neon integration is not trying to provision a fresh database resource for every feature-branch push.
