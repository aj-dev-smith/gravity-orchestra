#!/usr/bin/env bash
# deploy.sh — sync dist/ to S3 and invalidate CloudFront
# Called by `npm run deploy` after the Vite build completes.

set -euo pipefail

# Where to deploy comes from the environment (or a git-ignored .env.deploy — see
# .env.deploy.example), so a fork never points at someone else's bucket.
[[ -f .env.deploy ]] && source .env.deploy
: "${DEPLOY_BUCKET:?set DEPLOY_BUCKET (e.g. s3://my-bucket) — see .env.deploy.example}"
: "${CLOUDFRONT_DISTRIBUTION_ID:?set CLOUDFRONT_DISTRIBUTION_ID — see .env.deploy.example}"
BUCKET="${DEPLOY_BUCKET}"
DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID}"
LIVE_URL="${LIVE_URL:-https://${BUCKET#s3://}}"

# Verify the build output exists and is non-empty
if [[ ! -d dist ]] || [[ -z "$(ls -A dist)" ]]; then
  echo "Error: dist/ not found or empty. Run \`npm run build\` first." >&2
  exit 1
fi

echo "Deploying to ${BUCKET}..."

# 1. Sync everything except index.html with a long-lived cache (content-hashed assets are immutable)
aws s3 sync dist/ "${BUCKET}" \
  --delete \
  --exclude "index.html" \
  --cache-control "max-age=31536000,immutable"

# 2. Upload index.html separately — never cached so users always get the latest entry point
aws s3 cp dist/index.html "${BUCKET}/index.html" \
  --cache-control "no-cache" \
  --content-type "text/html; charset=utf-8"

# 3. Invalidate CloudFront so the fresh index.html propagates immediately
echo "Invalidating CloudFront distribution ${DISTRIBUTION_ID}..."
aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*"

echo "Done. Live at ${LIVE_URL}"
