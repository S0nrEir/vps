# ChatGPT 专用 VPS 固定出口

让进入本机代理并命中规则的 ChatGPT/OpenAI 请求，经机场跳板连接 VPS，再从 VPS 出口访问目标。
普通上网继续使用订阅分流，公司内网和私网优先直连。固定出口用于保持路由一致，不保证账号免于风控；
未进入代理的流量也不受这些规则约束。

**2026-11-11 已验证赔钱机场链路恢复**：

```text
本机 Clash Party
  ├─ GPT 规则 / 专用入口 → 赔钱机场 AWS日本01（VPS-Hop）→ VPS:8443 → ChatGPT
  └─ 普通请求 → 原订阅规则（机场 / 直连）
```

实际服务端为 **8443=Reality，443=HTTPUpgrade**。修复包括同步安装覆写的新公钥和跳板，
并增加 `reality-opts.support-x25519mlkem768: true`。
正式入口连续 5 次 trace 均返回 `104.129.181.52`；SSH 直连 22 也已恢复。
先前“机场随机篡改/反二级代理”的归因已撤回，详见
[本次故障、解决办法与验证证据](docs/2026-11-11-PEIQIAN-DIAGNOSIS.md)。
[历史排障记录](docs/TROUBLESHOOTING.md) 保留当时现象，不代表当前端口和可达性。

## 当前参数（2026-11-11 实机复核）

