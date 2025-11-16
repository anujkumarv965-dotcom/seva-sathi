#!/usr/bin/env sh
# Minimal gradlew helper - fallback to system gradle
if [ -f "./gradlew" ] && [ "$0" != "./gradlew" ]; then
  exec ./gradlew "$@"
else
  exec gradle "$@"
fi￼Enter
