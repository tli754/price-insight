# Task: Simplify GitHub Actions Workflows

## 1. Goal

Implement a simpler GitHub Actions structure for the Price Insight monorepo.

The final Actions menu should contain only:

- `Build`
- `Deploy`
- `Infrastructure`

The repository currently contains two application projects:

- frontend
- backend

The new workflows must support:

### Build

- build frontend
- build backend
- build all
- default target: `all`
- when `all` is selected, build frontend and backend in parallel
- tag images with the full Git commit SHA
- never use `latest` for deployment

### Deploy

- deploy frontend
- deploy backend
- deploy all
- default target: `all`
- optional commit SHA input
- when commit SHA is empty, automatically use the latest SHA from the branch selected in `Use workflow from`
- verify the corresponding SHA-tagged image exists
- resolve the image tag to an immutable image digest
- deploy by digest
- deploy backend first
- run backend health checks
- deploy frontend second
- run frontend smoke tests
- stop if backend deployment or validation fails
- support rollback to the previous Cloud Run revision on failed validation

### Infrastructure

Keep the existing Terraform infrastructure workflow separate.

Do not combine application build/deploy with Terraform plan/apply.

### Code review

Code review must not appear as a normal manually runnable workflow in the Actions menu.

Code review should be triggered manually from the Pull Request page, preferably by adding an `ai-review` label.

Do not run code review automatically on:

- pull request creation
- every push
- every commit update

## 2. Background

Project:

- Name: Price Insight
- Repository type: monorepo
- Application projects:
    - frontend
    - backend
- Runtime target:
    - Google Cloud Run
- Container registry:
    - Google Artifact Registry
- Infrastructure:
    - Terraform
- Existing infrastructure workflow:
    - keep it as a separate workflow
- Existing build/deploy workflows may overlap or contain obsolete GKE behavior

Current decisions:

- Use only three visible workflow groups:
    - Build
    - Deploy
    - Infrastructure
- Default Build target is `all`
- Default Deploy target is `all`
- Build frontend and backend in parallel
- Deploy backend before frontend
- Use commit SHA image tags
- Deploy immutable image digests
- Never deploy `latest`
- Deploy input `commit_sha` is optional
- Empty `commit_sha` means use `github.sha` from the selected branch
- Code review is manually triggered from the PR page
- Code review should not clutter the Actions menu
- Infrastructure remains independent from application deployment

The repository previously used GKE. Any obsolete Kubernetes/GKE deployment workflow must not remain active after equivalent Cloud Run deployment behavior is confirmed.

## 3. Materials

Inspect:

- `.github/workflows/`
- existing build workflows
- existing deploy workflows
- existing Terraform workflow
- existing AI/code-review workflows
- frontend Dockerfile and package scripts
- backend Dockerfile and package scripts
- Artifact Registry image naming
- current Cloud Run service names
- current health endpoints
- current GitHub Workload Identity Federation authentication
- current deployment and rollback commands
- monorepo package manager and workspace configuration

Search for:

```text
workflow_dispatch
docker build
docker push
artifact registry
gcloud run deploy
kubectl
gke
latest
github.sha
commit_sha
health
smoke test
rollback
update-traffic
pull_request
issues
labeled
ai-review
codex
copilot
```

Before editing, report:

- current workflow files
- current triggers
- overlapping responsibilities
- obsolete GKE deployment steps
- current image names
- current Cloud Run service names
- current health-check paths
- workflow files that will be replaced, renamed, disabled, or retained

If any required value cannot be confirmed from the repository, stop and report what is missing.

## 4. Boundaries

Allowed:

- inspect existing workflows and scripts
- edit GitHub Actions workflow files
- consolidate duplicate build/deploy workflows
- rename workflows
- add manual workflow inputs
- add concurrency controls
- add run names
- add image existence checks
- add digest resolution
- add Cloud Run deployment and rollback steps
- add a PR-label-triggered code review workflow
- disable or remove obsolete workflow files after confirming replacement coverage
- update workflow documentation

Not allowed:

