#!/bin/sh
# Hardware watchdog (reboot by itself if it hangs) + keep logs across reboots to find why it hung.
# Run once: sudo sh ~/home-server/box-debug.sh   (it reboots the box at the end)
set -e
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }

mkdir -p /etc/systemd/system.conf.d
printf "[Manager]\nRuntimeWatchdogSec=30\nRebootWatchdogSec=2min\n" > /etc/systemd/system.conf.d/watchdog.conf

# Logs on the eMMC for now; set ENABLED=true again once the cause is found
sed -i "s/^ENABLED=true/ENABLED=false/" /etc/default/armbian-ramlog
mkdir -p /etc/systemd/journald.conf.d
printf "[Journal]\nStorage=persistent\nSystemMaxUse=100M\n" > /etc/systemd/journald.conf.d/persistent.conf

echo "Done, rebooting in 5 s..."
sleep 5
reboot
