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

> ⚠️ **2026-10-26 起临时变更**：VPS IP 被 GFW 封锁（TCP级），已给 VPS-ChatGPT 节点启用
> `dialer-proxy: BoostNet` 链式转发——去 VPS 的流量先经机场出国再连 VPS，**ChatGPT 看到的
> 出口 IP 不变（仍是 VPS）**。迁移换新 IP 后删除 override 里那一行即恢复直连。详见
> [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 当日条目。

---

## 关键信息卡（换机器/重装时看这里）

| 项目 | 值 |
|---|---|
| 服务器 | 搬瓦工 20G KVM PROMO，$49.99/年（优惠码 `BWH3HYATVBJW` 实付约 $46.7/年） |
| 机房 / IP | CA Vancouver (CABC_1) · **104.129.181.52**（2026-10-26 面板确认；原记录洛杉矶 USCA_2。IP 被墙期间经机场链式中转，见文首警示） |
| 系统 | Ubuntu 24.04 LTS |
| 协议 | Xray VLESS + Reality (XTLS Vision)，端口 443 |
| UUID | `b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e` |
| Reality Public Key | `A3LmS90cDeGfw5Qv1oVwax8WQOxXkPhdjJGKB8x7k20` |
| Short ID | `4ea0c2144409a72b` |
| 伪装站 (SNI) | `www.lovelive-anime.jp` ⚠️ 勿用 microsoft/apple/google 系（抗量子TLS会破坏握手） |
| 指纹 | chrome |
| SSH | `ssh vps-chatgpt`（密钥 `~/.ssh/id_rsa`，`~/.ssh/config` 条目 2026-10-26 已建；密码登录已禁用。IP 被墙期间 22 不通，登录走 KiwiVM 面板 Root shell） |
| 面板 | https://kiwivm.64clouds.com （换IP/重装/迁移都在这） |

**一键导入链接**（v2rayN / Shadowrocket / v2rayNG 通用）：

```
vless://b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e@104.129.181.52:443?encryption=none&security=reality&sni=www.lovelive-anime.jp&fp=chrome&pbk=A3LmS90cDeGfw5Qv1oVwax8WQOxXkPhdjJGKB8x7k20&sid=4ea0c2144409a72b&type=tcp&flow=xtls-rprx-vision#VPS-ChatGPT
```

---

## 客户端配置（本机已配好，此节供新机器使用）

所有可迁移的配置文件都在仓库的 **`client\`** 目录，拷走这个文件夹即可在新机器接入。

### 场景 A：新电脑用 Clash Party / Mihomo Party（推荐，完整步骤）

> 前提：机场订阅与这台机器相同（主选择组名 `BoostNet`）。若换别的机场，先在
> Clash Party 里看订阅的代理组名，把 `client/clash-party-override.js` 里
> `"dialer-proxy": "BoostNet"` 的 `BoostNet` 改成那个组名。

1. 安装 [Clash Party](https://github.com/mihomo-party-org/clash-party/releases)
2. 添加你的机场订阅（照常），确认代理页能选中节点、外网能通
3. **覆写 → 新建 → JavaScript → 导入 `client/clash-party-override.js` → 打开"全局"开关**
4. **重启 Clash Party**（覆写改动不热加载，改任何一行都要重启；验证标志：
   `data/work/config.yaml` 修改时间刷新且含 `VPS-ChatGPT`）
   - 手动等价操作（不用文件导入时）：把文件复制到数据目录 `override/vpschatgpt01.js`，
     并在 `override.yaml` 注册条目（格式见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 问题4）
   - 数据目录以 mihomo 进程 `-d` 参数为准：`wmic process where "name='mihomo.exe'" get CommandLine`
5. 跑下面的"验证是否生效"

**这份 override 做了什么**（改配置前先读懂）：

- 注入 `VPS-ChatGPT` 节点（VLESS+Reality，参数见关键信息卡）
- `find-process-mode: always` + `PROCESS-NAME` 规则：`ChatGPT.exe`/`Codex.exe`/`codex.exe`
  的**所有**请求走 VPS（兜住第三方资源）；再加一排 OpenAI 系域名规则兜住非桌面端流量
- 公司内网（`*.cyou-inc.com`、RFC1918 私网、本机回环）规则排在最前 → ChatGPT 内置
  浏览器访问公司内网直连，不会被送出国
- **`"dialer-proxy": "BoostNet"`（2026-10-26 加入）**：去 VPS 的 TCP 先经机场当前选中
  节点出国、再从国外连 VPS。原因：VPS IP 被 GFW 封锁（TCP 级），直连必超时；而 VPS
  本身全球可达。**ChatGPT 看到的出口仍是 VPS 固定 IP**，防风控纪律不破坏。
  KiwiVM 迁移换新 IP 后想恢复直连：删掉这一行重启即可

**被墙期间各配置的可用性**：

| 配置 | 被墙期间 |
|---|---|
| Clash Party + override（场景 A，含 dialer-proxy） | ✅ 正常（本机当前方案） |
| v2rayN / Shadowrocket 直连 VPS（场景 B/C） | ❌ 不通（直连被墙，需自行套前置代理） |
| `clash-chatgpt.yaml`（独立无机场配置） | ❌ 不通（同上；有任意可用代理才能链式中转） |

### 场景 B：新电脑用 v2rayN

复制上面的一键导入链接 → v2rayN「从剪贴板导入」→ 手动把路由规则设为：ChatGPT 域名走代理、其余绕过大陆。

### 场景 C：iPhone / Android

- iOS：Shadowrocket → 剪贴板导入一键链接；建议在配置里仅对 ChatGPT 域名启用该节点
- Android：v2rayNG → 剪贴板导入
- **手机和电脑走同一个 VPS 出口**，所有设备同一 IP，这是风控最舒服的状态

### 场景 D（可选）：Codex CLI 等工具的 7899 本地转发器

这台机器上 Codex 用的不是 7890 而是 `127.0.0.1:7899`——一个 Node 写的小转发器
（`client/proxy-fallback.js`），作用：上游 Clash 不可用时，**ChatGPT/OpenAI 保护域名直接
返回 502、绝不降级直连**（防止 GPT 流量偷偷从本机 IP 出去触发风控），其他域名保留原行为。

新机器部署：

1. 装 Node.js
2. 把 `client/proxy-fallback.js` 复制到 `%USERPROFILE%\.proxy-fallback\proxy-fallback.js`
3. 同目录建 `start-hidden.vbs`（一行）：`createobject("wscript.shell").run "node ""%USERPROFILE%\.proxy-fallback\proxy-fallback.js""",0`
4. 注册开机自启（管理员 PowerShell）：
   `New-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name ProxyFallback -Value 'wscript.exe "%USERPROFILE%\.proxy-fallback\start-hidden.vbs"' -Force`
5. 跑一次 `wscript.exe "%USERPROFILE%\.proxy-fallback\start-hidden.vbs"`，验证
   `curl -x http://127.0.0.1:7899 https://api.openai.com/cdn-cgi/trace | grep ^ip=`
   输出 `ip=104.129.181.52` 即成功（日志在同目录 `proxy-fallback.log`）

### 验证是否生效

```bash
# 1) ChatGPT 出口 = VPS 固定 IP 即成功（被墙期间走链式转发，结果一样是 VPS IP）
curl -x http://127.0.0.1:7890 https://chatgpt.com/cdn-cgi/trace | grep -E '^(ip|colo)='
# 期望: ip=104.129.181.52   （colo=YVR 说明流量确实从 VPS 所在的温哥华机房出去）

# 2) 对照：普通外网仍走机场（不应是 VPS IP）
curl -x http://127.0.0.1:7890 https://www.apple.com -o /dev/null -w '%{http_code}\n'
# 期望: 200，且 Clash 连接页里 apple 走的是 BoostNet 而非 VPS-ChatGPT
```

**失败时的快速分诊**（详细排查链见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)）：

