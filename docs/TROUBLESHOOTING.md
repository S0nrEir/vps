# 部署问题全记录（2026-10-01 实战排查日志）

## 2026-10-28（深夜）：ChatGPT 又断 —— 跳板与主选择组耦合埋雷，VPS-Hop 专用组解耦

**现象**：VPN 完全正常（google 204、机场出口正常），但 chatgpt.com/auth.openai.com/api.openai.com
全部 TLS 握手挂死（7890 CONNECT 200 建立后 schannel "failed to receive handshake"）。企业 DNS 对
chatgpt.com 返回 Facebook IP（69.63.176.143 / face:b00c）= 典型污染，但与本案无关（走代理由远端解析）。

**定位**：
- check-host.net 5 国节点测 VPS 443 全通（94-212ms）→ 服务端无恙
- Clash Party 内核经命名管道 API 测 `VPS-ChatGPT` 端到端 delay = **503**
- 逐跳板扫描（切 节点选择→测 VPS，15 个）：美国圣何塞/洛杉矶全系、美国01|下载、日本东京06、♻️自动选择
  → 503；**AWS日本01、美国01-0.1倍、新加坡hy2、台湾、日本节点组(199ms)、狮城组(244ms) → 200**
- 根因：override 动态解析把 dialer-proxy 挂在主选择组 `🚀节点选择`，主选"美国01|下载(0.01x)"恰好到不了
  VPS；订阅 autoUpdate 刷新还会自动重置选择 → 埋雷，用户/刷新切到坏节点 ChatGPT 就断且 VPN 看似正常
- 台湾节点"避免晚高峰使用"是真的：晚高峰实测 200→503 反复横跳

**修复**：override v3（`client/clash-party-override.js` + `E:\clash party\data\override\vpschatgpt01.js` 同步）
注入专用 **`VPS-Hop` select 组**：成员按正则从当前订阅过滤（AWS日本01 优先=默认、美国01-0.1倍、新加坡hy2、
台湾×3、日本节点/狮城节点组，兜底主选择组→DIRECT），`VPS-ChatGPT` 的 dialer-proxy 固定指 VPS-Hop，
主选择组与 ChatGPT 链路彻底解耦。
- 离线验证：node vm 以真实订阅执行覆写 + 真实内核 `mihomo -t` → test is successful
- 生效：taskkill mihomo.exe（GUI 2 秒自动拉起，管道名不变）
- 回归：主选切回肇事节点后 trace 仍 `ip=104.129.181.52 colo=YVR`（delay 212ms）；普通流量出口 NRT 机场 IP

**运维**：
- ChatGPT 断链先跑：`MI_PIPE=<当前管道> node .diag-mihomo.cjs node VPS-ChatGPT`（503=跳板问题），
  换跳板：`node .diag-mihomo.cjs switch <节点名> VPS-Hop`
- 当前管道名：`wmic process where "name='mihomo.exe'" get CommandLine` 的 `-ext-ctl-pipe` 值
  （含 GUI PID，重启 GUI 才变，重启内核不变）
- `.diag-mihomo.cjs` 本轮升级：`MI_PIPE` 环境变量传管道、新增 `now`/`raw`/`vspscan` 命令、`switch` 支持组名

**教训**：
- "VPN 没断但 ChatGPT 断" = 优先怀疑 ChatGPT 专用链路（跳板→VPS），别动主代理
- 机场节点到自建 VPS 的可达性**不均匀且随时会变**；dialer-proxy 引用的组绝不能是用户会随手切的主选组

---

## 2026-10-28（晚，续）：BoostNet「链式代理」界面调研 + HK1 跳板瞬时劣化

**背景**：用户打开 BoostNet 客户端自带的「链式代理」配置界面（名称/协议类型 SOCKS5/服务器地址/端口/认证），
问能否用它实现"ChatGPT 走 VPS、其余照旧分流"。同时实测发现 ChatGPT→VPS 链路断了（7890 CONNECT 能建但
数据阶段挂死，cloudflare 出口 103.91.179.101 正常 = 交还客户端分流没坏）。

