# Runs a temporary pod inside the GKE cluster to test the database connection
# using the credentials already stored in backend-secrets.
#
# Usage: .\scripts\test-db-connection.ps1
# Prerequisites: kubectl must be configured against the cluster.

$Namespace = "price-insight"
$JobName   = "db-connection-test"

Write-Host "Cleaning up any previous test job..."
kubectl delete job $JobName --ignore-not-found -n $Namespace | Out-Null

# Single-quoted here-string — $ signs are NOT expanded by PowerShell,
# so $MYSQL_HOST etc. are passed literally to the container shell.
$yaml = @'
apiVersion: batch/v1
kind: Job
metadata:
  name: db-connection-test
  namespace: price-insight
spec:
  ttlSecondsAfterFinished: 60
  backoffLimit: 0
  template:
    spec:
      serviceAccountName: price-insight-ksa
      restartPolicy: Never
      containers:
        - name: test
          image: mysql:8
          command:
            - sh
            - -c
            - "mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER $MYSQL_DATABASE -e 'SELECT 1 AS connected, NOW() AS db_time;' && echo Connection OK"
          envFrom:
            - secretRef:
                name: backend-secrets
          env:
            - name: MYSQL_PWD
              valueFrom:
                secretKeyRef:
                  name: backend-secrets
                  key: MYSQL_PASSWORD
'@

Write-Host "Creating test job..."
$yaml | kubectl apply -f -

Write-Host "Waiting for test to complete (30s timeout)..."
kubectl wait --for=condition=complete job/$JobName -n $Namespace --timeout=30s
$success = $LASTEXITCODE -eq 0

Write-Host ""
Write-Host "--- Output ---"
kubectl logs -l job-name=$JobName -n $Namespace

if ($success) {
  Write-Host "`nPASSED" -ForegroundColor Green
} else {
  Write-Host "`nFAILED" -ForegroundColor Red
  exit 1
}
