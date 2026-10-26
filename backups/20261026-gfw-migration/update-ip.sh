#!/bin/bash
# 用法: bash update-ip.sh <新IP>
# 作用: 把所有配置文件里的旧 VPS IP (104.129.181.52) 批量替换为新 IP
# 备份在 E:\vps\backups\20261026-gfw-migration\ 下, 出问题可回滚
set -e
NEW_IP="${1:?用法: bash update-ip.sh <新IP>}"
OLD_IP="104.129.181.52"

FILES=(
  "/e/vps/README.md"
  "/e/vps/client/clash-party-override.js"
  "/e/vps/client/clash-chatgpt.yaml"
  "/e/vps/client/node-info.txt"
  "/e/clash party/data/override/vpschatgpt01.js"
  "/e/clash party/data/work/config.yaml"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    n=$(grep -c "$OLD_IP" "$f" || true)
    if [ "$n" -gt 0 ]; then
      sed -i "s/${OLD_IP}/${NEW_IP}/g" "$f"
      echo "已替换 $f ($n 处)"
    else
      echo "跳过(无旧IP) $f"
    fi
  else
    echo "警告: 文件不存在 $f"
  fi
done

# 生成 ~/.ssh/config 条目(保留已有内容, 避免重复追加)
SSH_CFG="$HOME/.ssh/config"
touch "$SSH_CFG"
if ! grep -q "Host vps-chatgpt" "$SSH_CFG"; then
  cat >> "$SSH_CFG" <<EOF

Host vps-chatgpt
    HostName ${NEW_IP}
    User root
    IdentityFile ~/.ssh/id_rsa
    ServerAliveInterval 30
EOF
  echo "已追加 ssh vps-chatgpt 配置 (HostName=${NEW_IP}, 密钥 id_rsa)"
else
  sed -i "/Host vps-chatgpt/,/ServerAliveInterval/{s/HostName .*/HostName ${NEW_IP}/}" "$SSH_CFG"
  echo "已更新 ssh vps-chatgpt 的 HostName"
fi

echo "完成。剩余含旧IP的引用(应只剩历史文档):"
grep -rl "$OLD_IP" /e/vps 2>/dev/null | grep -v backups || echo "(无)"
