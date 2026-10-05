#!/bin/sh
# Build and publish dist/ to the gh-pages branch of this repo's origin.
set -e
cd "$(dirname "$0")/.."
npm run build
remote=$(git remote get-url origin)
cd dist
touch .nojekyll
git init -q -b gh-pages
git add -A
git commit -qm "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -qf "$remote" gh-pages
rm -rf .git
echo "Deployed to gh-pages"
