#!/bin/sh
# Run before every commit: stamps a fresh build id into index.html (BUILD + ?v= on local scripts/styles)
# so apps installed on phones notice the new version and reload instead of using cached files.
cd "$(dirname "$0")" || exit 1
S=$(date +%s)
sed -i '' -E "s#(shared/[a-z-]+\.(js|css))(\?v=[0-9a-z]+)?#\1?v=$S#g; s#BUILD='[0-9a-z]*'#BUILD='$S'#" index.html
echo "build $S"