**BoostNet「链式代理」真实语义**（逆向 `F:\BoostNet\BoostNet\data\app.so` Dart AOT 快照 + UTF-16 字符串挖掘）：
- BoostNet 是 **FlClash 的闭源换皮 fork**（快照内大量 `package:fl_clash/...` 路径），上游 FlClash main 分支无此功能，系 fork 自加
- 内部名 `landingProxy`（落地代理），功能描述原文：**「启用后流量链路：您的设备 → 订阅节点 → 链式代理 → 目标网站」
  「同一时间只能启用一个链式代理」**，名称提示「例如: 美国落地、日本落地」——即**全局落地代理**，机场节点先把流量带出国、
  再从国外连你填的 SOCKS5 落地、由落地 IP 出口
- 实现方式为向 mihomo 配置注入（快照内有 `_injectLandingProxy`、`landing proxy inject error:`、`dialer-proxy` 字符串）

**结论：该界面不适用于本需求，保持「暂无链式代理配置」**：
1. 它是全局开关——启用后**所有**走代理的流量出口都变成落地 IP，无法只针对 ChatGPT 域名，破坏"其余该走 VPN 的走 VPN（机场出口）"
2. 表单只收 SOCKS5（简单代理），VPS 上只有 vless+reality:443 入站，填了也连不上；要用需先在 VPS 加带认证的 SOCKS5 入站
3. 全部翻墙流量共享 VPS 出口：带宽、单点故障、固定出口纪律（全部流量 104.129.181.52 出去）全部劣化

**ChatGPT 链路中断的根因与修复**：VPS-Hop 当时选的香港HK1 瞬时劣化（41 节点实测里它本来就是"通"的边缘）。
经 API 逐跳板测 `VPS-ChatGPT` 端到端 delay：HK1 2421ms / HK2 2628 / HK3 3868 / TW1 5634 / SG1 2728 / **US1 1985（最优）**，
`PUT /proxies/VPS-Hop {"name":"Hop-美国US1"}` 切换后全链路恢复。

**验证**（2026-10-28 晚，全过）：
| 路径 | 出口 | 结论 |
|---|---|---|
| 7890 → chatgpt.com/cdn-cgi/trace ×2 | `104.129.181.52` colo=YVR | ChatGPT 经跳板 → VPS ✅ |
| 7890 → cloudflare.com/trace | `103.91.179.101` colo=LAX | 其余交还 BoostNet 分流 ✅ |
| 7899 → api.openai.com/cdn-cgi/trace | `104.129.181.52` colo=YVR | Codex proxy-fallback ✅ |

**教训**：
- "CONNECT 建立成功但数据挂死"= 跳板到 VPS 的 Reality 握手被掐（与 41 节点实测中 JP 系症状一致），先换跳板再查别的
- 挖 Flutter AOT（app.so）字符串：中文是 **UTF-16LE** 存储，grep UTF-8 永远搜不到；拉丁标识符才是单字节
- BoostNet 客户端零配置可改（配置全加密 enc1:），它自带的链式代理/落地功能是全局的，做不了按域名分流——按域名分流只能靠外置 mihomo

---

## 2026-10-28（晚）：弃用 Clash Party 改用 BoostNet 客户端 → 本地 mihomo 链式路由器

**背景**：本机从 Clash Party 切到 BoostNet 官方客户端（`F:\BoostNet`，Flutter+闭源核心，服务进程
`com.vortex.helper.exe` 监听 7897，配置文件在 `%APPDATA%\BoostNet` 全部加密 `enc1:`），无法像 Clash Party
那样注入覆写。同时系统代理已关、7899 回落转发器指向已死的 7890——Codex/API 链路整个断了。

**方案**：在 BoostNet 客户端前面垫一层本地 mihomo「链式路由器」（`client/boostnet-chain/`，mixed-port 7890）：
- `VPS-ChatGPT`（vless+reality，与覆写版同节点）`dialer-proxy: VPS-Hop` —— VPS-Hop 是**自己内置的 BoostNet
  跳板节点组**（anytls 直连 `mid1.myzxdy.top`），不随客户端选点漂移
