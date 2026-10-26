#!/usr/bin/env bash
# Bygger Motiv för Linux (.deb och AppImage).
# Fungerar på Ubuntu/Debian och i WSL på Windows. Första körningen installerar
# det som saknas och tar 10–20 minuter; efter det går det betydligt fortare.
set -euo pipefail

cd "$(dirname "$0")"
PROJEKT="$(pwd)"

PAKET=(
  build-essential curl wget file pkg-config
  libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev
  libayatana-appindicator3-dev librsvg2-dev
)
SAKNAS=()
for p in "${PAKET[@]}"; do
  dpkg -s "$p" >/dev/null 2>&1 || SAKNAS+=("$p")
done
if [ ${#SAKNAS[@]} -gt 0 ]; then
  echo "==> Installerar systempaket (kräver sudo): ${SAKNAS[*]}"
  sudo apt-get update
  sudo apt-get install -y "${SAKNAS[@]}"
fi

# Rust installeras i ~/.cargo, som inte alltid finns i PATH när skriptet körs via wsl
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
if ! command -v cargo >/dev/null 2>&1; then
  echo "==> Installerar Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
source "$HOME/.cargo/env"

if ! cargo tauri --version >/dev/null 2>&1; then
  echo "==> Installerar Tauri CLI (en gång)..."
  cargo install tauri-cli --version "^2" --locked
fi

# Bygget läggs i Linux-filsystemet: det är många gånger snabbare än /mnt/c
# i WSL och krockar inte med Windows-bygget i src-tauri/target.
export CARGO_TARGET_DIR="$HOME/.cache/motiv-target"
# AppImage-verktyget kräver annars FUSE, som saknas i WSL
export APPIMAGE_EXTRACT_AND_RUN=1

echo "==> Bygger Motiv..."
# Paket från tidigare versioner ska inte följa med
rm -rf "$CARGO_TARGET_DIR/release/bundle"
cd "$PROJEKT/src-tauri"
cargo tauri build --bundles deb appimage

UT="$PROJEKT/dist/linux"
rm -rf "$UT"
mkdir -p "$UT"
cp "$CARGO_TARGET_DIR"/release/bundle/deb/*.deb "$UT"/
cp "$CARGO_TARGET_DIR"/release/bundle/appimage/*.AppImage "$UT"/
echo
echo "Klart! Linux-filerna finns i dist/linux:"
ls -lh "$UT"
