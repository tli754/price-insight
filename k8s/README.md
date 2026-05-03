# GKE Deployment — Quick Start

Secrets are stored in Google Secret Manager. The CI/CD pipeline reads them and injects them as K8s secrets on every deploy.

---

## 1. Create the GKE cluster

```bash
gcloud container clusters create price-insight \
  --zone australia-southeast1-a \
  --num-nodes 2 \
  --machine-type e2-standard-2 \
  --project YOUR_PROJECT_ID

gcloud container clusters get-credentials price-insight \
  --zone australia-southeast1-a \
  --project YOUR_PROJECT_ID
```

---

## 2. Store your secrets in Google Secret Manager

Run once to create all secrets (then set the values in GCP Console or via the second command):

```bash
PROJECT=YOUR_PROJECT_ID

for name in \
  price-insight-database-url \
  price-insight-mysql-host \
  price-insight-mysql-user \
  price-insight-mysql-password \
  price-insight-mysql-database \
  price-insight-openai-api-key \
  price-insight-openai-model \
  price-insight-jina-api-key \
  price-insight-serpapi-api-key \
  price-insight-nuxt-session-password \
  price-insight-nuxt-oauth-google-client-id \
  price-insight-nuxt-oauth-google-client-secret \
  price-insight-nuxt-public-api-url; do
  gcloud secrets create "$name" --replication-policy=automatic --project="$PROJECT"
done

# Set a value (repeat for each secret)
echo -n "YOUR_VALUE" | gcloud secrets versions add price-insight-openai-api-key \
  --data-file=- --project="$PROJECT"
```

Key values to note:
- `price-insight-mysql-host` → `127.0.0.1` (Cloud SQL Auth Proxy runs as a sidecar)
- `price-insight-nuxt-public-api-url` → e.g. `https://yourdomain.com/api`
- `price-insight-nuxt-session-password` → any random 32+ character string

---

## 3. Create a GCP service account for CI/CD

```bash
PROJECT=YOUR_PROJECT_ID

gcloud iam service-accounts create price-insight-ci \
  --display-name="Price Insight CI/CD" \
  --project="$PROJECT"

# Grant permissions
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:price-insight-ci@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/container.developer"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:price-insight-ci@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Download the key — add this JSON as the GCP_SA_KEY GitHub secret
gcloud iam service-accounts keys create key.json \
  --iam-account="price-insight-ci@${PROJECT}.iam.gserviceaccount.com"
```

---

## 4. Create a GCP service account for Cloud SQL Auth Proxy

```bash
PROJECT=YOUR_PROJECT_ID

gcloud iam service-accounts create price-insight-backend \
  --display-name="Price Insight Backend" \
  --project="$PROJECT"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:price-insight-backend@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Enable Workload Identity on the cluster
gcloud container clusters update price-insight \
  --zone australia-southeast1-a \
  --workload-pool="${PROJECT}.svc.id.goog"

# Bind the K8s service account to the GCP service account
gcloud iam service-accounts add-iam-policy-binding \
  "price-insight-backend@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT}.svc.id.goog[price-insight/price-insight-ksa]"
```

---

## 5. Update placeholders in k8s/

| Placeholder | File | Value |
|---|---|---|
| `OWNER` | `backend/deployment.yaml`, `frontend/deployment.yaml`, `backend/migration-job.yaml` | Your GitHub username/org |
| `REPLACE_WITH_CONNECTION_NAME` | `backend/deployment.yaml`, `backend/migration-job.yaml` | `PROJECT:REGION:INSTANCE` |
| `GCP_SA_NAME@PROJECT_ID` | `backend/service-account.yaml` | `price-insight-backend@YOUR_PROJECT.iam.gserviceaccount.com` |
| `REPLACE_WITH_YOUR_DOMAIN` | `backend/deployment.yaml`, `frontend/deployment.yaml`, `ingress.yaml` | Your domain or Ingress IP |

---

## 6. Set GitHub Actions secrets

| Secret | Value |
|---|---|
| `GCP_SA_KEY` | Contents of `key.json` from step 3 |
| `GKE_CLUSTER_NAME` | `price-insight` |
| `GKE_CLUSTER_ZONE` | `australia-southeast1-a` |
| `GKE_PROJECT_ID` | Your GCP project ID |

---

## 7. Bootstrap the cluster (first time only)

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/backend/service-account.yaml
kubectl apply -f k8s/ --recursive
```

Then push to `master` — GitHub Actions will build the images, sync secrets from GSM, run migrations, and deploy.

Check status:
```bash
kubectl get pods -n price-insight
kubectl get ingress price-insight -n price-insight  # get the external IP
```

---

## Architecture

```
Internet → GCE Load Balancer (Ingress)
             ├── /api → backend (port 4000)
             │           ├── Fastify container
             │           └── cloud-sql-proxy sidecar → Cloud SQL MySQL
             └── /    → frontend (port 3000, Nuxt SSR)

backend → redis (in-cluster, port 6379)

GitHub Actions → reads GSM secrets → kubectl create secret (on every deploy)
```
