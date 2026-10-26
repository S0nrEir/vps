# 部署问题全记录（2026-10-01 实战排查日志）

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
删除 override 里 `"dialer-proxy": "BoostNet"` 一行 → 重启 Clash Party。

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

---

## 可复用的诊断思路总结

1. **分层隔离**：客户端 → 网络去程 → 服务端 → 伪装站 → 回程，逐层找证据
2. **服务端抓包**永远说实话（tcpdump），比客户端日志可靠
3. **自环测试**剥离全部网络因素，专测服务端配置
4. **差异测试**：同一条路换流量形态（普通 HTTPS vs 代理握手），锁定"内容检测"还是"IP 封锁"
5. **对照源码**：GUI 程序的配置格式不确定时，直接看上游源码（本例 clash-party 的 override 机制）
