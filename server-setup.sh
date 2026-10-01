#!/usr/bin/env bash
# 在海外 VPS (Ubuntu / Debian / AlmaLinux 等) 上一键部署 Xray VLESS+Reality
# 用法: bash server-setup.sh [端口]   # 端口默认 443
# 幂等：重复执行会重新生成密钥并覆盖配置
set -euo pipefail

PORT="${1:-443}"
DEST="www.lovelive-anime.jp:443"  # Reality 伪装目标：必须用普通 X25519 站点
SNI="www.lovelive-anime.jp"       # 微软/苹果/谷歌等已启用抗量子TLS(MLKEM)，会导致握手失败，勿用

[[ $EUID -eq 0 ]] || { echo "请用 root 运行"; exit 1; }

echo "==> 安装依赖与官方 Xray-core"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq curl openssl >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q curl openssl >/dev/null 2>&1 || yum install -y -q curl openssl >/dev/null
fi

bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null

echo "==> 生成密钥材料"
UUID="$(/usr/local/bin/xray uuid)"
KEY_OUT="$(/usr/local/bin/xray x25519)"
PRIVATE_KEY="$(echo "$KEY_OUT" | grep -i 'private' | awk '{print $NF}')"
PUBLIC_KEY="$(echo "$KEY_OUT"   | grep -i 'public'  | awk '{print $NF}')"
SHORT_ID="$(openssl rand -hex 8)"
[[ -n "$UUID" && -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" && -n "$SHORT_ID" ]] || { echo "密钥生成失败"; exit 1; }

echo "==> 写入配置 /usr/local/etc/xray/config.json"
mkdir -p /usr/local/etc/xray
cat > /usr/local/etc/xray/config.json <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${PORT},
      "protocol": "vless",
      "settings": {
        "clients": [
          { "id": "${UUID}", "flow": "xtls-rprx-vision" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${DEST}",
          "xver": 0,
          "serverNames": ["${SNI}"],
          "privateKey": "${PRIVATE_KEY}",
          "shortIds": ["${SHORT_ID}"]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
EOF

echo "==> 启动服务"
systemctl enable xray >/dev/null 2>&1
systemctl restart xray
sleep 1
systemctl is-active --quiet xray || { journalctl -u xray -n 20 --no-pager; exit 1; }

# 防火墙放行（仅在 ufw 已启用时）
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}"/tcp >/dev/null
fi

SERVER_IP="$(curl -s4 --max-time 5 https://api.ipify.org || curl -s4 --max-time 5 https://ip.sb)"

VLESS_URL="vless://${UUID}@${SERVER_IP}:${PORT}?encryption=none&security=reality&sni=${SNI}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_ID}&type=tcp&flow=xtls-rprx-vision#VPS-ChatGPT"

cat <<EOF

========================================================
  部署完成！端口 ${PORT}，节点信息如下（妥善保存）

  服务器 IP : ${SERVER_IP}
  端口      : ${PORT}
  UUID      : ${UUID}
  Public Key: ${PUBLIC_KEY}
  Short ID  : ${SHORT_ID}
  SNI       : ${SNI}

  一键导入链接（v2rayN / Shadowrocket / v2rayNG 剪贴板导入）:
  ${VLESS_URL}
========================================================
EOF