- ChatGPT/OpenAI 域名 + ChatGPT.exe/Codex.exe 进程 → VPS-ChatGPT；公司内网/私网 → DIRECT
- `MATCH → BoostNet`（http://127.0.0.1:7897）——其余流量原样交还客户端，由它按自身规则分直连/VPN
- 系统代理开回 127.0.0.1:7890，7899 回落随之恢复；HKCU Run 键 + `start-hidden.vbs` 开机自启

**关键发现（41 节点全量实测，端到端 Reality 握手 + trace 验证）**：BoostNet 各节点到 VPS 443 连通性**不均匀**——
香港HK1-4/6-12、台湾TW1-4、新加坡SG1-8、美国US1-4、英国/马来/阿根廷/澳洲 全通；**日本JP1/3/4/7/8、香港HK5、
土耳其TR 到 VPS 不通**（CONNECT 挂死；JP1 到 22 端口 TCP 通但 SSH kex 阶段被掐）。VPS 本身全球可达
（check-host.net 瑞/意/波/土/乌 5/5 OK）。**当时客户端选的正是日本JP1**——这就是"链路时好时坏"的根因。

**验证**（2026-10-28 16:0x，全过）：
| 路径 | 出口 | 结论 |
|---|---|---|
| 7890 → chatgpt.com/cdn-cgi/trace | `104.129.181.52` colo=YVR | ChatGPT 经 BoostNet HK1 跳板 → VPS ✅ |
| 7890 → cloudflare/trace | `103.91.179.101` colo=LAX | 其余流量交还 BoostNet 客户端分流 ✅ |
| 7899 → api.openai.com/cdn-cgi/trace | `104.129.181.52` | Codex proxy-fallback 链路恢复 ✅ |

**运维**：
- 手动启动：`wscript E:\vps\client\boostnet-chain\start-hidden.vbs`（Run 键已注册自启）
- 切换跳板：`PUT http://127.0.0.1:9090/proxies/VPS-Hop {"name":"Hop-新加坡SG1"}`（坏节点可换）
- 诊断面板：`127.0.0.1:9090`（external-controller）
- 回退到 Clash Party：删 Run 键 `BoostNetChainRouter`、结束 mihomo 进程、系统代理指回 Clash Party 7890

**排障踩坑（本轮又验证/新踩的）**：
- `curl --noproxy "*" -x ...` 会连 `-x` 一起屏蔽（本页 10-08 条已记过，本轮又踩：误判链路全断 20 分钟）
- HTTP 代理下 `--resolve` 无效（DNS 由代理解析），测 Reality 端口必须让代理收到 IP 的 CONNECT
- 裸 IP 无 SNI 探测 Reality 端口会误判"不通"；`curl telnet://` 的 exitcode 不能当连通性判据（无自然结束必超时）
- mihomo file provider 的 YAML 必须有 `proxies:` 根键，裸列表报 `cannot unmarshal !!seq into provider.ProxySchema`
- provider 加载失败时 select 组会退化成 `COMPATIBLE` 空组，dialer-proxy 引用组名不报错但直接走直连（被墙→i/o timeout）
- 穿 HTTP 代理 SSH：`ssh -o ProxyCommand="python client/boostnet-chain/httpproxy.py 127.0.0.1 7897 %h %p"`（本仓库留有此工具）

---

## 2026-10-28：新机场订阅导入 Clash Party 失败 —— 全局覆写硬编码 dialer-proxy

**现象**：新机场订阅（`cat.cn-ping.com`，星辰系）导入 Clash Party 报错失败，无法添加。

**定位**（排除法分层，每层有实测证据）：
- 订阅本身正常：HTTP 200、56KB Clash YAML、46 个节点、余量 17.15 GB。该机场后端**按 User-Agent 分发格式**：
  UA 含 `clash`（不分大小写）→ Clash YAML；`mihomo`/`sing-box`/`v2rayN` → base64 裸节点列表。Clash Party 2.0.1
  拉订阅的默认 UA 是 `mihomo.party/v<版本> (clash.meta)`（源码 `profile.ts`），含 `clash.meta` → 实测返回 YAML，兼容没问题
