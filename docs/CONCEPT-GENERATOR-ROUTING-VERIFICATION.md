# concept-generator VPS 链路验证

验证时间：2026-11-03 16:19–16:25（Asia/Shanghai）。本机 Node v24.11.1，Mihomo v1.19.32。

## 已部署

`concept-generator → 127.0.0.1:17899（Mihomo）→ VPS-Hop → VPS-ChatGPT（104.129.181.52）→ GPT/附件服务器`

- 17899 仅监听 127.0.0.1，listener 为 `concept-generator-vps`，固定 `proxy: VPS-ChatGPT`。
- `VPS-ChatGPT` 使用 `dialer-proxy: VPS-Hop`。本次选中 `🇯🇵AWS日本01 | 电信移动联通推荐`；跳板域名解析为 13.158.18.234 / 52.199.94.39，Mihomo 实际 TCP 连接中存在这两个地址的 443 连接。
- 源码覆写与 Clash 启用覆写 SHA256 一致：`2775382BB2D3E8DE2A1B193E81DC7BB6A893D8FE353288F3D44F2E460088F458`。
- 18788 工具服务已重启。旧 stdio MCP 进程已停用；旧客户端重新加载 MCP 或新开聊天后使用新版，新 stdio 客户端的六个工具发现和状态调用已实测通过。
- 没有活跃生成任务被中断；原有 7890/7899 监听保持工作。

## 实测结果

| 状态 | 实际 GPT 请求 | GPT/OpenAI trace | 附件请求 | 进程 TCP 采样 |
|---|---|---|---|---|
| 正常 | 返回 `{"route_probe":"ok"}`，整轮 6.827 秒 | 两者 HTTP 200，IP=104.129.181.52，colo=YVR | 两类允许域均命中专用入口和 VPS-ChatGPT，目标返回 HTTP 404 | 只连接本机 17899/18788 |
| 删除专用监听器 | 在测试设定的 20 秒期限失败 | ECONNREFUSED | 明确下载失败 | Codex 重试仅指向本机 17899，无公网/其他代理连接 |
| 专用监听器设为 REJECT | 在测试设定的 20 秒期限失败 | ECONNRESET | 明确下载失败；采样捕获 REJECT 链 | 无公网/其他代理连接 |
| 恢复 | 再次返回成功，整轮 6.933 秒 | 两者重新 HTTP 200，IP 不变 | 重新经 VPS 到达目标 | 只连接本机 17899/18788 |

测试故意设置错误的继承 HTTPS_PROXY 和 `NO_PROXY=*`，实际启动的 Codex 子进程仍使用固定 17899 和仅回环 NO_PROXY。TCP 采样结合生产代码无回退分支及回归测试，确认本次两类故障未发生降级直连。

真实 GPT 验证调用工具生产 `createCodexClient().request`，复用生成所用桥接；未额外调用图片生成。附件通过生产 `downloadImage` 请求 `files.oaiusercontent.com` 和 `openaipublic.blob.core.windows.net`，404 证明 TLS/HTTP 到达目标并验证路由，未声称下载到了私有图片。重定向与成功图片字节处理由单元测试覆盖。

## 检查与证据

- concept-generator：33 项测试全部通过，19 个 JavaScript 文件语法检查通过。
- `node E:/vps/client/test-routing.cjs` 通过：固定 listener、原分流顺序、旧 7899 保护域故障禁止直连。
- Mihomo `-t` 配置校验通过。测试后的工作配置与 enabled 备份哈希一致，专用入口已恢复。
- 原始结果：`E:/project_A1/project_A1/work-flow/concept-generator/.local/vps-verification-{healthy,offline,reject,restored}.json`。
- 本机诊断脚本在同一 `.local` 目录；含本次固定路径/管道，重新运行前须核对当前进程和配置。
- 备份：`E:/vps/backups/20261103-concept-generator-vps/`。包含本机代理配置，仅本地保留，未提交。

本次验证不包含 VPS SSH 运维状态、重启整台电脑、私有附件内容下载或完整生图质量验收。

## 改动范围

- `E:/vps/`：`client/clash-party-override.js`、`client/test-routing.cjs`、`README.md` 和本验证记录；部署副本为 Clash 数据目录下的覆写与工作配置。
- `E:/project_A1/project_A1/work-flow/concept-generator/`：新增 `lib/vps-proxy.cjs`、`tests/proxy.test.cjs`；修改 `lib/codex-client.cjs`、`mcp-tools.cjs`、`tests/codex-client.test.cjs`、`package.json`、`package-lock.json`、`README.md`。
- 工程 Trellis：工具契约、该任务归档、会话 journal/index。另一个会话产生的技能登记文档和归档、以及 VPS 仓库已有的 `mp_profile.ts`、`mp_profiles.ts`、`mp_serv.ts` 均未修改。
