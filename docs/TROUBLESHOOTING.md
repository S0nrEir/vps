# 部署与排障记录

## 当前结论：2026-11-11 赔钱机场链路已恢复

当前主用路径是赔钱机场 AWS日本01 → VPS:8443 Reality → ChatGPT。
修复了安装覆写未同步、端口/协议错配以及 ML-KEM 握手选项缺失；
正式入口连续 5 次 trace 返回 `ip=104.129.181.52`，SSH 直连 22 已恢复。

操作、对照实验与备份见 [完整修复记录](2026-11-11-PEIQIAN-DIAGNOSIS.md)，
当前参数与复查命令见 [README](../README.md)。

下方为历史事件记录。旧测试中的端口、节点名、文件路径与状态只适用于各自测试时点，
不覆盖上面的实机复核结果。2026-11-11 旧记录有相互冲突的时段标签，以实际配置和验证证据为准。

## 2026-11-11 重建与误判复盘

### 服务与 SSH

- 重装后部署 Xray 26.11.9，沿用 UUID/short-id，生成了新的 Reality 密钥对。
  当前实际入站为 **8443 Reality + 443 HTTPUpgrade**。
- 旧记录曾因经机场连 22 没拿到 SSH banner、临时 443 SSH 可用，就推断“BWH 边缘封锁 22”。
  该对照不足以确认过滤方；本次本机直连 22 成功，不需要占用 Xray 的 443 端口。
- 旧记录中的 `~/.ssh/vps_reinstall` 并非当前电脑使用的密钥；本次恢复的是
  `~/.ssh/vps_chatgpt`。先通过已登录控制台确认重装后的主机指纹，再更新 known_hosts 和公钥授权。
- 安装器可能先启动空配置。后写配置需要校验并重启；`systemctl is-active xray` 为 active
  不等于入站已加载，应结合 `ss -lntp`、进程启动时间和配置修改时间核对。
- 旧记录提到 `pkill -f "sshd -p 443"` 匹配到了执行命令的 shell，导致后续重启未执行。
  优先操作已确认的 PID 或 systemd 服务，避免宽泛进程匹配。

### 撤回“机场随机篡改/反二级代理”的归因

历史排查记录包括：认证日志 true/false 交替、切换多个指纹/SNI/密钥/节点仍失败、
普通 TLS 能拿到伪装站证书、自环成功，以及 HTTPUpgrade CONNECT 后数据阶段超时。
这些现象都不足以证明机场修改了 ClientHello 或将 VPS 加入代理黑名单：

1. 外层机场节点本身也使用 Reality，必须分清日志对应哪一跳；`using VPS-ChatGPT`
   只说明选择了该出站，不能代替目标响应和出口验证。
2. 服务端自环只验证所用本机客户端路径，不能证明远端 Mihomo 参数和握手兼容性。
3. 普通 TLS 可能走 Reality 对未认证连接的转发路径，不验证 VLESS/Reality 认证。
4. 更换多个候选参数不等于覆盖了所有变量。本次同一跳板、正确参数下，
   仅开启 `support-x25519mlkem768` 就使认证和端到端请求成功。
5. CONNECT 200 和没有 error 日志不证明上游协议成功，更不能据超时断言流量被静默丢弃。
   本次隔离测试还验证了 443 HTTPUpgrade 可用。

远端历史提交 `d5425f9` 增加的“深夜定案”及“8443 成功率两三成”没有说明如何区分外层/内层认证，
也未提供可复现的抽样依据，不作为当前结论。保留其部署事实：服务端改为双入站，
8443 为 Reality、443 为 HTTPUpgrade；本轮恢复沿用这一配置。
等待窗口、循环轮换节点、迁移或换机场都不是本次已确认的修复步骤。

旧记录声称仓库与安装覆写已同步，本次发现实际安装副本仍含旧公钥且没有跳板。
因此必须检查**实际加载副本**，不能只看仓库。
曾怀疑 Node crypto 生成的密钥无效，但没有充分对照证据；检查方法是在服务端从私钥派生公钥，
与客户端核对，不需把私钥传回本机或再次换钥。

### 网页终端与重建顺序