- 网络正常：直连（`--noproxy`）0.98s 拿到完整配置，走代理同样通 → 排除墙/CDN/系统代理因素
- 真凶在 GUI 日志 `data/logs/clash-party-2026-10-28.log` 14:53：
  `proxy [VPS-ChatGPT] dialer-proxy [BoostNet] not found` → `configuration file ...Temp\mihomo-party-profile-xxx\config.yaml test failed`
- **根因**：全局覆写 `vpschatgpt01.js` 给 VPS-ChatGPT 节点硬编码 `"dialer-proxy": "BoostNet"`（10-26 引入），
  而 `BoostNet` 组只存在于 BoostNet 机场配置。导入新订阅时 Clash Party 先套全局覆写再跑 mihomo 配置校验，
  新机场主组叫 `节点选择` → dialer-proxy 指向不存在的组 → 校验失败 → 导入被拒。任何"换机场"都会踩
- 本地复现：取订阅 YAML + 注入旧覆写的节点定义，`mihomo -t` 报一字不差的同样错误

**解法**：dialer-proxy 改为动态解析——优先找 `BoostNet` 组 → 否则用订阅第一个 `select` 型组（通常是"节点选择"）
→ 都没有就不设 dialer-proxy（VPS 直连）。改动两处同步：`E:\clash party\data\override\vpschatgpt01.js`（生效文件）
和仓库 `client/clash-party-override.js`（母本，防下次同步带回 bug）。

**验证**（用真实核心 `E:\clash party\resources\sidecar\mihomo.exe -t`，`-d` 必须指向 `data/work` 否则缺 GeoIP 报无关错误）：
- 旧脚本 + 新机场订阅 → `dialer-proxy [BoostNet] not found`，失败（复现）
- 新脚本 + 新机场订阅 → dialer-proxy=`节点选择`，test is successful
- 新脚本 + BoostNet 订阅 → dialer-proxy=`BoostNet`，行为不变，test is successful
- 覆写脚本每次导入/生成配置时从磁盘实时读取（源码 `applyOverrides → getOverride → readFile`），改完即生效无需重启

**教训**：
- 全局覆写里任何对订阅内容的引用（组名/节点名）都会把"换机场订阅"变成炸点；引用必须动态解析 + 兜底，不能硬编码
- Clash Party 导入订阅失败时，先看 `data/logs/clash-party-<日期>.log` 里的 `test failed` 上一行——那是 mihomo 校验的真实报错，
  比界面弹窗信息量大得多
- 机场订阅 UA 分发机制：测订阅问题要带着客户端真实 UA 测（`curl -A "mihomo.party/v2.0.0 (clash.meta)"`），
  默认 curl UA 拿到 base64 列表会误导排查方向

---

## 2026-10-26（下午）：IP 第二次被 GFW 封锁 → dialer-proxy 经机场链式绕行

**现象**：当天 10:13 起 ChatGPT 走 VPS 开始间歇性失败（上午刚做完路由修复、11:05 验证通过），16:38 后完全中断，全天 mihomo 日志 3473 次 `dial tcp 104.129.181.52:443: i/o timeout`。

**定位**（分层证据）：
- KiwiVM 面板：VM Running、负载 0.00、流量/磁盘/内存正常 → 服务端无恙
- check-host.net 全球 8 节点（含美/越/欧）测 443 **全部连通** → VPS 全球可达
- 本机：TCP 22/443 双双超时，但 **ICMP ping 通**（179ms）→ GFW 针对 IP 的 TCP 级封锁（与 10-01 Fremont 那次同类，本次更彻底连 22 也断）
- 对照组：apple/github 直连、机场节点端口（mid1.myzxdy.top:40200-40202）、apple 经 7890 走机场全部正常 → 本机网络/Clash/机场无关

