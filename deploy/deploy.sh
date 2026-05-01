#!/bin/sh
# /srv/x402/deploy.sh on the host. chmod 700, owned by root.
#
# Pinned target of the GitHub-Actions deploy SSH key. The authorized_keys
# entry uses `command="/srv/x402/deploy.sh",restrict` so the key can ONLY
# run this script — no shell, no port forward, no other commands.

set -eu
cd /srv/x402
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
