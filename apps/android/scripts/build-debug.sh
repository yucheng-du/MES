#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
variant="${1:-community}"
case "$variant" in
  community) flavor=Community; extra=(-PwithVendorSdk=false) ;;
  vendor)
    flavor=Vendor; extra=(-PwithVendorSdk=true)
    for sdk in jc-printer-3.2.8.aar jc-image-1.8.7.aar LPAPI-2019-11-20-R.jar; do
      if [[ ! -f "app/libs/$sdk" ]]; then
        echo "Missing optional SDK: app/libs/$sdk. See THIRD-PARTY.md; community needs no vendor SDK." >&2
        exit 1
      fi
    done
    ;;
  *) echo "Usage: $0 [community|vendor]" >&2; exit 1 ;;
esac
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f local.properties ]]; then
  if [[ -d .local/android-sdk/platforms/android-35 ]]; then
    export ANDROID_HOME="$PWD/.local/android-sdk"
  else
    echo "Install Android SDK platform 35/build-tools 35.0.0 and set ANDROID_HOME (see README.md)." >&2
    exit 1
  fi
fi
./gradlew "${extra[@]}" ":app:assemble${flavor}Debug" ":app:test${flavor}DebugUnitTest" ":app:lint${flavor}Debug" --console=plain
echo "APK: $PWD/app/build/outputs/apk/$variant/debug/app-$variant-debug.apk"
