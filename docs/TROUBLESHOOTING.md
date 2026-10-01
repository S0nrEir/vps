# 部署问题全记录（2026-10-01 实战排查日志）

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