KiwiVM basic shell 曾发生多行命令拼接、字符缺失，导致公钥未写入或配置损坏。
每次提交一条命令并核对效果，恢复 SSH 后再传输长文件。旧流程临时停 Xray、将 sshd 放到 443
只是当时的应急方式，当前无需使用；“少于 100 字符一定安全”也没有保证。

重建时：恢复可信 SSH → 备份/生成配置 → Xray 配置校验 → 重启并查监听 →
恢复所需 SMTP 防火墙和 SSH 加固 → 同步所有客户端副本 → 触发运行配置重建 →
**从实际机场路径验证 ChatGPT 出口**。自环可辅助定位，但不能充当最终验收。

---

## 2026-11-11（下午）：二次滥用暂停 —— 攻击者清防火墙真发赌场邮件 → 整机重装 + 防火墙升级 + 面板改密

**现象**：上午处理完 at 队列恶意脚本并封出站 25/465/587 后约 4 小时（abuse 日志时间戳 1794371028~1794372026
= 北京时间 12:23–12:38，面板日志时间戳是 Unix 秒，换算 timeline 很方便），VPS 再次被 IT7 暂停
（`Network abuse: Mass Mailing`，再 +100 分 → **年内累计 200/1300**）。本次与上午"空邮件探测"性质不同：
**实际投递成功**——大量 587 端口外连（HELO 为裸 IP `31.76.11.151`）+ 25 端口打 Yahoo MX（HELO 伪装
`billing.midjourney.com` / `trust.gamma.app` / `anthropic.ai` 等），其中一封赌场诈骗信
（`Win Now <Casino@smsnet.pl>`，主题 "Your $200 treat, free spins too"）经 `216.157.33.76:587` 送出、
对端 250 已接收；客户端标识 **Microsoft Windows Live Mail 14.0.8117.416** —— 全新一波样本，与上午的
`netstat_probe` 不是同一驻留。

**为什么上午的防线没用**：iptables REJECT 挡不住仍持有 root 的攻击者——规则可被 `iptables -F` 直接清掉。
上午条目"遗留/待办"第 1 条（尽快重装）当天下午即被现实验证为唯一正解。

**处理**（全部经 KiwiVM 面板网页完成，桌面自动化实操）：
1. 面板 "I understand the issue and ready to resolve it right away" 确认解封（Issue marked as resolved）
2. **Install new OS → ubuntu-24.04-x86_64 整机重装**（勾选数据清空确认 + JS 弹窗二次确认），旧盘数据与
   全部入侵痕迹清空，装完自动开机 Running。产物：**临时 root 密码**（面板显示 + 邮件送达注册邮箱，
   不写入本仓库）、**SSH 端口回到 22、密码登录恢复**（旧系统 publickey-only 加固随盘消失）
