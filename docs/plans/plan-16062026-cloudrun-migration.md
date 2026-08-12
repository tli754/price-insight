# Plan: Add Manual GitHub Action for Terraform Infrastructure Deployment

## 1. Summary

Add a manually-triggered GitHub Actions workflow (`infra-terraform.yml`) that runs Terraform `plan` or `apply` against `infra/terraform/environments/prod/`. The workflow authenticates via the existing Workload Identity Federation pool, stores state in a GCS bucket, and uses a GitHub Environment for `prod` to enable reviewer protection. Minimal Terraform scaffolding (`backend.tf`, `main.tf`, `variables.tf`) is created under `infra/terraform/environments/prod/`. No Cloud Run resources are provisioned yet — this task is infrastructure tooling only.

**Status: committed** — `de5af39` on `feature/cloud-run`.

## 2. Current Implementation

No `infra/` directory existed. No Terraform tooling or workflow existed.

Existing CI patterns followed (from `build.yml` and `deploy.yml`):
- GCP auth via `google-github-actions/auth@v2` + Workload Identity Federation
- WIF provider hardcoded: `projects/920312412888/locations/global/workloadIdentityPools/github-actions/providers/github`
- Existing SA: `price-insight-ci@wd-tools.iam.gserviceaccount.com` (used for builds/deploys)
- Region: `australia-southeast1`, project: `wd-tools`

Files created and committed:
- `.github/workflows/infra-terraform.yml`
- `infra/terraform/environments/prod/backend.tf`
- `infra/terraform/environments/prod/main.tf`
- `infra/terraform/environments/prod/variables.tf`
- `infra/terraform/environments/prod/terraform.tfvars.example`

Note: `dev` environment was dropped — the existing GKE setup has a single production environment, so a separate dev Terraform environment would have added unnecessary complexity.

## 3. Affected Areas

- Frontend: No
- Backend: No
- Database: No
- Queue/jobs: No
- External APIs: No
- Tests: No — Terraform HCL has no automated unit tests at this stage
- Config/infra: Yes — new workflow + Terraform scaffolding; requires GCP setup and GitHub secrets

## 4. Risks

- **Missing GitHub secrets**: Workflow will fail immediately if `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_TERRAFORM_SERVICE_ACCOUNT` are not set on the repo or `prod` Environment.
- **Missing GCS state bucket**: `terraform init` will fail if `wd-tools-terraform-state` does not exist. Must be bootstrapped manually before the first run.
- **Terraform SA permissions**: The SA used for Terraform needs broader GCP permissions than the app CI SA. Under-permissioned SA will fail at plan/apply time.
- **WIF binding missing for new SA**: If a new Terraform SA is created, a WIF IAM binding must be added or auth will fail.
- **Accidental `apply` on prod**: GitHub Environment protection with required reviewers must be configured to prevent unreviewed applies.
- **No GCS state locking**: GCS backend has no native state lock. Concurrent manual triggers could corrupt state — mitigate by keeping workflow manual-only.

## 5. Recommended Approach

Summary:
- Files committed. Complete the required GCP and GitHub setup before running the workflow for the first time.

Likely files (already committed):
- `.github/workflows/infra-terraform.yml` — workflow
- `infra/terraform/environments/prod/` — scaffolding

Why this approach:
- Uses the existing WIF pool — no new authentication infrastructure needed.
- `plan` is always run; `apply` is gated behind the action input and the GitHub Environment protection.
- Single `prod` directory matches the existing single-environment GKE setup.
- Minimal `main.tf` passes `terraform validate` immediately with no resources defined yet.

Avoid:
- Do not use a JSON service account key — WIF is already in place.
- Do not automate `apply` on push — must remain manual.
- Do not add Cloud Run or other GCP resources to `main.tf` until a working `plan` run is confirmed.
- Do not delete or modify existing GKE manifests or `deploy.yml`.

## 6. Approval Needed

Tao approval is required before:

- Running `terraform init` / `plan` / `apply` (requires GCS bucket + SA setup first)
- Creating a dedicated Terraform service account in GCP
- Granting the Terraform SA IAM roles beyond storage object access
- Adding required reviewer protection to the `prod` GitHub Environment
- Adding any GCP resource definitions to `main.tf` (e.g., Cloud Run service)