**尝试迁移换 IP**：面板选了 USCA_2（洛杉矶 DC2 AO，截图视觉确认单选框勾选后才确认），点 Start Migration 后报
`Migration backend is currently not available for this VPS. Please try again in 10-15 minutes. (Reference code: 734152)`
——迁移**未启动**，等 12 分钟重试仍同样报错（搬瓦工后端问题，非本 VPS 故障）。VM 数据与 IP 未受影响。

**实际解法（当天恢复可用）**：mihomo 的 `dialer-proxy` 链式转发——给 VPS-ChatGPT 节点加一行 `"dialer-proxy": "BoostNet"`（机场主选择组），
连接 VPS 的 TCP 先经机场当前选中节点出国、再从国外连 VPS。**ChatGPT 看到的出口仍是 VPS 固定 IP**（cdn-cgi/trace 实测 ip=104.129.181.52、colo=YVR），
不破坏固定出口纪律。代价：多一跳延迟 + 依赖机场可用性。

**验证**（2026-10-26 18:03）：7890 → chatgpt.com trace = 104.129.181.52；7899（proxy-fallback/Codex 路径）→ api.openai.com trace = 104.129.181.52；
重启后日志 18:02:35 起 VPS 连接零报错。

**恢复直连**：KiwiVM 迁移后端恢复后执行 Migrate to another DC 换新 IP → 跑 `backups/20261026-gfw-migration/update-ip.sh <新IP>` →
删除 override 里的 dialer-proxy（2026-10-28 起为动态解析：删掉 `dialerProxy` 解析块和
`...(dialerProxy ? ...)` 一行即可）→ 重启 Clash Party。

**顺带确认的事实**：
- VM 物理机房是 **CA Vancouver (CABC_1)**（面板 Physical Location + trace colo=YVR 双重印证；README 原记录"洛杉矶 USCA_2"已过时，IP 从未变过，疑为搬瓦工侧机房调整）
- 本机 `~/.ssh/config` 原先是空的、`~/.ssh/vps_chatgpt` 密钥不存在（与文档声明不符）；实际可用密钥是 `~/.ssh/id_rsa`（known_hosts 有 10-01 部署当天的记录）。已补 vps-chatgpt 条目，迁移换 IP 后记得同步 HostName
- 诊断技巧：`bash -c 'cat < /dev/null > /dev/tcp/<IP>/443'` 测 TCP、ping 对照 ICMP、check-host.net 外测——三步即可区分"本机问题/机场问题/IP 被墙/服务端宕机"

---

## 2026-10-26：修复本机 ChatGPT 代理直连降级

**定位**：系统代理已启用，但 TUN 关闭。ChatGPT/OpenAI 域名原本已走 VPS；桌面应用的 Google 辅助请求仍命中机场规则。Codex 使用的 `127.0.0.1:7899` 是 `%USERPROFILE%\.proxy-fallback\proxy-fallback.js`，原先会在 Mihomo 不可用时直连，在 CONNECT 上游连接失败后也会重试直连。

**修改**：

- `client/clash-party-override.js` 和独立 YAML 增加 `ChatGPT.exe`、`Codex.exe`、`codex.exe` 进程优先规则及 `find-process-mode: always`，补充 `chatgpt.site`、`chatgpt-team.site`。
- 按用户随后补充的要求，公司域名 `*.cyou-inc.com`、RFC1918 私网、IPv6 ULA/link-local 和本机回环规则优先于进程规则；ChatGPT 内置浏览器访问公司内网直连，其余命中进程规则的请求仍走 VPS。IP 规则使用 `no-resolve`，不主动解析公网域名来匹配私网规则。
- `client/proxy-fallback.js` 保存当前转发器源码：保护域名的 HTTP/CONNECT 请求在上游不可用时返回 502，禁止上游连接失败后重试直连；其他域名保留原有行为。
- 已同步至 `E:\clash party\data\override\vpschatgpt01.js`、工作配置及本机转发器，热加载 Mihomo 并重启了转发器。持久设置 `data\mihomo.yaml` 同步为 `find-process-mode: always`。