- do not modify Terraform infrastructure resources
- do not run Terraform apply
- do not change Google Cloud IAM
- do not create or delete Cloud Run services
- do not modify secrets
- do not change DNS or Cloudflare
- do not deploy to production during implementation
- do not modify application source code unless required only for an existing health endpoint and approved separately
- do not delete old workflows until their behavior is fully mapped and replaced
- do not reintroduce GKE deployment
- do not use `latest`
- do not auto-trigger code review on every PR or push
- do not merge automatically
- do not deploy automatically on merge unless explicitly approved later

Approval required before:

- deleting any workflow that still contains unique behavior
- changing production environment protection rules
- changing Workload Identity Federation
- changing Cloud Run service names
- changing Artifact Registry repository names
- changing health endpoint paths
- changing code-review provider or credentials
- adding new third-party GitHub Actions

## 5. Implementation Requirements

### A. Build workflow

Create or consolidate into:

```text
.github/workflows/build.yml
```

Display name:

```text
Build
```

Trigger:

```text
workflow_dispatch
```

Inputs:

```text
target:
  choices:
    - all
    - backend
    - frontend
  default: all
```

Optional:

```text
git_ref
```

Only add `git_ref` if the repository already needs to build something other than the selected workflow branch.

Behavior:

- checkout selected branch/ref
- resolve full commit SHA
- authenticate to Google Cloud using existing WIF
- configure Docker authentication for Artifact Registry
- when target is `all`, run frontend and backend builds in parallel
- when target is `frontend`, run only frontend build
- when target is `backend`, run only backend build
- tag each image with the full commit SHA
- push the SHA-tagged image
- capture and display pushed image digest
- never push or deploy `latest` unless an existing non-deployment process requires it and this is explicitly documented
- produce a useful GitHub Actions summary

Recommended run name:

```text
Build <target> from <branch> @ <short-sha> by <actor>
```

If GitHub cannot show the resolved SHA before execution, use the available dispatch values in `run-name` and print the resolved SHA prominently in the job summary.

Concurrency:

```text
build-<branch-or-ref>
```

Use a safe policy that avoids duplicate builds of the same ref without cancelling unrelated builds.

### B. Deploy workflow

Create or consolidate into:

```text
.github/workflows/deploy.yml
```

Display name:

```text
Deploy
```

Trigger:

```text
workflow_dispatch
```

Inputs:

```text
target:
  choices:
    - all
    - backend
    - frontend
  default: all

commit_sha:
  required: false
  description: Leave empty to deploy the latest commit SHA from the selected workflow branch.
```

Resolve:

```text
DEPLOY_SHA = inputs.commit_sha if provided, otherwise github.sha
```

Validation:

- require a full or valid Git SHA
- verify the requested SHA-tagged image exists in Artifact Registry
- fail before changing Cloud Run if any required image is missing
- resolve each SHA tag to its immutable digest
- deploy using `@sha256:...`, not a mutable tag

Deployment order for `all`:

```text
backend
→ backend health check
→ backend smoke test
→ frontend
→ frontend health/smoke test
```

Do not deploy frontend if backend validation fails.

For individual targets:

- `backend`: deploy and validate backend only
- `frontend`: deploy and validate frontend only

Deployment requirements:

- use existing Google WIF authentication
- use existing Cloud Run services
- deploy only the image field/revision
- do not alter Terraform-owned service shape
- use the correct region
- capture the previous active revision before deployment
- if validation fails, route 100% traffic back to the previous revision
- surface rollback success or failure clearly
- produce a job summary containing:
    - selected target
    - requested SHA
    - deployed digest
    - service revision
    - health-check result
    - rollback result if applicable

Recommended run name:

```text
Deploy <target> from <commit-sha-or-selected-branch> by <actor>
```

Concurrency:

```text
cloud-run-production
```

Use:

```text
cancel-in-progress: false
```

Only one production deployment may run at a time.

### C. Infrastructure workflow

Keep the existing Terraform workflow separate.

Display name should be clear:

```text
Infrastructure
```

or:

```text
Terraform Infrastructure
```

Do not rename it if that would break existing documentation or environment protections without approval.

It should remain responsible for:

- terraform fmt
- terraform validate
- terraform plan
- terraform apply

Do not call Build or Deploy from Infrastructure.

Add or preserve concurrency protection for Terraform state:

```text
terraform-production
```

Use:

```text
cancel-in-progress: false
```

### D. PR-page manual code review

Implement manual code review from the Pull Request page.

Preferred trigger:

```text
pull_request_target:
  types:
    - labeled
```

Run only when the added label is:

```text
ai-review
```

Requirements:

- do not run on PR open
- do not run on synchronize/push
- do not run on every label
- do not appear as a general manual workflow option in the Actions menu
- post the review result to the PR
- remove the `ai-review` label after completion if safe and supported
- allow rerun by adding the label again
- restrict permissions to the minimum required
- treat `pull_request_target` as security-sensitive
- do not execute untrusted PR code with write-capable credentials
- inspect the diff safely
- preserve the existing review provider if one is already configured
- do not add both Codex and Copilot review systems unless their roles are intentionally different

If label removal requires broader permissions or creates security concerns, leave the label in place and document the manual rerun procedure instead.

### E. Workflow cleanup

After the new Build and Deploy workflows are validated:

- identify obsolete build workflows
- identify obsolete deploy workflows
- identify GKE-only workflows
- identify duplicate AI-review workflows
- retain Infrastructure
- remove or disable obsolete files only when replacement behavior is confirmed

Target Actions menu:

```text
All workflows

Build
Deploy
Infrastructure
```

Code review should be triggered from the PR page, not shown as another routine Actions option.

## 6. Edge Cases

Test and handle:

### Build

- target is `all`
- target is `frontend`
- target is `backend`
- one build succeeds and the other fails
- Artifact Registry authentication fails
- image already exists for the SHA
- Dockerfile path is wrong
- monorepo filtered build command fails
- selected branch differs from `main`

### Deploy

- `commit_sha` is empty
- `commit_sha` is provided
- provided SHA is invalid
- backend image exists but frontend image does not
- frontend image exists but backend image does not
- digest resolution fails
- Cloud Run deployment fails
- backend revision starts but health check fails
- frontend revision starts but smoke test fails
- previous revision cannot be resolved
- rollback command fails
- deployment is retried with the same SHA
- two users trigger Deploy simultaneously
- direct deployment accidentally changes Terraform-owned configuration
- selected branch latest SHA has not been built yet

### Code review

- label added to open PR
- unrelated label added
- label added twice
- review fails
- review provider is unavailable
- PR comes from a fork
- PR contains untrusted workflow changes
- workflow attempts to access secrets from untrusted code
- review comment permission is missing

## 7. Validation

Inspect package scripts before selecting commands.

Run the repository's actual validation commands.

At minimum validate:

```text
YAML syntax
GitHub Actions expressions
workflow triggers
workflow_dispatch inputs
job dependency graph
matrix or conditional logic
concurrency settings
Google authentication step
Artifact Registry image paths
Cloud Run service names
region
health-check URLs
rollback commands
PR-label trigger security
```

Use an Actions workflow linter if one already exists in the project.

Do not introduce a new dependency solely for workflow linting without approval.

Provide manual test instructions for:

1. Build all
2. Build backend only
3. Build frontend only
4. Deploy backend by explicit SHA
5. Deploy frontend by explicit SHA
6. Deploy all with empty SHA input
7. Missing image failure
8. Failed smoke test and rollback
9. Add `ai-review` label on a test PR
10. Confirm Infrastructure remains separate

## 8. Definition of Done

The task is complete when:

- Actions menu is reduced to Build, Deploy, and Infrastructure
- Build supports frontend/backend/all
- Build defaults to all
- frontend and backend build in parallel for all
- images are tagged with full commit SHA
- Deploy supports frontend/backend/all
- Deploy defaults to all
- empty commit SHA resolves to the selected branch's latest SHA
- Deploy verifies images exist
- Deploy resolves SHA tags to image digests
- Deploy uses immutable digests
- backend deploys and validates before frontend
- failed validation triggers rollback
- Infrastructure remains separate
- obsolete GKE workflows are disabled or removed after coverage confirmation
- code review is manually triggered from the PR page using `ai-review`
- code review does not run automatically on PR creation or push
- no workflow deploys `latest`
- no production deployment was executed during implementation
- all modified workflow files pass validation
- final report lists:
    - files changed
    - workflows removed/retained
    - permissions required
    - manual test steps
    - remaining risks

Before editing, explain the planned workflow changes and affected files.

After implementation, report the diff and validation results.

Do not merge.

Waiting for Tao approval.