3. **防火墙重建并升级**，unit 更名 `smtp-block.service`（旧名 `block-smtp-out` 随旧系统消亡，全文见下）：
   - 端口 25/465/587/**2525**（补上常见备用 SMTP 端口，上午版本的缺口）
   - **出站 + 入站双向** REJECT（旧版只封出站）
   - IPv4 + IPv6；放行 `127.0.0.0/8` 与 `-o lo`（本机 MTA / 应用间通信不受影响）
   - 已 `systemctl enable`（enabled，开机自动下发），当次规则也已手动下发立即生效
4. **KiwiVM 面板登录密码已更换**（新密码不写入仓库，当面交付）

**验证**：`iptables -S INPUT/OUTPUT` 可见 REJECT 行（reject-with icmp-port-unreachable）；`PERSIST_OK` +
`systemctl is-enabled smtp-block.service` = enabled（symlink 已创建）；面板显示
"KiwiVM panel password has been changed successfully"。

**当时遗留事项（Xray 与 SSH 已在后续恢复，非当前待办）**：
- Xray 随重装消失；现已重建为 8443 Reality + 443 HTTPUpgrade，见文首。
  初始化脚本会生成新 UUID/密钥/short-id 并覆盖配置，不能当作无损修复；当前部署说明以 README 为准。
  重装也会更换 SSH 主机密钥并清空服务器公钥授权，本机密钥文件尚在不代表无需恢复登录。
- SSH 加固重做：Root shell 把自己的公钥追加回 `/root/.ssh/authorized_keys`（旧的别信）→ `passwd` 换掉临时
  密码 → 恢复 publickey-only 登录
- abuse 当时累计 200/1300。再次告警应先保存证据并隔离风险；确认 root 失陷后重建可信系统、轮换凭据并调查入口。
- 运维：KiwiVM 网页全流程（解封 / 重装 / Root shell / 改面板密码）可无人值守操作；Root shell – basic
  长命令仍要控制长度（本轮 printf 写 unit 成功，但超长命令有丢字符风险，可拆两条）

**复贴：smtp-block.service 全文**（下次重装后照抄重建，`systemctl daemon-reload && systemctl enable --now smtp-block`）：

```ini
[Unit]
Description=Block SMTP ports anti-spam
After=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/iptables -I OUTPUT -d 127.0.0.0/8 -p tcp -m multiport --dports 25,465,587,2525 -j ACCEPT
ExecStart=/usr/sbin/iptables -A OUTPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT
ExecStart=/usr/sbin/iptables -A INPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT
ExecStart=/usr/sbin/ip6tables -I OUTPUT -o lo -p tcp -m multiport --dports 25,465,587,2525 -j ACCEPT
ExecStart=/usr/sbin/ip6tables -A OUTPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT
ExecStart=/usr/sbin/ip6tables -A INPUT -p tcp -m multiport --dports 25,465,587,2525 -j REJECT

[Install]
WantedBy=multi-user.target
```

**教训**：
- **root 级入侵的机器，任何"就地清理 + 防火墙"都是治标**——攻击者与管理员对内核防火墙有同等权限，
  修复后 4 小时内即可清规则复犯。唯一正解：重装 + 换全部凭据 + 入口收敛，且当天执行
- 备份惯例缺一口：**服务器端配置（含 Reality 私钥）从未随仓库留档**，重装的隐性代价 = 客户端四处换钥。
  下次部署后把服务器 `config.json` 留档一份（私有的话放私有渠道，至少灾难恢复时能复用密钥对）
- 面板 abuse 日志给的时间戳/收件人/HELO/客户端标识足够复盘整波攻击，先读日志再决定动不动手

---

## 2026-11-11（上午）：VPS 因 Mass Mailing 被滥用暂停 —— at 队列恶意脚本，出站 25/465/587 全封

**现象**：KiwiVM 面板弹出滥用暂停页（Abuse points **100/1300**，年内累计制，满 1300 永久封到年底），
原因 `Network abuse: Mass Mailing`。连接日志：VPS（104.129.181.52）每隔 2~4 分钟对 Yahoo（98.136.96.74）
和 Google（142.250.102.26）的 MX **25 端口**发起 SMTP 连接，HELO 伪装成 gamma.app / status.figma.com /
martinfowler.com / ping.mcp.so / aif.runwayml.com 等正规域名，STARTTLS 后发空邮件失败。时间戳
2026-11-10 08:21–08:40（北京时间）。手动重启解封了机器，但源头未除。

**定位**（经 KiwiVM 网页 Root shell —— 本机 SSH 已进不去：sshd 只接受 publickey，
本机 `id_rsa`/`remote` 两把钥匙均被拒 → **疑攻击者换掉了 `/root/.ssh/authorized_keys`**）：
- root 无 crontab、`/etc/cron.d` 与 `systemctl list-timers` 全为系统默认、高 CPU 进程全是内核线程
  → 恶意程序**非常驻、定时唤醒型**，普通排查全空
- `/tmp/netstat_probe`（2026-11-11 08:11 服务器时间，3.5KB bash 脚本）：伪装成"网络诊断"，注释自述
  "连接一组邮件中转的 25 端口并验证"，驻留方式是 **`at(1)` 队列**（atq 里有任务，排到次日 02:00）
  → 这就是 cron/timer 都查不到的原因；入侵者拿到过 root

**处理**（全部已执行并验证）：
1. **核心防线——防火墙封死出站 SMTP**，且重启自动生效：
   - 新建 `/etc/systemd/system/block-smtp-out.service`（oneshot + RemainAfterExit）并 `enable --now`
   - 手动补了条 LOG 规则插在 OUTPUT 链第 1 位（前缀 `SMTPBLK`，当报警器用；注意它不在 unit 里，重启后只剩 REJECT）
2. **清除本次驻留**：`atrm` 清空 at 队列 → `rm -f /tmp/netstat_probe` → `systemctl disable --now atd`
3. **实测验证**：从 VPS 连 98.136.96.74:25 立即被 REJECT（rc=1）；`iptables -L OUTPUT -n` 可见
   `LOG ... dports 25,465,587 prefix "SMTPBLK"` + `REJECT ... reject-with icmp-port-unreachable`；
   `atq` 空输出；`ls /tmp/netstat_probe` → No such file or directory；`atd` inactive；
   `block-smtp-out` enabled

**遗留 / 待办**：
- ✅ **本条已执行**：当日下午整机重装 + 防火墙升级为 `smtp-block.service`（双向+2525）+ 面板改密，见上方条目。
  以下原判断全部被现实验证（攻击者 4 小时后清规则复犯、真发出邮件）
- ⚠️ **根级入侵已成事实，清掉一个驻留点不等于干净**。建议尽快在 KiwiVM 里 snapshot 备份后一键重装。
  重装后第一件事：(a) 把自己的公钥配回 `authorized_keys`（旧的别信）；(b) 重建下面的防火墙 unit
- 报警器：`dmesg | grep SMTPBLK`，有输出 = 还有残留程序在尝试外发，更要尽快重装
- abuse 分数不会因处理而清零（年内累计，现 100/1300）；25 端口已封死，该类举报不会再发生
- 运维知识：SSH 坏掉时用面板左侧 **Root shell – basic**（网页 root 终端，无需密码）；
  该会话**几分钟不动就超时重置**，命令要短、分批连发

**旧版 block-smtp-out.service（仅历史记录）**：已由上方 `smtp-block.service` 替代，不要重复部署旧 unit。

```ini
[Unit]
Description=Block outbound SMTP 25/465/587
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/iptables -A OUTPUT -p tcp -m multiport --dports 25,465,587 -j REJECT
ExecStart=/usr/sbin/ip6tables -A OUTPUT -p tcp -m multiport --dports 25,465,587 -j REJECT

[Install]
WantedBy=multi-user.target
```

可选：再加日志报警行（放在两条 REJECT 之前，重启后也保留）：
`ExecStart=/usr/sbin/iptables -A OUTPUT -p tcp -m multiport --dports 25,465,587 -j LOG --log-prefix SMTPBLK`

**教训**：
- 重启只解封不除根；定时唤醒型恶意程序要查 **at 队列**（`atq`），光看 cron/systemd 会漏
- 公钥被拒先查是否选错本机密钥、远端授权是否丢失、权限或 sshd 策略是否变化；单凭拒绝登录不能认定入侵。
- 网页终端操作长命令会被丢字符，长内容拆成多条短命令逐行执行

---

## 2026-10-28（深夜）：ChatGPT 又断 —— 跳板与主选择组耦合埋雷，VPS-Hop 专用组解耦

**现象**：VPN 完全正常（google 204、机场出口正常），但 chatgpt.com/auth.openai.com/api.openai.com
全部 TLS 握手挂死（7890 CONNECT 200 建立后 schannel "failed to receive handshake"）。企业 DNS 对
chatgpt.com 返回异常地址（69.63.176.143 / face:b00c）；是否影响请求需看域名在哪里解析，不能仅凭开启代理就排除 DNS。

**定位**：
- check-host.net 5 国节点测 VPS 443 全通（94-212ms）→ 这些路径 TCP 可达，不能证明 Reality 认证或目标访问正常
- Clash Party 内核经命名管道 API 测 `VPS-ChatGPT` 端到端 delay = **503**
- 逐跳板扫描（切 节点选择→测 VPS，15 个）：美国圣何塞/洛杉矶全系、美国01|下载、日本东京06、♻️自动选择
  → 503；**AWS日本01、美国01-0.1倍、新加坡hy2、台湾、日本节点组(199ms)、狮城组(244ms) → 200**
- 根因：override 动态解析把 dialer-proxy 挂在主选择组 `🚀节点选择`，主选"美国01|下载(0.01x)"恰好到不了
  VPS；订阅 autoUpdate 刷新还会自动重置选择 → 埋雷，用户/刷新切到坏节点 ChatGPT 就断且 VPN 看似正常
- 台湾节点"避免晚高峰使用"是真的：晚高峰实测 200→503 反复横跳

**修复**：override v3（`client/clash-party-override.js` + `E:\clash party\data\override\vpschatgpt01.js` 同步）
注入专用 **`VPS-Hop` select 组**：成员按正则从当前订阅过滤（AWS日本01 优先=默认、美国01-0.1倍、新加坡hy2、
台湾×3、日本节点/狮城节点组，兜底主选择组→DIRECT），`VPS-ChatGPT` 的 dialer-proxy 固定指 VPS-Hop，
选独立节点时主选择组与 ChatGPT 链路解耦；选择兜底主组或自动组时仍受其选择影响。
- 离线验证：node vm 以真实订阅执行覆写 + 真实内核 `mihomo -t` → test is successful
- 生效：taskkill mihomo.exe（GUI 2 秒自动拉起，管道名不变）
- 回归：主选切回肇事节点后 trace 仍 `ip=104.129.181.52 colo=YVR`（delay 212ms）；普通流量出口 NRT 机场 IP

**运维**：
- ChatGPT 断链先跑：`MI_PIPE=<当前管道> node .diag-mihomo.cjs node VPS-ChatGPT`（Git Bash 语法；503 仅代表测试失败，不能独自定位跳板），
  换跳板：`node .diag-mihomo.cjs switch <节点名> VPS-Hop`
- 当前管道名：`Get-CimInstance Win32_Process -Filter "Name='mihomo.exe'" | Select-Object CommandLine` 的 `-ext-ctl-pipe` 值
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
- CONNECT 成功只表示本地代理接受隧道请求；数据阶段超时还要查上游拨号、协议/认证、回源和目标响应，不能直接断言握手被掐。
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
土耳其TR 到 VPS 测试失败**（CONNECT 后超时；JP1 到 22 端口 TCP 通但 SSH kex 未完成）。
check-host.net 瑞/意/波/土/乌 5/5 TCP 可达，不能代替协议验证。**当时客户端选的是日本JP1**；
切换跳板后恢复支持路径差异的判断，不足以认定具体干扰机制。

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
- 覆写在导入/重新生成配置时从磁盘读取；外部编辑后还需触发重新生成，并核对运行配置。不能把“生成时读磁盘”理解为“编辑后自动生效”。

**教训**：
- 全局覆写里任何对订阅内容的引用（组名/节点名）都会把"换机场订阅"变成炸点；引用必须动态解析 + 兜底，不能硬编码
- Clash Party 导入订阅失败时，先看 `data/logs/clash-party-<日期>.log` 里的 `test failed` 上一行——那是 mihomo 校验的真实报错，
  比界面弹窗信息量大得多
- 机场订阅 UA 分发机制：测订阅问题要带着客户端真实 UA 测（`curl -A "mihomo.party/v2.0.0 (clash.meta)"`），
  默认 curl UA 拿到 base64 列表会误导排查方向

---

## 2026-10-26（下午）：直连路径失败 → dialer-proxy 经机场链式绕行

**现象**：当天 10:13 起 ChatGPT 走 VPS 开始间歇性失败（上午刚做完路由修复、11:05 验证通过），16:38 后完全中断，全天 mihomo 日志 3473 次 `dial tcp 104.129.181.52:443: i/o timeout`。

**定位**（分层证据）：
- KiwiVM 面板：VM Running、负载 0.00、流量/磁盘/内存正常 → VM 在运行，代理服务仍需单独检查
- check-host.net 全球 8 节点（含美/越/欧）测 443 **全部连通** → 所测路径 TCP 可达
- 本机：TCP 22/443 双双超时，但 **ICMP ping 通**（179ms）→ 当时本机到这两个端口的 TCP 路径异常；不能仅凭此定位过滤方或断言整 IP 被封。
- 对照组：apple/github 直连、机场节点端口（mid1.myzxdy.top:40200-40202）、apple 经 7890 走机场正常 → 普通出网可用，仍需核对专用 VPS 路由

**尝试迁移换 IP**：面板选了 USCA_2（洛杉矶 DC2 AO，截图视觉确认单选框勾选后才确认），点 Start Migration 后报
`Migration backend is currently not available for this VPS. Please try again in 10-15 minutes. (Reference code: 734152)`
——迁移**未启动**，等 12 分钟重试仍同样报错（搬瓦工后端问题，非本 VPS 故障）。VM 数据与 IP 未受影响。

**实际解法（当天恢复可用）**：mihomo 的 `dialer-proxy` 链式转发——给 VPS-ChatGPT 节点加一行 `"dialer-proxy": "BoostNet"`（机场主选择组），
连接 VPS 的 TCP 先经机场当前选中节点出国、再从国外连 VPS。**ChatGPT 看到的出口仍是 VPS 固定 IP**（cdn-cgi/trace 实测 ip=104.129.181.52、colo=YVR），
不破坏固定出口纪律。代价：多一跳延迟 + 依赖机场可用性。

**验证**（2026-10-26 18:03）：7890 → chatgpt.com trace = 104.129.181.52；7899（proxy-fallback/Codex 路径）→ api.openai.com trace = 104.129.181.52；
重启后日志 18:02:35 起 VPS 连接零报错。

**后续考虑直连时**：先验证当前直连协议路径。若另行迁移，应核对面板条件并同步新 IP；旧迁移脚本的路径需复核。
当前覆写使用 `VPS-Hop`，旧 `dialerProxy` 代码已不适用；验证后再决定是否移除 `dialer-proxy`。

**顺带确认的事实**：
- VM 物理机房是 **CA Vancouver (CABC_1)**（面板 Physical Location + trace colo=YVR 双重印证；README 原记录"洛杉矶 USCA_2"已过时，IP 从未变过，疑为搬瓦工侧机房调整）
- 本机 `~/.ssh/config` 原先是空的、`~/.ssh/vps_chatgpt` 密钥不存在（与文档声明不符）；实际可用密钥是 `~/.ssh/id_rsa`（known_hosts 有 10-01 部署当天的记录）。已补 vps-chatgpt 条目，迁移换 IP 后记得同步 HostName
- 诊断技巧：TCP、ICMP 和外部测点对照可以缩小路径范围；还需验证监听协议、认证和目标请求，不能三步直接认定故障方。

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

## 问题 2：首个 IP 的代理路径失败（176.122.138.204，Fremont）

2026-10-01 记录：TCP 握手与 ClientHello 到达服务端，服务端发回数据，
客户端收到 reset；443/8443 测试失败而 SSH 22 正常。迁移后使用了 `104.129.181.52`。

这支持“路径或协议相关异常”的怀疑，但单侧抓包和两个端口测试不能锁定 GFW、整 IP 封锁或具体运营方。
需要两端抓包和相同条件的协议对照。历史迁移结果也不保证以后换 IP 必然有效或免费。

普通 HTTPS 探测只有在实际入站支持该 TLS/SNI 时才有解释价值：
成功可能只是 Reality 的未认证转发，不能证明 VLESS 可用；
失败可能是端口、SNI、协议、服务状态或路径问题，不能直接叫作“IP 被墙”。
当前 443 是无 TLS 的 HTTPUpgrade，不能套用旧的 HTTPS:443 探测命令。

---

## 问题 3：Reality 握手失败与 ML-KEM 兼容性

2026-10-01 的记录是：普通 TLS 可用，Xray 自环认证失败，换目标为
`www.lovelive-anime.jp` 后测试成功。旧文把它解释成“启用 ML-KEM 的网站必然不兼容 Reality”，
证据不足，现撤回这一通用结论；不应按微软、苹果、谷歌等域名归属禁用目标。

本次 2026-11-11 的可复现结果恰好说明客户端握手选项需要核对：
Xray 26.11.9 + Mihomo 1.19.32、chrome 指纹、正确 8443/公钥/short-id 下，
开启 `reality-opts.support-x25519mlkem768: true` 后同一路径恢复。
参见 [Mihomo TLS 文档](https://wiki.metacubex.one/config/proxies/tls/#reality-optssupport-x25519mlkem768)
和 [本轮对照实验](2026-11-11-PEIQIAN-DIAGNOSIS.md)。

排查时核对实际入站端口与协议、UUID/flow、公钥/short-id、SNI、时钟、指纹及版本兼容性。
公钥可在服务器用现有私钥派生校验，不要把私钥复制到客户端或日志中。
指纹矩阵失败不能排除所有握手兼容性问题。

自环测试是在服务器上运行客户端连接本机 Reality 入站（当前 8443），再通过它请求目标：
通过只证明这份本机客户端配置可用，不证明远端 Mihomo 同样可用；
失败仍可能涉及配置、DNS、回源目标、服务端出网或本机防火墙。
它排除了远端到 VPS 的一段路径，**没有排除全部网络因素**。

`deploy/desttest.sh` 依赖预建的 `/tmp/selftest.json`，假定首个入站为 Reality，
会改写正式配置并反复重启服务。它是历史实验脚本，须核对当前双入站并备份后才考虑使用。

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
- **外部编辑不等于运行配置更新**：需触发配置重新生成。2026-11-11 界面切换订阅/覆写开关即可生效；
  如没有更新，再重启对应内核或客户端。验证标志不只是时间戳，还要核对运行节点的端口、公钥、ML-KEM 与跳板。
- 数据目录不固定在 %APPDATA%，**以 mihomo.exe 命令行 `-d` 参数为准**
   （PowerShell：`Get-CimInstance Win32_Process -Filter "Name='mihomo.exe'" | Select-Object CommandLine`）。
- 覆写日志 `<id>.log` 出现 `脚本执行成功` 仅代表 JS 跑通，还需看 work/config.yaml 是否真的注入。
- 验证分流时注意：若终端设了 `HTTP_PROXY/HTTPS_PROXY` 环境变量（本机有别的代理占 7899），
  curl 加 `--noproxy "*"` 会**绕过显式代理**。测试时用 `curl.exe --noproxy "" --proxy http://127.0.0.1:7890 ...`，
  清空绕过列表，避免继承 NO_PROXY 影响结果。

---

## 小坑收集（工具链相关）

| 坑 | 解法 |
|---|---|
| `pkill -f "xxx"` 把当前 SSH 会话自己杀了（命令行里含同样字符串） | 用 `kill $PID` 或括号技巧 `pkill -f "xx[x]"` |
| Windows 原生 Python 读不了 Git Bash 的 `/tmp` 路径 | 用 `cat file \| python -c` 管道，或 `cygpath -w` 转换 |
| Git Bash 里中文输出乱码（GBK vs UTF-8） | 统一编码并核对文件内容；含中文的节点名必须逐字匹配，不能忽略乱码 |
| WebFetch/数据中心 IP 被目标站屏蔽 | 本地 `curl -x http://127.0.0.1:7890`（走用户自己的代理） |
| Windows curl 走不了系统代理 | 显式 `-x` 指定，socks 用 `--socks5-hostname`（远程解析域名） |
| SSH 报主机指纹变化或验证失败 | 在可信控制台核对指纹后更新 known_hosts；accept-new 不会接受已知主机的新指纹，也不能代替核对 |
| GitHub SSH 22 被 reset（push/pull 失败，不能仅凭 reset 确认过滤方） | 历史有效方式：`Host github.com` 下使用 `HostName ssh.github.com`、`Port 443`，正常核对主机指纹，2026-10-28 实测 |

---

## 可复用的诊断思路总结

1. **分层隔离**：客户端 → 网络去程 → 服务端 → 伪装站 → 回程，逐层找证据
2. **两端证据**：抓包、监听、配置与客户端日志相互印证；注意采集点和漏包限制
3. **自环测试**隔离远端到 VPS 的路径，但仍依赖本机配置与服务端出网
4. **单变量对照**：固定路径与版本，一次改变一个参数；普通 TLS、TCP 可达与完整代理请求分别验证
5. **对照源码**：GUI 程序的配置格式不确定时，直接看上游源码（本例 clash-party 的 override 机制）
