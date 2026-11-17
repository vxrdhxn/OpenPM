#!/usr/bin/env bash
# Pin app images in a Helm values file to a released version and digests (the release workflow's
# "deploy: vX.Y.Z to production" PR).
#
#   scripts/pin-images.sh VALUES_FILE VERSION < images.txt
#
# images.txt has one "app image digest" line per app, e.g.
#   api ghcr.io/owner/openpm-api sha256:...
#
# yq rewrites the whole file and drops blank lines, which would make every release PR reformat the
# file. So the edit is made on a copy, and only yq's non-blank changes are applied to the original
# (diff -B ignores blank-line differences): comments, blank lines and quoting stay as written.
# Needs yq (mikefarah, v4), diff and patch.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 VALUES_FILE VERSION < images.txt" >&2
  exit 2
fi
FILE=$1
VERSION=$2
TMP=$(mktemp)
trap 'rm -f "$TMP" "$TMP.diff"' EXIT

cp "$FILE" "$TMP"
while read -r app image digest; do
  [ -n "$app" ] || continue
  APP="$app" IMAGE="$image" DIGEST="$digest" VERSION="$VERSION" yq -i '
    .[strenv(APP)].image.repository = strenv(IMAGE) |
    .[strenv(APP)].image.tag = strenv(VERSION) |
    .[strenv(APP)].image.digest = strenv(DIGEST)' "$TMP" < /dev/null  # stdin is images.txt
done

# diff exits 1 when the files differ; only 2 is an error.
status=0
diff -B "$FILE" "$TMP" > "$TMP.diff" || status=$?
[ "$status" -le 1 ] || exit "$status"
if [ -s "$TMP.diff" ]; then
  patch --quiet "$FILE" < "$TMP.diff"
fi