| 症状 | 结论 | 动作 |
|---|---|---|
| trace 超时 + Clash 日志 `dial tcp 104.129.181.52:443 i/o timeout` | dialer-proxy 没生效（VPS 在直连） | 检查 override 里是否删了/没写 `dialer-proxy` 行；确认重启过 Clash Party；确认机场组名一致 |
| trace 超时 + apple 也失败 | 机场这跳挂了 | Clash Party 里换 BoostNet 选中节点 |
| `ip=` 显示别的地址 | 分流规则没命中，流量走了机场 | 确认覆写"全局"开关打开、重启过；查 work/config.yaml 是否含 VPS-ChatGPT 规则 |
| 以上都对但 ChatGPT 应用仍报错 | 应用侧缓存/会话问题 | 重开 ChatGPT 应用；再看 Clash 日志该进程是否命中 `PROCESS-NAME` 规则 |

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

**IP 被墙了怎么办**（症状与诊断见 Troubleshooting）：
1. 应急（分钟级恢复，当前已启用）：override 里给 VPS-ChatGPT 加 `"dialer-proxy": "BoostNet"`，
   经机场出国再连 VPS，ChatGPT 出口 IP 不变
2. 根治：KiwiVM → Migrate to another datacenter（免费，保留全部数据，得到新 IP；后端偶尔报
   "not available, try again in 10-15 minutes" 就过一会再试）
   → 跑 `bash backups/20261026-gfw-migration/update-ip.sh <新IP>` 一键换完本文件、`client/`、
     Clash Party override 里的旧 IP 并更新 `~/.ssh/config`
   → 删除 override 里 `"dialer-proxy"` 那一行 → 重启 Clash Party 恢复直连

