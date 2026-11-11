# 2026-11-11 VPS 安全加固与分流复测

本记录对应 2026-11-11 17:35–17:50 的实施与验证，时间为 Asia/Shanghai。

目标：在当日已重装的 Ubuntu 24.04 VPS 上降低再次被滥用于群发邮件的风险，保持
`本机 → 赔钱机场 → VPS:8443 → ChatGPT`，其他流量继续按订阅走机场或直连。

## 初始实机状态

- 主机指纹与此前核对一致；SSH 密码登录已关闭，主用公钥登录可用。
- 原 `smtp-block.service` 已封 IPv4/IPv6 的 25/465/587/2525，但入站默认 ACCEPT；
  `/etc/iptables/rules.v4`、`rules.v6` 尚未保存这些规则，另有晚于网络启动的独立 unit。
- Xray 使用普通 `xray` 账户，但仍有 `CAP_NET_ADMIN`、`CAP_NET_RAW`、`CAP_NET_BIND_SERVICE`。
- 8443 是正式 Reality 入站；443 HTTPUpgrade 无 TLS，是排障时保留的备用入口。
- 抽查当前成功 SSH 登录均为本机已知密钥；未见原 `at` 队列/`netstat_probe` 文件。
  这不是完整取证，也不能证明所有持久化入口都已排除。
- `yhc-vps-20261111` 公钥经用户确认属于另一台设备，按要求保留；本机公钥也保留。

## 已实施

1. **入站与邮件防火墙**：IPv4/IPv6 默认丢弃入站与转发，仅放行 TCP 22、8443、已建立连接、
   回环，以及维持网络所需的 ICMP/IPv6 ICMP 与 DHCP 回包。
   出站保留正常联网，阻断 TCP/UDP 25、465、587、2525，TCP 拦截附带限速日志。
   Xray 路由也将这些目标端口送入 blackhole。
2. **启动持久化**：规则保存到 `/etc/iptables/rules.v4`、`rules.v6`，由
   `netfilter-persistent` 在 `network-pre.target` 之前加载。旧 `smtp-block.service` 已禁用，
   避免重复追加。当前规则已从保存文件重新加载并检查。
3. **减少代理进程权限**：关闭 443 HTTPUpgrade；保留原 8443 Reality 参数。
   `90-vps-hardening.conf` 清空 capability/ambient capability，启用只读系统目录、隐藏 home、
   私有 tmp/设备、禁止提权及内核/控制组修改等 systemd 限制。
   进程实际 UID 为 992，`CapEff/CapBnd/CapAmb` 均为零。
4. **SSH 与防爆破**：显式强制 publickey，认证最多 3 次，认证等待 30 秒，禁用 SSH 转发和 X11。
   锁定遗留 root 密码，保留两把已确认的公钥。部署 Fail2ban sshd jail：10 分钟内 5 次失败封 1 小时，
   重复失败递增至最多 1 天。SSH 仍在 22，未限制为某个可能变化的家庭 IP。
5. **持久日志与补丁**：启用磁盘 journal，最多 100 MB/14 天；屏蔽原攻击曾使用的 `atd.service`。
   安装 unattended-upgrades，启用每天安全更新，禁止自动重启。本轮 Ubuntu 安全更新成功完成，
   OpenSSH 升到 `1:9.6p1-3ubuntu13.20`，并受控重启至 `6.8.0-147-generic` 内核。

重启后验证：SSH、Xray、netfilter-persistent、Fail2ban 自动恢复；IPv4/IPv6 防火墙与零 capability
限制仍生效。IPv4 四个 SMTP 端口均立即拒绝；无公网 IPv6 地址，IPv6 使用 eth0 链路本地目标进行
测试，四个端口均立即拒绝、REJECT 计数增加。未发送邮件。Fail2ban 用文档保留地址
`192.0.2.123`、`2001:db8::123` 验证真实 v4/v6 封禁链，随后撤销测试封禁。

启动时另发现镜像配置 `auto eth1`，但虚拟机仅有 eth0，导致 networking.service 报不存在设备。
备份后将 eth1 改为 `allow-hotplug`，保留未来私网网卡配置；没有拆除或重启正在工作的 eth0。
执行 `ifup --no-act -a` 检查后启动 networking.service 成功；最终失败 unit 为 0，
`/var/run/reboot-required` 不存在，默认路由及代理复测均正常。

主机防火墙无法阻止重新获得 root 或管理面板控制权的攻击者主动关闭防护，也不能辨识所有
HTTPS 邮件 API 或非标准端口上的滥用。管理面板和终端设备的凭据仍需要保护。

## 分流检查

实际 Clash Party 覆写与运行 YAML 的 SHA256 在主机加固前后保持一致，未改客户端分流规则：

- 覆写：`EE1D258D5A5D874C33E3B3A1A1B9933456BA78F31153B99B377F161FB143C637`
- 运行 YAML：`60D9C425784486135316105415361C07BFE484FA935A17666503366D17AB1A6E`

17:37–17:40 普通外网失败，Mihomo 日志明确显示请求走机场新加坡节点，机场服务器拨号超时，
未经过 VPS。主选择组 `🚀节点选择` 从 `🇸🇬狮城节点` 改到已验证的
`🇯🇵AWS日本01 | 电信移动联通推荐` 后恢复。`VPS-Hop` 仍独立选 AWS日本01。
这是普通机场节点选择的变更，非将普通流量改走 VPS。
运行配置 `profile.store-selected: true`，节点选择由 Mihomo 持久保存。

17:41 实测：

