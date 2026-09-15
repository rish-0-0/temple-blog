#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

: "${STRAPI_API_URL:=https://cms.sibani-panigrahy.com}"

if [[ -z "${STRAPI_API_TOKEN:-}" ]]; then
  echo "STRAPI_API_TOKEN is not set. Add it as an environment secret to fetch posts from Strapi." >&2
  exit 1
fi

cat > .env <<EOF
STRAPI_API_URL=${STRAPI_API_URL}
STRAPI_API_TOKEN=${STRAPI_API_TOKEN}
EOF
