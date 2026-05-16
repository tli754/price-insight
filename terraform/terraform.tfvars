project_id  = "wd-tools"
region      = "australia-southeast1"

# Fill in before running terraform apply.
# Find this in your GCP_SA_KEY GitHub secret: echo $GCP_SA_KEY | jq -r .client_email
ci_sa_email = "price-insight-ci@wd-tools.iam.gserviceaccount.com"
