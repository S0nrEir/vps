# 2026-11-11 赔钱机场链路修复

> 本文记录当日链路修复阶段的配置和证据。后续安全加固已关闭未加密 443 备用入口，
> 当前只保留 8443 Reality；普通机场主组改用 AWS日本01。最新状态及重启后测试见
> [安全加固记录](2026-11-11-SECURITY-HARDENING.md)，下文 443 配置仅供历史复盘。

已恢复并验证：`本机 → 赔钱机场 AWS日本01 → VPS 104.129.181.52:8443 → ChatGPT`。
正式 Clash Party 当前选中赔钱机场，VPS 全局覆写开启。BoostNet 的连通结果未作为验证依据。

## 确认的原因

1. **本机安装的覆写未同步。** 实际安装副本仍是旧公钥 `A3LmS9…`，且缺少
   `dialer-proxy`/`VPS-Hop`；仓库脚本则使用 `IOied7…`。
2. **端口与协议错配。** SSH 读取 Xray 实际加载的 `/usr/local/etc/xray/config.json`，
   确认 8443 是 VLESS + Reality，443 是 VLESS + HTTPUpgrade（`/hub7q`、Host `www.bing.com`）。
   本机旧安装副本仍使用 443 + Reality，远端仓库则已有切到 8443 的提交，不能混为一谈。
   服务端配置修改时间为 07:56:54 UTC，进程启动为 08:42:50 UTC；结合启动参数和监听确认读取的是生效配置。
3. **缺少 ML-KEM 握手选项。** 服务端 Xray 26.11.9 与本机 Mihomo 1.19.32 组合下，
   8443、正确公钥、short-id 和 chrome 指纹仍认证失败；只增加
   `reality-opts.support-x25519mlkem768: true` 后，同一赔钱机场 AWS 日本 01 路径立即成功。
   公钥通过服务器现有私钥派生核对，私钥未传回本机。

