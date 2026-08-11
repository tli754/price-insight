# Task: Fix deploy.yml — rename NUXT_PUBLIC_API_URL to NUXT_API_URL

## Background

The auth Stage 1 implementation (commit dc2e7922) moved the backend API URL from public
runtimeConfig to private runtimeConfig. This required renaming the env var from
`NUXT_PUBLIC_API_URL` to `NUXT_API_URL` in the frontend.

The code change was made in `nuxt.config.ts`:
```ts
apiUrl: process.env.NUXT_API_URL || "http://localhost:4000",
```

However, `.github/workflows/deploy.yml` was not updated. It still reads from the GSM secret
`frontend-nuxt-public-api-url` and injects it as `NUXT_PUBLIC_API_URL` into the k8s secret.

As a result, all Nuxt server proxy routes in production fall back to `http://localhost:4000`
(which does not exist in the pod), making every API call fail silently.

## Required Change

In `.github/workflows/deploy.yml`, update the frontend secrets sync block:

**Line ~107:** Change
```
NUXT_PUBLIC_API_URL=$(gcloud secrets versions access latest --secret="frontend-nuxt-public-api-url" --project="$PROJECT")
```
to:
```
NUXT_API_URL=$(gcloud secrets versions access latest --secret="frontend-nuxt-api-url" --project="$PROJECT")
```

**Line ~114:** Change
```
--from-literal=NUXT_PUBLIC_API_URL="$NUXT_PUBLIC_API_URL" \
```
to:
```
--from-literal=NUXT_API_URL="$NUXT_API_URL" \
```

## GSM Secret

The GSM secret name changes from `frontend-nuxt-public-api-url` to `frontend-nuxt-api-url`.

Tony must create the new GSM secret before deploying:
```bash
# Create the new secret
gcloud secrets create frontend-nuxt-api-url \
  --replication-policy=automatic --project=wd-tools

# Set the value (internal k8s DNS for the backend service)
echo -n "http://backend.price-insight.svc.cluster.local:4000" | \
  gcloud secrets versions add frontend-nuxt-api-url \
  --data-file=- --project=wd-tools
```

## Affected Files

- `.github/workflows/deploy.yml` — rename env var read + k8s secret literal

## No other changes needed

- `nuxt.config.ts` — already correct (`NUXT_API_URL`)
- `k8s/frontend/deployment.yaml` — no API URL reference (it comes via `frontend-secrets`)
- No frontend source code changes

## Validation

After deploy:
- Navigate to `https://www.qweyha520.bar/products` — page should load data
- Check frontend pod logs for no `ECONNREFUSED localhost:4000` errors
