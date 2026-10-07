#!/bin/sh
set -eu

sed "s|\${MQTT_AUTH_INTERNAL_SECRET}|${MQTT_AUTH_INTERNAL_SECRET}|g" \
  /opt/emqx/etc/emqx.conf.template \
  > /opt/emqx/etc/emqx.conf

exec /opt/emqx/bin/emqx foreground