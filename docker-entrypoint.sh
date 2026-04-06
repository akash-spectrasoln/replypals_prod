#!/bin/sh
set -e
PORT="${PORT:-80}"
export PORT
sed -i "s/__PORT__/${PORT}/g" /etc/nginx/sites-available/default
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