**验证**：`node client/test-routing.cjs` 检查进程规则优先级、保护域名一致性、HTTP/CONNECT 上游不可用与健康检查后的断线竞争。另以真实本地 HTTP 服务、关闭的测试上游端口验证 HTTP/CONNECT 均返回 502，直接拨号次数为 0。运行中可看到 ChatGPT 的 Sentry 请求命中 `ProcessName(ChatGPT.exe)`，链路为 `VPS-ChatGPT`。

2026-10-26 11:05（北京时间）复测：经 7890 请求 `chatgpt.com/cdn-cgi/trace`、经 7899 请求 `api.openai.com/cdn-cgi/trace` 均返回 `ip=104.129.181.52`；普通 Cloudflare 请求仍走原有机场，出口 `64.118.152.45`。连接快照中 15 条 OpenAI 相关连接全部走 VPS，ChatGPT/Codex 的 18 条已建立 TCP 连接均为 loopback，Google 辅助连接已命中进程规则。这是当时的抽样，不能证明过去没有直连，也不能代表全部 UDP 行为。

内网优先级调整后再次验证：11:10:58 日志明确记录 `ChatGPT.exe --> mail.cyou-inc.com:443 match DomainSuffix(cyou-inc.com) using DIRECT`；内置浏览器标签页标题为 `Outlook Web App`，URL 已进入 `/owa/auth/logon.aspx`。浏览器工具读取页面内容超时，未登录邮箱；独立 HTTP 测试确认服务可达。ChatGPT/API 出口复测仍为 `104.129.181.52`。内网优先级调整前的配置另存于 `backups/20261026-intranet-priority/*.bak`。

**故障行为澄清**：Clash Party 是本机代理客户端，VPS 是它使用的出站节点；当前路径是“GPT → Clash Party → VPS”。没有配置 VPS 不可用时自动切换机场节点的 fallback 组。VPS 不可用时该路线失败；Clash 本机端口不可用时，7899 转发器对保护域名返回失败，不尝试本机直连。

**边界**：用户明确选择暂不启用 Windows 防火墙；三个防火墙配置和 TUN 均保持关闭。代理层修复不等于系统级禁止直连，主动绕过代理的 TCP/UDP/IPv6 连接仍无强制拦截。7899 转发后 Mihomo 看到的是 Node 进程，故该路径依靠域名规则，无法保证未知第三方域名跟随 Codex 身份走 VPS。代理主程序必须保持规则模式，保护节点仍为单个 `VPS-ChatGPT` 节点。没有测试语音/视频的完整 UDP 链路。

**恢复**：本次修改前的本机文件保存在 `E:\vps\backups\20261026-chatgpt-routing\*.bak`。恢复覆写和 mihomo 设置后重启 Clash Party，恢复转发器文件后只重启对应 Node 进程即可；恢复旧转发器会重新引入自动直连。

