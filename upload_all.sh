#!/usr/bin/env bash
# Upload project to DIDLab IPFS WITHOUT zipping, one file per request.
# Creates a manifest (upload_results.json) mapping relative path -> CID, then uploads the manifest.
# Prints a final "Project index" URL for the manifest on a public IPFS gateway.

set -eE -o pipefail

API="https://api.didlab.org/v1/ipfs/upload"
GATEWAY="https://ipfs.io/ipfs"
PIN=true

# --- Load token from .env if present ---
if [ -f .env ]; then
  echo "Loading token from .env..."
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TOKEN="${token:-}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: DIDLab token not found."
  echo "Add 'token=\"YOUR_JWT_HERE\"' to .env or run: export token=\"YOUR_JWT_HERE\""
  exit 1
fi

# --- Build a null-delimited file list (exclude noisy dirs/files) ---
echo "Collecting files to upload..."
find . \
  -type d \( -name .git -o -name .github -o -name node_modules -o -name artifacts -o -name cache -o -name out -o -name coverage -o -name dist -o -name build -o -name .next \) -prune -o \
  -type f \
  ! -name ".env" \
  ! -name "upload_all.sh" \
  ! -name "upload_results.json" \
  ! -name "resp_batch*.json" \
  ! -name ".filelist0" \
  -print0 > .filelist0

# Count
total=0
while IFS= read -r -d '' _; do total=$((total+1)); done < .filelist0
echo "Found $total files."
(( total == 0 )) && { rm -f .filelist0; exit 0; }

# Prepare output
manifest_tmp=".manifest.$$"
: > "$manifest_tmp"
uploaded_count=0
fail_count=0

# Upload each file individually
while IFS= read -r -d '' f; do
  rel="${f#./}"

  # Skip dotfiles you probably don't want (comment out if you DO want them)
  case "$rel" in
    .*|.vscode/*) echo "Skipping $rel"; continue;;
  esac

  echo "Uploading: $rel"

  # Post single file
  resp=$(curl --http1.1 --fail-with-body -sS -X POST "$API" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@${rel};filename=${rel}" \
    -F "pin=$PIN" ) \
    || {
      echo "  ERROR: upload failed for $rel"
      fail_count=$((fail_count+1))
      continue
    }

  # Extract CID (prefer jq; fallback to grep)
  if command -v jq >/dev/null 2>&1; then
    cid=$(echo "$resp" | jq -r '.cid // empty')
  else
    cid=$(echo "$resp" | sed -n 's/.*"cid"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p')
  fi

  if [[ -z "$cid" ]]; then
    echo "  WARNING: no CID returned for $rel"
    fail_count=$((fail_count+1))
    continue
  fi

  # Append to manifest (newline-delimited "path|cid")
  echo "$rel|$cid" >> "$manifest_tmp"
  uploaded_count=$((uploaded_count+1))

done < .filelist0

# Build JSON manifest from temp list
# Format: { "files": [ { "path": "...", "cid": "..." }, ... ], "count": N }
manifest_json="upload_results.json"
{
  echo '{ "files": ['
  first=1
  while IFS='|' read -r path cid; do
    [[ -z "$path" || -z "$cid" ]] && continue
    if (( first )); then first=0; else echo ','; fi
    printf '  { "path": "%s", "cid": "%s" }' "$(printf '%s' "$path" | sed 's/"/\\"/g')" "$cid"
  done < "$manifest_tmp"
  echo
  printf '], "count": %d }' "$uploaded_count"
} > "$manifest_json"

# Upload manifest
echo "Uploading manifest: $manifest_json"
manifest_resp=$(curl --http1.1 --fail-with-body -sS -X POST "$API" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${manifest_json};filename=${manifest_json}" \
  -F "pin=$PIN" ) || {
    echo "ERROR: failed to upload manifest."
    echo "You can still use local $manifest_json for mapping."
    exit 1
  }

if command -v jq >/dev/null 2>&1; then
  manifest_cid=$(echo "$manifest_resp" | jq -r '.cid // empty')
else
  manifest_cid=$(echo "$manifest_resp" | sed -n 's/.*"cid"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p')
fi

echo
echo "✅ Done. Uploaded: $uploaded_count  Failed: $fail_count"
echo "Manifest CID: ${manifest_cid:-<unknown>}"
[[ -n "$manifest_cid" ]] && echo "Project index: $GATEWAY/$manifest_cid"

# Cleanup
rm -f .filelist0 "$manifest_tmp" 2>/dev/null || true