| 项目 | 值 |
|---|---|
| VPS | 搬瓦工，Ubuntu 24.04 LTS，Xray 26.11.9 |
| IP / 机房 | **104.129.181.52**；CA Vancouver CABC_1（2026-10-26 面板记录） |
| 主用入站 | VLESS + Reality + XTLS Vision，TCP **8443** |
| 备用入站 | VLESS + HTTPUpgrade，443，path `/hub7q`，Host `www.bing.com`，无 TLS、无 flow |
| UUID | `b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e` |
| Reality Public Key | `IOied7moBaXTYvJ2DsNH8FpBtqgy_zfmX1BAaZ_-AxE` |
| Short ID | `4ea0c2144409a72b` |
| SNI / dest | `www.lovelive-anime.jp` / `www.lovelive-anime.jp:443` |
| 本机客户端 | Mihomo 1.19.32；`client-fingerprint: chrome`；`reality-opts.support-x25519mlkem768: true` |
| 当前跳板 | 赔钱机场 `🇯🇵AWS日本01 \| 电信移动联通推荐`，由 `VPS-Hop` 选择 |
| SSH | `ssh vps-chatgpt`，直连 22；本机密钥 `~/.ssh/vps_chatgpt` |
| 服务端配置 | `/usr/local/etc/xray/config.json`，服务用户 `xray` |
| 面板 | [KiwiVM](https://kiwivm.64clouds.com) |

不能用 Reality 配置连接当前 443 入站。SNI 以实际服务器配置为准，不按网站所属公司判断兼容性。
ML-KEM 开关是本次 Xray/Mihomo 组合实测需要的参数，见
[Mihomo 官方说明](https://wiki.metacubex.one/config/proxies/tls/#reality-optssupport-x25519mlkem768)。

VLESS 导入链接：

```text
vless://b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e@104.129.181.52:8443?encryption=none&security=reality&sni=www.lovelive-anime.jp&fp=chrome&pbk=IOied7moBaXTYvJ2DsNH8FpBtqgy_zfmX1BAaZ_-AxE&sid=4ea0c2144409a72b&type=tcp&flow=xtls-rprx-vision#VPS-ChatGPT
```

链接不包含机场跳板，也不能保证导入器设置 ML-KEM 开关。Mihomo 推荐直接使用仓库覆写。
本次未验证 v2rayN、Shadowrocket、v2rayNG 或移动端；使用时需核对内核兼容性与前置代理。

## Clash Party 配置

1. 添加机场订阅并确认普通外网可用。本次目标订阅是**赔钱机场**。
2. 覆写 → 新建 → JavaScript → 导入 [client/clash-party-override.js](client/clash-party-override.js)，打开“全局”。
3. 触发配置重新生成：本次通过界面切换订阅、切换覆写开关生效。外部改磁盘文件不等于运行配置已更新；
   如未更新，再重启对应内核或客户端。
4. 在 `VPS-Hop` 选择已测试的跳板，并核对运行配置中的 8443、新公钥、ML-KEM 和 `dialer-proxy: VPS-Hop`。
5. 用下节命令验证新连接的出口。旧连接可能沿用启用覆写前的路由，需要关闭对应连接或重开应用。

本机安装副本为 `E:/clash party/data/override/vpschatgpt01.js`，运行配置为
`E:/clash party/data/work/config.yaml`。仓库文件修改后要同步安装副本；改运行配置本身不能替代持久覆写。

数据目录与控制管道以实际 Mihomo 命令行为准：

```powershell
Get-CimInstance Win32_Process -Filter "Name='mihomo.exe'" | Select-Object ProcessId, CommandLine
```

覆写提供以下行为：

- 内网域名 `*.cyou-inc.com`、私网和回环规则最先匹配。
- 之后匹配 `ChatGPT.exe`、`Codex.exe`、`codex.exe` 进程及 OpenAI 系域名，送入 `VPS-ChatGPT`。
  进程规则只作用于进入 Mihomo 且能识别进程的请求；TUN/防火墙未强制拦截应用自行直连。
- `VPS-ChatGPT` 经 `VPS-Hop` 拨号。成员按订阅名称筛选，候选不等于全部已验证。
  选择独立节点时不随普通上网主组切换；若选择了兜底主组或自动选择组，则仍受该组选择影响。
  无候选且无主组时 `DIRECT` 表示**直连 VPS**，不表示直接访问 ChatGPT。
- `127.0.0.1:17899` 是固定指向 VPS 的专用 mixed 入口；普通入口 7890 按规则分流。
  没有配置 VPS 故障后自动改用机场出口的回退。

换机器需另行配置机场订阅、SSH 密钥授权和兼容内核，不能只复制 `client/` 就视为部署完成。

| 配置 | 本轮验证范围 |
|---|---|
| Clash Party + 赔钱机场 + 全局覆写 | 已验证正式链路及 7890/17899 出口 |
| [独立 YAML](client/clash-chatgpt.yaml) | 已同步 VPS 参数；没有机场前置，直连路径本轮未验证 |
| [BoostNet 链式配置](client/boostnet-chain/config.yaml) | 仅同步 VPS 参数；本轮未验证 BoostNet |
| 其他客户端 / 手机 | 需单独验证导入参数、前置代理与最终出口 |

### 可选的 7899 转发器

[client/proxy-fallback.js](client/proxy-fallback.js) 是历史部署使用的本地转发器。
上游 Clash 不可用时，受保护的 ChatGPT/OpenAI 域名返回 502，不回退直连；其他域名保留其原有行为。
它依赖域名识别，不能把未知域名自动认作 Codex 流量。

需要时用 Node.js 运行该脚本，并让目标工具显式使用 `http://127.0.0.1:7899`，验证后再配置自启动。
本轮未重新验证 7899 监听，不能据旧记录认定当前 Codex 一定使用它；
本次看到的 Codex 连接由 Mihomo 进程规则送往 VPS。

### concept-generator 专用入口

覆写中的 `concept-generator-vps` 监听 `127.0.0.1:17899`，固定 `proxy: VPS-ChatGPT`，
复用 `VPS-Hop`。进入此端口的请求和附件下载都使用 VPS 出口，节点故障时请求失败。

工具部署与完整流程测试见 [2026-11-03 验证记录](docs/CONCEPT-GENERATOR-ROUTING-VERIFICATION.md)。
本轮复测了 17899 的 OpenAI trace；没有重跑完整生成或私有附件下载流程。

## 验证与快速分诊

Windows PowerShell 使用 `curl.exe`，清空 NO_PROXY 绕过列表，并显式指定代理：

```powershell
curl.exe --max-time 30 --noproxy "" --proxy http://127.0.0.1:7890 https://chatgpt.com/cdn-cgi/trace
curl.exe --max-time 30 --noproxy "" --proxy http://127.0.0.1:17899 https://api.openai.com/cdn-cgi/trace
curl.exe --max-time 30 --noproxy "" --proxy http://127.0.0.1:7890 https://www.cloudflare.com/cdn-cgi/trace
node client/test-routing.cjs
```

前两项应为 `ip=104.129.181.52`，本轮 `colo=YVR`；第三项按订阅普通分流，本轮为机场出口。
`colo` 是 Cloudflare 接入点，不能单独证明 VPS 物理机房。trace 成功证明该请求链路可用，
不等于所有应用功能、登录会话和 UDP 都已通过测试。

| 症状 | 下一步 |
|---|---|
| `REALITY authentication failed` | 分清外层机场与内层 VPS 握手；核对实际入站、端口、公钥、short-id、SNI、指纹和 ML-KEM |
| CONNECT 200 后超时 / delay API 503 | 只说明后续测试失败；继续查机场出网、VPS 端口、认证、目标响应，不能直接归因机场 |
| GPT 和普通外网都失败 | 检查本地代理是否运行、订阅和跳板是否可用、DNS 与网络 |
| trace 出口不是 VPS | 核对规则模式、实际运行配置、专用入口及旧连接；确认没有 NO_PROXY 绕过 |
| trace 正常但应用仍失败 | 对照该进程连接和具体请求错误，再检查应用会话、目标响应；不能只凭 trace 判为缓存问题 |

## 维护与重装

```bash
ssh vps-chatgpt
systemctl status xray
ss -lntp
journalctl -u xray -n 50 --no-pager
/usr/local/bin/xray version
```

服务 active 不能证明配置已加载；结合监听端口、进程启动时间、配置修改时间和端到端验证判断。
更新 Xray 前备份配置及原内核，核对兼容性；升级后校验配置、重启服务并复测远端客户端。

重装后的 SSH 主机指纹会变。先在可信的已登录 VPS 控制台运行
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 核对，再更新 known_hosts；
不要直接关闭主机验证。公钥登录失败时检查本机实际使用的密钥、authorized_keys 完整性及权限。
KiwiVM basic shell 每次提交一条命令，多行粘贴可能被拼接。优先恢复 SSH 后传输文件。

[server-setup.sh](server-setup.sh) 是**覆盖式初始化脚本，不是幂等修复工具**。
默认端口仍为 443；若在新系统建立本项目的 Reality 入口，应显式执行 `bash server-setup.sh 8443`。
它会生成新 UUID、密钥对和 short-id，覆盖现有配置；只生成单个 Reality 入站，
不会恢复当前双入站、SSH 加固、服务用户设置或 SMTP 防火墙。服务用户以安装器及实际 unit 为准。
使用前先备份，重装步骤还需参考[历史安全事件与加固记录](docs/TROUBLESHOOTING.md)。

新参数至少同步到 README、node-info、覆写母本与安装副本、独立 YAML，以及使用中的 BoostNet 配置。
服务器私钥和机场订阅凭据只放在受控备份中，不提交仓库。
完成配置校验和监听检查后，还要从实际机场路径验证 ChatGPT 出口；自环成功不能替代此步骤。

连接失败先排除配置与兼容性，再调查线路。如果确认只有直连路径失败，可通过 `VPS-Hop` 中转。
迁移或更换 IP 需以当时面板支持情况为准，不能保证解决问题；迁移后同步所有实际部署副本和 SSH HostName，
验证新路径后再决定是否取消前置代理。历史迁移脚本中的路径和配置格式需先复核。

[deploy/desttest.sh](deploy/desttest.sh) 是历史自环实验脚本：依赖 `/tmp/selftest.json`，
假定第一个入站是 Reality，会反复改写正式配置、重启 Xray，并保留首个成功目标。
当前双入站下不能直接照搬；认证失败应先核对参数和客户端兼容性。

## 目录与历史费用

```text
F:/vps/
├── README.md
├── docs/
│   ├── 2026-11-11-PEIQIAN-DIAGNOSIS.md
│   ├── TROUBLESHOOTING.md
│   └── CONCEPT-GENERATOR-ROUTING-VERIFICATION.md
├── server-setup.sh
├── deploy/desttest.sh
├── backups/
└── client/
    ├── clash-party-override.js
    ├── clash-chatgpt.yaml
    ├── boostnet-chain/
    ├── proxy-fallback.js
    ├── test-routing.cjs
    └── node-info.txt
```

历史购买记录为 20G KVM PROMO，标价 $49.99/年，优惠后约 $46.7/年。
续费金额、到期时间和机房迁移条件以当前账户账单与面板为准。
