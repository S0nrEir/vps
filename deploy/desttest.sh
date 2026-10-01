#!/bin/bash
# 逐个候选 dest 自环测试 Reality 握手，找到第一个可用的
set -u
CONF=/usr/local/etc/xray/config.json
ORIG=$(cat $CONF)
PASS_DEST=""

test_dest() {
  local dest_host="$1"
  python3 - "$dest_host" <<'PYEOF'
import json, sys
host = sys.argv[1]
c = json.load(open('/usr/local/etc/xray/config.json'))
r = c['inbounds'][0]['streamSettings']['realitySettings']
r['dest'] = host + ':443'
r['serverNames'] = [host]
json.dump(c, open('/usr/local/etc/xray/config.json','w'), indent=1)
# 同步更新自环客户端的 serverName
s = json.load(open('/tmp/selftest.json'))
s['outbounds'][0]['streamSettings']['realitySettings']['serverName'] = host
json.dump(s, open('/tmp/selftest.json','w'), indent=1)
PYEOF
  systemctl restart xray; sleep 1
  nohup /usr/local/bin/xray run -c /tmp/selftest.json > /tmp/st.log 2>&1 &
  local XPID=$!
  sleep 1.5
  local r=$(timeout 8 curl -s --max-time 6 --socks5-hostname 127.0.0.1:1080 https://api.ipify.org 2>/dev/null)
  kill $XPID 2>/dev/null; wait $XPID 2>/dev/null
  if [ -n "$r" ]; then
    echo "PASS  $dest_host  (出口: $r)"
    return 0
  else
    echo "FAIL  $dest_host"
    return 1
  fi
}

for d in www.lovelive-anime.jp gateway.icloud.com www.samsung.com www.nvidia.com www.amd.com www.php.net www.speedtest.net addons.mozilla.org www.ups.com www.tesla.com; do
  if test_dest "$d"; then PASS_DEST="$d"; echo "$d" > /tmp/best_dest.txt; break; fi
done

if [ -z "$PASS_DEST" ]; then
  echo "ALL_FAILED: 恢复原配置"
  echo "$ORIG" > $CONF
  systemctl restart xray
else
  echo "WINNER: $PASS_DEST （已写入正式配置）"
fi
systemctl is-active xray