该字段见 [Mihomo 官方 TLS 配置文档](https://wiki.metacubex.one/config/proxies/tls/#reality-optssupport-x25519mlkem768)。
与新 Xray 的兼容性问题另见[上游问题记录](https://github.com/MetaCubeX/mihomo/issues/3241)。
本次以实机对照结果确认修复，不依赖“等待机场恢复”的推测。

## 遇到的问题与处理办法

| 问题 | 证据与处理 |
|---|---|
| 电脑控制报“本机管道不存在” | 属于本机控制工具通道故障，不能用来判断 VPS；工具恢复后重新观察界面并接管 |
| SSH 重装后主机指纹变化 | 在已登录控制台核对公开指纹，再备份并更新 known_hosts |
| 补公钥后仍 Permission denied | 网页 basic shell 把多行命令拼接，实际没有写入；改单条提交，保留已有授权并补回本机公钥后登录成功 |
| 仓库已更新但本机仍失败 | 对照仓库、安装覆写和 work/config.yaml 三层；同步安装副本并通过界面触发配置重新生成 |
| 443 + Reality 失败 | 当时 443 是 HTTPUpgrade，主用 Reality 改为服务端实际监听的 8443 |
| 8443、新公钥仍认证失败 | 同一跳板只改变 ML-KEM 开关做对照：关闭失败，开启后 trace 成功；保留 chrome 指纹 |
| 将 Authentication true 当作 VPS 成功 | 外层机场也用 Reality；结合连接目标、完整链路和最终 trace 判断 |
| 覆写开启后仍有机场出口连接 | 清理 11 条旧连接，重新检查：13 条受保护域名连接均走 VPS |
| HTTPUpgrade 客户端配置方式不明确 | Mihomo 使用 network=ws，ws-opts 中开启 v2ray-http-upgrade，不能直接把 network 写成 httpupgrade |

历史备用 443 的隔离测试参数（当时未替换主用 Reality；该入口现已关闭）：

```yaml
type: vless
server: 104.129.181.52
port: 443
uuid: b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e
network: ws
tls: false
ws-opts:
  path: /hub7q
  headers:
    Host: www.bing.com
  v2ray-http-upgrade: true
dialer-proxy: VPS-Hop
```

此片段不设置 flow 或 reality-opts，依赖已存在的 VPS-Hop；完整配置仍需节点名和路由。
字段依据：[Mihomo 传输层配置](https://wiki.metacubex.one/config/proxies/transport/)。

## 实施内容

- 同步仓库覆写和本机安装副本：8443、新公钥、chrome、ML-KEM 开关、`dialer-proxy: VPS-Hop`。
- 同步 `client/clash-chatgpt.yaml` 和 `client/boostnet-chain/config.yaml` 中的 VPS 参数；
  后者仅做参数同步，本次没有验证 BoostNet 路径。
- 在 Clash Party 切换赔钱机场，启用 VPS 全局覆写；`VPS-Hop` 实际选中
  `🇯🇵AWS日本01 | 电信移动联通推荐`。
- 关闭 11 条启用覆写前建立、仍走机场出口的 OpenAI/ChatGPT 旧连接，让它们按新规则重连。
- 服务端现有 Xray 配置和版本保持原样；未重装、换 IP、换钥或降级内核。
- SSH 直连 22 实测可用。用户通过已登录 VPS 控制台核对了重装后的主机指纹：
  `SHA256:cc/g+qJhcNcZ2+d6X9RBcy3JMJuRHR9d1eafEEEojO4`。
  已更新本机 known_hosts，恢复本机 `~/.ssh/vps_chatgpt` 公钥授权。
  先前手工多行命令被 basic shell 拼接，实际没有添加公钥；改单条提交后 SSH 成功。

## 验证结果

| 检查 | 结果 |
|---|---|
| 正式入口 7890 → chatgpt.com/cdn-cgi/trace，连续 5 次新连接 | 5/5 成功，全部 `ip=104.129.181.52`、`colo=YVR` |
| 专用入口 17899 → api.openai.com/cdn-cgi/trace | 成功，`ip=104.129.181.52`、`colo=YVR` |
| 普通网站经正式入口 7890 → Cloudflare trace | 机场出口 `67.159.48.149`、`colo=SIN`，分流正常 |
| Mihomo 实际运行配置 | 赔钱机场订阅、VPS:8443、ML-KEM=true、VPS-Hop 存在 |
| Codex 连接记录 | `ProcessName / Codex.exe → VPS-ChatGPT` |
| 清理旧连接后的实时检查 | 13 条受保护域名连接全部走 VPS-ChatGPT，其它出口 0 条 |
| 现有 `node client/test-routing.cjs` | 通过：内网优先、受保护域名一致、代理故障不回退直连 |

隔离测试还确认当时的 443 HTTPUpgrade 配置可以经赔钱机场访问 ChatGPT，但正式链路使用 8443 Reality。
这些是本轮即时连通性结果，不代表所有机场节点或未来每条连接都已验证。
隔离测试实例已结束，临时节点凭据副本已删除；本机正式 Clash Party 持续运行。

## 更正旧文档结论

“机场概率性篡改 Reality ClientHello”的结论撤回，本轮没有该证据。
机场节点自身也使用 Reality，链式日志中的 `Authentication: true/false` 必须结合具体连接判断；
不能把机场握手成功当成 VPS 握手成功。服务端自环通过也不能证明远端客户端参数兼容。
“22 入站一定被 BWH 封锁”也不适用于当前状态，本机已直接通过 SSH 完成读配置。

同步勘误还包括：撤回“ML-KEM 目标站必然失败”的通用结论；区分手工编辑与配置重新生成；
将“部署脚本幂等”改为“会换凭据并覆盖配置”；给历史 BoostNet、7899 和完整生成流程测试标注日期及验证边界。
本次合并了远端 `d5425f9` 的双端口部署事实，纠正其“反二级代理已定案”的归因，没有覆盖掉远端提交。

## 备份与复查

修改前本机安装覆写、覆写开关与订阅选择的备份位于：
`E:/clash party/data/backups/20261111-peiqian-repair`。
订阅文件包含凭据，备份留在 Clash Party 数据目录，不放入仓库。
known_hosts 原文件备份：
`C:/Users/x7390/.ssh/known_hosts.pre-vps-reinstall-20261111-165451.bak`。

复查命令：

```powershell
curl.exe --max-time 30 --noproxy "" --proxy http://127.0.0.1:7890 https://chatgpt.com/cdn-cgi/trace
curl.exe --max-time 30 --noproxy "" --proxy http://127.0.0.1:17899 https://api.openai.com/cdn-cgi/trace
ssh vps-chatgpt
```

前两项的 `ip` 都应为 `104.129.181.52`。如再次失败，先核对当前订阅、运行配置和跳板选择，
再检查服务端实际入站；不要仅根据旧文档端口或单条握手日志换协议、换密钥或重装。