规则语义参考：[Mihomo 路由规则](https://wiki.metacubex.one/en/config/rules/)。

---

本文档记录该项目部署当天实际遇到的所有问题、诊断过程与解法，供未来排障复用。
按"现象 → 定位 → 解法"组织，含可复用的诊断技巧。

---

## 问题 1：搬瓦工官网找不到 CN2 GIA-E 方案

**现象**：打开 `bandwagonhost.com/cn2gia-vps.php` 只有线路介绍，没有购买按钮。

**定位**：
- `cn2gia-vps.php` 是科普页，本来就不放方案
- 真正的购买页 `vps-hosting.php` 是 Vue SPA，方案列表由 JS 动态拉取，curl 抓不到
- 顺着 `ordervps.js` 找到数据接口：**`GET https://bandwagonhost.com/order/get-data`**，返回全部 48 个方案的实时价格/库存/机房 JSON

**解法/技巧**：
- 查库存直接调上面接口，看 `products[].outOfStock`
- 老版服务端渲染的购物车页 `https://bandwagonhost.com/cart.php` 不需要 JS，也能看到方案和 Order Now 按钮
- 官网屏蔽数据中心 IP 的抓取器：用本机代理（`curl -x http://127.0.0.1:7890`）即可正常抓取

---

## 问题 2：首个 IP 被墙（176.122.138.204，Fremont）

**现象**：代理连接失败，客户端日志 `dialing TCP ... EOF`，换端口 8443 无效；但 SSH(22) 正常。

**定位过程**（教科书级排查链，值得复用）：
1. **服务端抓包**（`tcpdump -ni any port 443`）：
   - TCP 三次握手完成 ✅
   - 客户端 ClientHello（1728B）到达服务器 ✅
   - 服务器从微软取回证书并**成功回发 9408B 给客户端** ✅
   - 服务端日志：`accepted tcp:api.ipify.org:443 [direct]`——请求已被服务器接收并转发 ✅
   - 抓包中服务器从未发 RST，但客户端侧收到 reset
   → **结论：去程通、回程被中间设备掐断 = IP 被 GFW 针对性阻断**
2. **换端口对照**：443 → 8443 同样死 → 排除端口封锁，锁定 IP 级
3. SSH 22 端口一直正常 → 不是整机不通，是 IP:代理流量特征被标记

**解法**：搬瓦工 KiwiVM 面板 **Migrate to another datacenter**（免费、保留数据、获得新 IP）。Fremont → 洛杉矶 USCA_2，新 IP `104.129.181.52`。

**验证 IP 是否被墙的快捷方法**：
```bash
curl -sv --resolve www.microsoft.com:443:<IP> https://www.microsoft.com
# 能出 200 = TLS 路径通；连不上/被reset = 该 IP 的 443 已被墙
```

---

## 问题 3：Reality 握手秒失败 —— 伪装目标启用了抗量子 TLS（最难的一个）

**现象**：换了新 IP 后依然连不上。且出现**矛盾证据**：
- 普通 HTTPS（curl 直连 IP、SNI=microsoft）→ 200 正常
- xray 客户端（任意指纹：chrome/firefox/safari/ios/random）→ 握手阶段 EOF
- 服务器**自己连自己（自环）都失败**

**定位过程**：
1. 指纹矩阵测试全灭 → 排除 uTLS 指纹被识别
2. 核对密钥：`xray x25519 -i <服务器私钥>` 反推公钥 = 客户端公钥 ✅；UUID/shortId/SNI/时钟全部一致 → 排除配置错误
3. 服务器自环测试（服务器上跑 xray 客户端连本机 443）也失败 → **排除一切网络因素（GFW/线路/防火墙），问题在服务端本身**
4. 服务端 debug 日志：`REALITY: processed invalid connection ... handshake did not complete successfully`
   → 服务器没认出客户端的认证，把它当陌生访客转发给伪装站了
5. **根因**：伪装目标 `www.microsoft.com` 已启用 **X25519MLKEM768 抗量子密钥交换**（微软/苹果/谷歌/亚马逊等大 CDN 陆续开启），Reality 的认证推导依赖普通 X25519，算法不匹配导致认证必然失败

**解法**：换未启用 MLKEM 的伪装站。写了自动筛选脚本 `F:\vps\deploy\desttest.sh`：逐个候选站自环实测，第一个通过的是 `www.lovelive-anime.jp`（备选：www.samsung.com、www.nvidia.com 等）。

**自环测试法**（诊断 Reality 服务端问题的杀手锏）：
```bash
# 在服务器上写一个 vless 客户端配置指向 127.0.0.1:443，跑起来 curl 测试
# 通 = 服务端配置完好，问题在网络路径；不通 = 服务端问题（配置/密钥/伪装站）
```

---

## 问题 4：Clash Party JS 覆写报 SyntaxError

**现象**：覆写文件注册成功（global: true），但执行日志 `SyntaxError: Unexpected token '-'`，配置未注入。

**定位**：用本机 Node 复现 Clash Party 的执行方式（`vm.runInContext(script + " main(profile)")`），
错误直指第 17 行 `client-fingerprint: "chrome",`——**JS 对象键含连字符必须加引号**（YAML 里不需要，从 yaml 抄到 js 时踩坑）。

**解法**：改成 `"client-fingerprint": "chrome"`。

**Clash Party / Mihomo Party 覆写机制速查**（逆向源码 + 实测确认）：
- 覆写文件：`<数据目录>/override/<id>.js`
- 注册表：`<数据目录>/override.yaml`，条目格式：
  ```yaml
  items:
    - { id: vpschatgpt01, type: local, ext: js, name: 名称, updated: <毫秒时间戳>, global: true }
  ```
- `global: true` = 自动应用到所有订阅（源码 `globalOverrideIdsNow()`：`items.filter(i => i.global)`）
- 执行日志在同目录 `<id>.log`，排障先看它
- JS 覆写要求：导出 `function main(config)`，返回 config；连字符键一律加引号

**2026-10-08 补充（新版 Clash Party，E:\clash party 便携版实测）**：
- **外部改 override.yaml 不会热生效**：新版源码只在内核启动/订阅导入更新时才读 override.yaml 并重算配置，
  对 override 目录和 override.yaml 均无文件监听。手动放文件+改注册表后，必须**重启 Clash Party**
  （或内核）才生效。验证标志：`data/work/config.yaml` 的修改时间刷新且含 `VPS-ChatGPT`。
- 数据目录不固定在 %APPDATA%，**以 mihomo.exe 命令行 `-d` 参数为准**
   （`wmic process where "name='mihomo.exe'" get CommandLine` → `E:\clash party\data\work`）。
- 覆写日志 `<id>.log` 出现 `脚本执行成功` 仅代表 JS 跑通，还需看 work/config.yaml 是否真的注入。
- 验证分流时注意：若终端设了 `HTTP_PROXY/HTTPS_PROXY` 环境变量（本机有别的代理占 7899），
  curl 加 `--noproxy "*"` 会**连 `-x` 一起屏蔽**导致直连测试、结论全错——只加 `-x http://127.0.0.1:7890` 即可（显式 -x 优先于环境变量）。

---

## 小坑收集（工具链相关）

| 坑 | 解法 |
|---|---|
| `pkill -f "xxx"` 把当前 SSH 会话自己杀了（命令行里含同样字符串） | 用 `kill $PID` 或括号技巧 `pkill -f "xx[x]"` |
| Windows 原生 Python 读不了 Git Bash 的 `/tmp` 路径 | 用 `cat file \| python -c` 管道，或 `cygpath -w` 转换 |
| Git Bash 里中文输出乱码（GBK vs UTF-8） | 不影响数据本身，看结果不看中文 |
| WebFetch/数据中心 IP 被目标站屏蔽 | 本地 `curl -x http://127.0.0.1:7890`（走用户自己的代理） |
| Windows curl 走不了系统代理 | 显式 `-x` 指定，socks 用 `--socks5-hostname`（远程解析域名） |
| ssh-copy-id 之后的首次 ssh 报 Host key verification | 首次加 `-o StrictHostKeyChecking=accept-new` |
| GitHub SSH 22 被 GFW reset（push/pull 全挂，Connection reset by 20.205.243.166） | `~/.ssh/config` 的 `Host github.com` 块：HostName 改 `ssh.github.com` + 加 `Port 443`，密钥不变，2026-10-28 实测 |

---

## 可复用的诊断思路总结

1. **分层隔离**：客户端 → 网络去程 → 服务端 → 伪装站 → 回程，逐层找证据
2. **服务端抓包**永远说实话（tcpdump），比客户端日志可靠
3. **自环测试**剥离全部网络因素，专测服务端配置
4. **差异测试**：同一条路换流量形态（普通 HTTPS vs 代理握手），锁定"内容检测"还是"IP 封锁"
5. **对照源码**：GUI 程序的配置格式不确定时，直接看上游源码（本例 clash-party 的 override 机制）
