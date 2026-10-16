#!/bin/sh
set -eu
python /srv/fetch_models.py
exec "$@"
