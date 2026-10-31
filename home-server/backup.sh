#!/bin/sh
# Copy Home Assistant backups and the server's secrets off the box, onto this computer.
# Run on the Mac: ./backup.sh user@<ip-box>   (README section 11 for the one-time setup)
set -e
BOX=${1:-${BOX:?usage: ./backup.sh user@<ip-box>}}
DEST=${DEST:-$HOME/home-server-backup}
KEEP=${KEEP:-10}  # newest Home Assistant backups kept here

mkdir -p "$DEST/ha" "$DEST/server"

# The containers write these files as root, so rsync runs with sudo on the box
rsync -a --rsync-path="sudo rsync" "$BOX:home-server/homeassistant/backups/" "$DEST/ha/"

# Everything else Home Assistant's backup doesn't cover: .env, MQTT passwords and ACL, ESPHome YAML
rsync -a --delete --rsync-path="sudo rsync" \
  --exclude homeassistant/ --exclude mosquitto/data/ --exclude esphome/.esphome/ \
  "$BOX:home-server/" "$DEST/server/"

# Drop old copies by count, not age, so nothing is lost if the box stops making backups
ls -t "$DEST/ha"/*.tar 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
  rm -- "$old"
done

echo "Backed up to $DEST:"
ls -lh "$DEST/ha" | tail -n +2