## 7. Test Plan

Automated tests:
- None at this stage — Terraform HCL is scaffold-only with no resources.

Edge case tests (manual):
- Run with `action: plan` — should succeed with empty plan (no resources defined).
- Trigger with missing secrets — should fail at auth step with a clear error.
- Trigger `apply` on `prod` without reviewer approval — should be blocked by Environment protection.
- Confirm plan artifact (`tfplan.txt`) is downloadable from GitHub Actions after a run.

Regression checks:
- Confirm `build.yml` and `deploy.yml` are unchanged.
- Confirm no GKE manifests under `k8s/` are modified.

## 8. Validation Commands

Run after GCS bucket and SA are set up:

```bash
# Format check (local, if Terraform installed)
terraform -chdir=infra/terraform/environments/prod fmt -check -recursive

# Init against real GCS backend
terraform -chdir=infra/terraform/environments/prod init

# Validate config
terraform -chdir=infra/terraform/environments/prod validate

# Plan (no-op expected — no resources defined yet)
terraform -chdir=infra/terraform/environments/prod plan \
  -var="project_id=wd-tools"
```

Do not run `apply` until Tao has reviewed the plan output.

## 9. Required GCP Bootstrap (one-time manual setup)

```bash
# 1. Create GCS state bucket
gcloud storage buckets create gs://wd-tools-terraform-state \
  --location=australia-southeast1 \
  --uniform-bucket-level-access \
  --project=wd-tools

# 2. Create Terraform service account
gcloud iam service-accounts create terraform \
  --display-name="Terraform CI" \
  --project=wd-tools

# 3. Grant SA access to the state bucket
gcloud storage buckets add-iam-policy-binding gs://wd-tools-terraform-state \
  --member="serviceAccount:terraform@wd-tools.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# 4. Allow WIF pool to impersonate the Terraform SA
#    (replace YOUR_ORG with the GitHub org name)
gcloud iam service-accounts add-iam-policy-binding \
  terraform@wd-tools.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/920312412888/locations/global/workloadIdentityPools/github-actions/attribute.repository/YOUR_ORG/price-insight"
```

## 10. Required GitHub Setup

| Item | Value |
|------|-------|
| Secret `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/920312412888/locations/global/workloadIdentityPools/github-actions/providers/github` |
| Secret `GCP_TERRAFORM_SERVICE_ACCOUNT` | `terraform@wd-tools.iam.gserviceaccount.com` |
| GitHub Environment `prod` | Create in Settings → Environments — add required reviewers |

Secrets can be set at repo level or scoped to the `prod` Environment.

## 11. Next Implementation Prompt (after first `plan` run succeeds)

```markdown
# Task: Add Cloud Run service resource to Terraform prod environment

## Goal
Add a google_cloud_run_v2_service resource to infra/terraform/environments/prod/main.tf
so terraform plan shows the intended Cloud Run service, ready for apply.

## Scope
- Add Cloud Run resource + required variables to prod/main.tf
- Do NOT add Cloud SQL, Redis, or Secret Manager bindings yet (follow-up task)
- Do NOT run apply without Tao approval

## Boundaries
- Do not modify deploy.yml, build.yml, or k8s/ manifests
- Do not change application source code

## Expected Changes
- infra/terraform/environments/prod/main.tf
- infra/terraform/environments/prod/variables.tf
- infra/terraform/environments/prod/terraform.tfvars.example

## Definition of Done
- terraform validate passes
- terraform plan shows the Cloud Run service with no errors
- No existing GKE/app deployment files are modified
```

## 12. Complexity

**Small** — no application code, no DB migrations, no queue changes. Pure infrastructure scaffolding and CI workflow. The main remaining work is the one-time GCP setup (bucket, SA, WIF binding) which is manual.

## 13. Implementation Notes

- `dev` environment dropped after review — project has a single production GKE environment, so a separate Terraform dev environment would add unnecessary complexity.
- Committed `de5af39` on branch `feature/cloud-run`.
- Workflow uses `action` input only (`plan`/`apply`) — no environment selector needed.

## 14. Final Status

Committed. Waiting for Tao to complete GCP bootstrap before running the workflow.
