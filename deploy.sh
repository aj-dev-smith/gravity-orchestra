#!/usr/bin/env bash
# deploy.sh — sync dist/ to S3 and invalidate CloudFront
# Called by `npm run deploy` after the Vite build completes.

set -euo pipefail

BUCKET="s3://cascade.ajsmithhq.com"
DISTRIBUTION_ID="E1U4B3EV2WPMZS"
LIVE_URL="https://cascade.ajsmithhq.com"

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