**伪装站失效怎么办**（握手秒失败，见 Troubleshooting 问题3）：
把 `deploy/desttest.sh` 传上服务器跑一遍，它会自动找出当前可用的伪装站并写入配置。

**重装系统**：KiwiVM → Install new OS (Ubuntu 24.04) → 重跑 `bash server-setup.sh` →
换回密钥（重装会清空 authorized_keys，用 KiwiVM 面板的 Root shell 把 `~/.ssh/id_rsa.pub` 追加回 `/root/.ssh/authorized_keys`）→ 更新客户端无需变动（UUID 等会重新生成，需同步 `client/` 文件）

---

## 目录结构

```
E:\vps\
├── README.md                  ← 本文档（项目总览/关键信息/维护手册）
├── docs\
│   └── TROUBLESHOOTING.md     ← 部署踩坑全记录与排查方法论
├── server-setup.sh            ← 服务端一键部署脚本（Ubuntu/Debian/Alma 通用）
├── deploy\
│   └── desttest.sh            ← 伪装站自动筛选脚本（排障神器）
├── backups\                   ← 每次大改前的配置备份（按日期建目录）
│   └── 20261026-gfw-migration\  ← 换IP脚本 update-ip.sh + 当日改动前的 .bak
└── client\                    ← ★ 换机器时拷走这个文件夹
    ├── clash-party-override.js  ← Clash Party 全局覆写（机场+ChatGPT分流+被墙期dialer-proxy链式转发）
    ├── clash-chatgpt.yaml       ← 独立完整配置（无机场时的备选；被墙期间不可用）
    ├── proxy-fallback.js        ← 7899 本地转发器源码（场景 D，Codex 用）
    ├── test-routing.cjs         ← 路由规则回归测试（node client/test-routing.cjs）
    └── node-info.txt            ← 节点参数卡片 + 踩坑速查
```

## 费用与续费

- 搬瓦工 $49.99/年（约 ¥30/月），年付制，到期前邮件会提醒，KiwiVM/Client Area 可续费
- 也可在 Client Area 设置自动续费（绑定 PayPal）
