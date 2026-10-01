# ChatGPT 专用固定出口 IP（自建 VPS 代理）

> **这个项目是干嘛的**：在海外 VPS 上自建一个只有你一个人用的代理节点，
> 让 ChatGPT 的所有流量永远从同一个固定 IP 出去，彻底避免"机场节点轮换 → IP 频繁变化 → 触发风控/封号"。
> 其他流量不受影响：外网照常走原有机场，国内照常直连。

**部署状态：✅ 2026-10-01 全部完成并验证通过**（当天踩坑与排查实录见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)）

---

## 一图看懂

```
                    ┌─ chatgpt.com / openai.com 等 ──> 你的 VPS (104.129.181.52, 固定) ──> ChatGPT
你的电脑 (Clash Party)
                    └─ 其他所有流量 ──> 原有机场 / 直连（完全不变）
```

---

## 关键信息卡（换机器/重装时看这里）

| 项目 | 值 |
|---|---|
| 服务器 | 搬瓦工 20G KVM PROMO，$49.99/年（优惠码 `BWH3HYATVBJW` 实付约 $46.7/年） |
| 机房 / IP | 洛杉矶 USCA_2 · **104.129.181.52**（静态，不主动换就永远不变） |
| 系统 | Ubuntu 24.04 LTS |
| 协议 | Xray VLESS + Reality (XTLS Vision)，端口 443 |
| UUID | `b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e` |
| Reality Public Key | `A3LmS90cDeGfw5Qv1oVwax8WQOxXkPhdjJGKB8x7k20` |
| Short ID | `4ea0c2144409a72b` |
| 伪装站 (SNI) | `www.lovelive-anime.jp` ⚠️ 勿用 microsoft/apple/google 系（抗量子TLS会破坏握手） |
| 指纹 | chrome |
| SSH | `ssh vps-chatgpt`（本机已配免密，密钥 `~/.ssh/vps_chatgpt`；密码登录已禁用） |
| 面板 | https://kiwivm.64clouds.com （换IP/重装/迁移都在这） |

**一键导入链接**（v2rayN / Shadowrocket / v2rayNG 通用）：

```
vless://b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e@104.129.181.52:443?encryption=none&security=reality&sni=www.lovelive-anime.jp&fp=chrome&pbk=A3LmS90cDeGfw5Qv1oVwax8WQOxXkPhdjJGKB8x7k20&sid=4ea0c2144409a72b&type=tcp&flow=xtls-rprx-vision#VPS-ChatGPT
```

---

## 客户端配置（本机已配好，此节供新机器使用）

所有可迁移的配置文件都在 **`F:\vps\client\`**，拷走这个文件夹即可在新机器接入。

### 场景 A：新电脑用 Clash Party / Mihomo Party（推荐）

1. 安装 [Clash Party](https://github.com/mihomo-party-org/clash-party/releases)
2. 添加你的机场订阅（照常）
3. **覆写 → 新建 → JavaScript → 导入 `client/clash-party-override.js` → 打开"全局"开关**
   - 效果：机场订阅原样工作，仅 ChatGPT/OpenAI 域名被插到最前规则、走 VPS
   - 手动等价操作（如果不用文件导入）：把 `override/vpschatgpt01.js` 放到数据目录 `override/`，
     并在 `override.yaml` 注册（详见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 问题4）

### 场景 B：新电脑用 v2rayN

复制上面的一键导入链接 → v2rayN「从剪贴板导入」→ 手动把路由规则设为：ChatGPT 域名走代理、其余绕过大陆。

### 场景 C：iPhone / Android

- iOS：Shadowrocket → 剪贴板导入一键链接；建议在配置里仅对 ChatGPT 域名启用该节点
- Android：v2rayNG → 剪贴板导入
- **手机和电脑走同一个 VPS 出口**，所有设备同一 IP，这是风控最舒服的状态

### 验证是否生效

```bash
curl -x http://127.0.0.1:7890 https://chatgpt.com/cdn-cgi/trace | grep ^ip=
# 输出 ip=104.129.181.52 即成功
```

---

## 日常使用纪律（防风控，比技术更重要）

1. **永远同一个出口**：所有设备都走这个 VPS，不要今天 VPS 明天机场
2. **不要共享节点**给别人——多用户同 IP 是高危信号
3. 换 IP 是大事：这个 IP 用住了就别动，VPS 不销毁 IP 永远不变
4. 浏览器语言/时区保持稳定，别和 IP 变化叠加出现

## 维护手册

```bash
ssh vps-chatgpt                 # 登录服务器（唯一入口，密钥制）
systemctl status xray           # 服务状态
journalctl -u xray -f           # 实时日志
systemctl restart xray          # 重启服务
/usr/local/bin/xray version     # 版本
```

**升级 Xray**（配置不受影响）：
```bash
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install && systemctl restart xray
```

**IP 被墙了怎么办**（症状与诊断见 Troubleshooting 问题2）：
KiwiVM → Migrate to another datacenter（免费，保留全部数据，得到新 IP）
→ 把本文件、`client/` 下所有文件里的旧 IP 换成新 IP
→ `~/.ssh/config` 里 `HostName` 也要换

**伪装站失效怎么办**（握手秒失败，见 Troubleshooting 问题3）：
把 `deploy/desttest.sh` 传上服务器跑一遍，它会自动找出当前可用的伪装站并写入配置。

**重装系统**：KiwiVM → Install new OS (Ubuntu 24.04) → 重跑 `bash server-setup.sh` →
换回密钥（重装会清空 authorized_keys，参考 `deploy/install_key.py` 的方式重装一次）→ 更新客户端无需变动（UUID 等会重新生成，需同步 `client/` 文件）

---

## 目录结构

```
F:\vps\
├── README.md                  ← 本文档（项目总览/关键信息/维护手册）
├── docs\
│   └── TROUBLESHOOTING.md     ← 部署踩坑全记录与排查方法论
├── server-setup.sh            ← 服务端一键部署脚本（Ubuntu/Debian/Alma 通用）
├── deploy\
│   ├── install_key.py         ← 用临时密码装SSH密钥的一次性工具
│   └── desttest.sh            ← 伪装站自动筛选脚本（排障神器）
└── client\                    ← ★ 换机器时拷走这个文件夹
    ├── clash-party-override.js  ← Clash Party 全局覆写（机场+ChatGPT分流共存）
    ├── clash-chatgpt.yaml       ← 独立完整配置（无机场时的备选）
    ├── node-info.txt            ← 节点参数卡片
    └── xray\                    ← xray.exe + 测试用客户端配置（应急直连用）
```

## 费用与续费

- 搬瓦工 $49.99/年（约 ¥30/月），年付制，到期前邮件会提醒，KiwiVM/Client Area 可续费
- 也可在 Client Area 设置自动续费（绑定 PayPal）
