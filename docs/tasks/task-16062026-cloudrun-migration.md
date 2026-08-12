# Task: Add Manual GitHub Action for Terraform Infrastructure Deployment

## 1. Goal

Build the first infrastructure deployment workflow for the Price Insight Cloud Run migration.

The goal is to add a **manual GitHub Actions workflow** that can run Terraform for infrastructure changes.

This workflow should support:

* manual trigger from GitHub Actions
* `plan` action
* `apply` action
* target environment selection
* Terraform state stored in Google Cloud Storage
* Google Cloud authentication using Workload Identity Federation if already available
* safe infrastructure-only deployment process

This task is implementation allowed, but keep the change focused only on infrastructure workflow setup.

## 2. Background

Project:

* Name: Price Insight
* Current deployment: GKE
* Target deployment: Cloud Run
* Infrastructure tool: Terraform
* First migration step: create infrastructure deployment workflow
* App deployment is not part of this task
* DataForSEO competitor search process must remain unchanged
* Shopify sync process must remain unchanged
* No queue changes
* No scheduler changes
* No Cloud Run migration implementation yet

Current decision:

* Add a GitHub Action for infrastructure updates first.
* The workflow should allow Tao to manually run Terraform plan/apply.
* Terraform state should be stored in Google Cloud, preferably a GCS backend.
* Do not delete or modify existing GKE resources.

## 3. Materials

Inspect:

* `.github/workflows`
* `infra`
* existing Terraform files if any
* existing Kubernetes/GKE deployment workflows
* existing GitHub Actions GCP auth setup
* existing project naming, region, environment naming
* existing secrets usage
* existing README or deployment docs if present

Use existing repo conventions first.

If Terraform folders do not exist, create the minimal structure needed for this workflow.

Suggested structure:

```text
infra/
  terraform/
    environments/
      dev/
        backend.tf
        main.tf
        variables.tf
        terraform.tfvars.example
      prod/
        backend.tf
        main.tf
        variables.tf
        terraform.tfvars.example
```

If the repo already has a different infrastructure structure, follow the existing pattern and explain why.

## 4. Boundaries

Allowed:

* Add a new GitHub Actions workflow file
* Add minimal Terraform folder structure if missing
* Add backend config templates
* Add placeholder/minimal Terraform files required for `terraform init`, `validate`, and `plan`
* Add documentation comments or README notes for required secrets and setup
* Use existing GCP auth pattern if already present

Not allowed:

* Do not deploy Cloud Run service yet unless existing Terraform already does this and the workflow only runs plan
* Do not delete GKE resources
* Do not modify Kubernetes manifests
* Do not change app deployment workflow
* Do not change application source code
* Do not modify secrets
* Do not commit real secret values
* Do not run Terraform apply automatically
* Do not add queues, schedulers, Pub/Sub, Cloud Tasks, or Redis
* Do not change DataForSEO process
* Do not change Shopify sync process

Approval required before:

* Running `terraform apply`
* Creating or modifying production infrastructure
* Importing existing GCP resources
* Managing existing GKE resources with Terraform
* Any Cloud Run production cutover
* Any DNS/Cloudflare change

## 5. Implementation Requirements

### 1. GitHub Actions workflow

Create:

```text
.github/workflows/infra-terraform.yml
```

The workflow should:

* use `workflow_dispatch`
* accept input `environment`

    * options: `dev`, `prod`
* accept input `action`

    * options: `plan`, `apply`
* run from:

```text
infra/terraform/environments/${{ inputs.environment }}
```

* run:

```bash
terraform fmt -check -recursive
terraform init
terraform validate
terraform plan -out=tfplan
```

* only run apply when:

```text
inputs.action == 'apply'
```

* upload Terraform plan output as a GitHub artifact
* export a readable plan file using:

```bash
terraform show -no-color tfplan > tfplan.txt
```

### 2. Google Cloud authentication

Prefer existing repo authentication pattern.

If none exists, use Workload Identity Federation with:

```yaml
permissions:
  contents: read
  id-token: write
```

Expected GitHub secrets:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_TERRAFORM_SERVICE_ACCOUNT
```

Do not use JSON service account key unless the repo already uses it and Tao approves.

### 3. Terraform backend

Use GCS backend.

Example backend structure:

```hcl
terraform {
  backend "gcs" {
    bucket = "wd-tools-terraform-state"
    prefix = "price-insight/dev"
  }
}
```

For prod:

```hcl
terraform {
  backend "gcs" {
    bucket = "wd-tools-terraform-state"
    prefix = "price-insight/prod"
  }
}
```

If backend bucket does not exist yet, document the manual bootstrap command instead of creating it automatically.

Example:

```bash
gcloud storage buckets create gs://wd-tools-terraform-state \
  --location=australia-southeast1 \
  --uniform-bucket-level-access
```

### 4. Minimal Terraform files

If Terraform files do not exist, create minimal valid files.

`main.tf` can start with only:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
```

`variables.tf`:

```hcl
variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "australia-southeast1"
}
```

`terraform.tfvars.example`:

```hcl
project_id = "your-gcp-project-id"
region     = "australia-southeast1"
```

Do not commit real production values if they are sensitive.

### 5. Safety controls

The workflow should make production safer by:

* using GitHub Environment protection for `prod`
* requiring manual trigger
* separating infra deployment from app deployment
* running plan before apply
* not applying unless action input is `apply`

Add comments or README notes explaining this.

## 6. Definition of Done

The task is complete when:

* `.github/workflows/infra-terraform.yml` exists
* workflow supports manual `plan` and `apply`
* workflow supports `dev` and `prod`
* Terraform working directory is environment-specific
* Terraform plan is uploaded as an artifact
* readable `tfplan.txt` is generated
* GCS backend config exists or is clearly documented
* required GitHub secrets are documented
* no app deployment logic is added
* no GKE deletion or modification is added
* no DataForSEO/Shopify logic is changed
* validation commands are reported
* any missing setup is clearly listed

## 7. Validation

Before finishing, report:

```bash
terraform fmt -check -recursive
terraform init
terraform validate
terraform plan -out=tfplan
```

Also report whether these were run locally or only prepared for GitHub Actions.

## 8. Final Report

After implementation, provide:

1. Files changed
2. What the workflow does
3. Required GitHub secrets
4. Required GCP setup
5. How Tao can run `plan`
6. How Tao can run `apply`
7. Risks or manual setup still needed
8. Next recommended task

End with:

```text
Waiting for Tao approval before running terraform apply.
```