| 检查 | 结果 |
|---|---|
| 7890 → ChatGPT trace | `104.129.181.52` / YVR |
| 17899 → API trace | `104.129.181.52` / YVR |
| 7890 → 普通 Cloudflare trace | `3.112.24.243` / NRT，机场出口 |
| 实时 ChatGPT / API 规则 | `DomainSuffix → VPS-ChatGPT` |
| 实时普通外网规则 | `Match → 漏网之鱼 → 节点选择 → AWS日本01` |
| 实时公司域名规则 | `DomainSuffix(cyou-inc.com) → DIRECT` |
| 实时百度规则与 HTTPS | `DomainSuffix(baidu.com) → DIRECT`；HTTP 200 |
| 受保护域名连接抽查 | 12 条，绕过 VPS 为 0 |
| 已有规则回归测试 | 通过，包括内网优先及故障不回退直连 |

17:47–17:48 重启后复测：7890 的 ChatGPT trace 连续 5/5 均为 VPS IP；17899 的 API trace 为
VPS IP；普通 Cloudflare 仍是 `3.112.24.243` / NRT；公司域名/百度实时连接仍为 DIRECT。
受保护连接快照为 11 条，绕过 VPS 为 0。旧文档中的可选 7899 转发器当前未监听，本轮未启动它，
不能将 7899 记为验证成功；当前已验证的入口是 7890、17899。

公司域名的 DIRECT 路由已验证；其 HTTP 80 端口曾超时，不能据此声称公司业务服务可用。
Windows 防火墙、TUN 和系统代理策略未改变；上述结果只涵盖已进入代理的流量及本轮抽样。

## 复查与恢复

### 配置落点与脚本范围

| 配置 | 用途 |
|---|---|
| `/etc/ssh/sshd_config.d/00-vps-hardening.conf` | 公钥认证、认证限额与禁用转发 |
| `/etc/systemd/system/xray.service.d/90-vps-hardening.conf` | 零 capability、只读系统目录和其他进程限制 |
| `/usr/local/etc/xray/config.json` | 单个 8443 Reality 入站、邮件端口 blackhole |
| `/etc/iptables/rules.v4`、`rules.v6` | 由 netfilter-persistent 加载的静态防火墙 |
| `/etc/fail2ban/jail.d/vps-sshd.local` | sshd jail；systemd 日志后端、iptables-multiport 封禁 |
| `/etc/apt/apt.conf.d/52-vps-security` | 每日更新索引和安全包、禁止自动重启 |
| `/etc/systemd/journald.conf.d/60-vps-security.conf` | persistent、SystemMaxUse=100M、SystemKeepFree=500M、MaxRetentionSec=14day |
| `/etc/network/interfaces` | eth0 DHCP；不存在的 eth1 改为 allow-hotplug |

`deploy/harden-vps.sh` 只覆盖网络/SSH/Xray 加固和屏蔽 atd；不会安装或配置 Fail2ban、
unattended-upgrades、持久 journal，不会锁定 root 密码，也不会调整 eth1。
脚本针对本项目已核对的 Ubuntu 主机，会替换 IPv4/IPv6 的 filter 表；有额外服务、容器或自定义
防火墙时必须先审查，不能直接运行。要求公钥 SSH 已可用、现有 Xray 账户/目录与端口已核对。

当时使用 PowerShell 经 SSH 传输脚本，并清除 CRLF 中的 CR，避免 bash 把回车当成参数：

```powershell
Get-Content -Raw -LiteralPath 'deploy/harden-vps.sh' |
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes vps-chatgpt "tr -d '\r' | bash -s"
```

脚本会启用 10 分钟自动回滚。执行后应另开 SSH 连接，并完成下面的代理出口测试；
**只有验证成功后**才在服务器运行 `systemctl stop vps-hardening-rollback.timer`。
不要在未验证的情况下停用计时器。本轮已完成验证并停用，当前无需重新运行脚本。

### 日常复查

```powershell
ssh vps-chatgpt
node client/test-routing.cjs
node client/verify-live-routing.cjs '<当前 Mihomo 控制管道>'
curl.exe --noproxy "" --proxy http://127.0.0.1:7890 https://chatgpt.com/cdn-cgi/trace
curl.exe --noproxy "" --proxy http://127.0.0.1:17899 https://api.openai.com/cdn-cgi/trace
curl.exe --noproxy "" --proxy http://127.0.0.1:7890 https://www.cloudflare.com/cdn-cgi/trace
```

服务器查看拦截：`journalctl -k -g SMTPBLK`；防爆破：`fail2ban-client status sshd`。
保存防火墙时不要把临时 Fail2ban 封禁链写入启动规则。重新加载静态规则后应重启 Fail2ban 以恢复动态链。

原主机配置备份仅留在服务器 root 目录：`/root/vps-hardening-20261111T093524Z`（0700）。
备份包含私钥配置，不能提交仓库。`rollback.sh` 可恢复本轮入站、SSH 片段与 Xray 配置；
自动回滚计时器在独立 SSH 和代理测试成功后已停止。回滚将重新开放旧 443，应仅用于紧急恢复。
备份不用于降级安全补丁，也不会自动解锁 root 密码或撤销后装的安全服务。
回滚脚本不撤销 eth1 配置修正；原 `/etc/network/interfaces` 另存于同一备份树中。

最后检查时 KiwiVM 尚未启用双重验证，浏览器留在该设置说明页。需用户用自己的验证器绑定并妥善保存恢复码。
本轮未更改面板密码、SSH 公钥或客户端节点认证参数。

配置语义参考：[Ubuntu OpenSSH 配置](https://ubuntu.com/server/docs/how-to/security/openssh-server/)、
[Xray 路由规则](https://xtls.github.io/en/config/routing.html)。具体实施与结果以上述实机检查为准。
