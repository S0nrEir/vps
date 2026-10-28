// Clash Party (Mihomo Party) 覆写脚本：ChatGPT 流量走自建 VPS，其余保持原有订阅行为
// 用法：Clash Party → 覆写 → 新建 → JavaScript → 导入本文件 → 打开"全局"开关 → 重启 Clash Party
function main(config) {
  // 先放行公司内网，再识别桌面进程，覆盖第三方资源和公网 IP 请求。
  config["find-process-mode"] = "always";

  const groups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  // 主选择组动态解析: 优先 BoostNet 组 → 第一个 select 组(通常是"节点选择") → 无
  const mainGroup =
    groups.find((g) => g && g.name === "BoostNet")?.name ||
    groups.find((g) => g && g.type === "select")?.name ||
    "";
  const nodeNames = (config.proxies || []).map((p) => p && p.name).filter(Boolean);
  const groupNames = groups.map((g) => g && g.name).filter(Boolean);

  // 1) VPS-Hop: 连 VPS 专用的跳板组, 与主选择组解耦。
  // 2026-10-28 实测(赔钱机场订阅): 多数美国节点(圣何塞/洛杉矶全系/美国01|下载)与部分日本节点
  // (东京06)经 mihomo API 端到端测 VPS 443 返回 503(Reality 握手被掐); 而 AWS日本01、美国01-0.1倍、
  // 新加坡|高速专线-hy2、台湾、日本节点组(199ms)、狮城节点组(244ms) 可通。此前 dialer-proxy 挂在
  // 主选择组上, 用户主选节点或订阅自动刷新选中不可达节点时 ChatGPT 全断(VPN 看似正常) —— 故单列此组。
  // 成员按订阅实际存在的名字过滤(换订阅不会校验失败); 全部不存在时退回主选择组, 再退回 DIRECT。
  const hopPrefs = [
    /AWS日本01/,
    /美国01-0\.1倍/,
    /新加坡 \| 高速专线-hy2/,
    /台湾/,
    /日本节点/,
    /狮城节点/,
  ];
  const allNames = nodeNames.concat(groupNames);
  const seen = new Set();
  const hopMembers = [];
  for (const re of hopPrefs) {
    for (const n of allNames) {
      if (re.test(n) && !seen.has(n)) {
        seen.add(n);
        hopMembers.push(n);
      }
    }
  }
  if (mainGroup && !seen.has(mainGroup)) hopMembers.push(mainGroup);
  if (!hopMembers.length) hopMembers.push("DIRECT");
  groups.push({ name: "VPS-Hop", type: "select", proxies: hopMembers });
  config["proxy-groups"] = groups;

  // 2) 注入自建 VPS 节点
  config.proxies = config.proxies || [];
  config.proxies.push({
    name: "VPS-ChatGPT",
    type: "vless",
    server: "104.129.181.52",
    port: 443,
    uuid: "b81fb09f-1e21-4f8d-ade9-58e2f3a3cd0e",
    network: "tcp",
    udp: true,
    tls: true,
    flow: "xtls-rprx-vision",
    servername: "www.lovelive-anime.jp",
    "client-fingerprint": "chrome",
    "reality-opts": {
      "public-key": "A3LmS90cDeGfw5Qv1oVwax8WQOxXkPhdjJGKB8x7k20",
      "short-id": "4ea0c2144409a72b",
    },
    // dialer-proxy 历程:
    // 2026-10-26: VPS IP 被 GFW 封锁(TCP级, 22/443直连超时), 加 dialer-proxy 经机场出国再连 VPS,
    //   ChatGPT 出口仍是 VPS 固定 IP, 不破坏固定出口纪律。迁移换新 IP 后删除 dialer-proxy 即恢复直连。
    // 2026-10-28: 不再硬编码 "BoostNet"(只有 BoostNet 订阅有该组, 换订阅必炸), 改动态解析主选择组。
    // 2026-10-28 晚: 主选择组与 VPS 可达性耦合仍是隐患(主选节点到不了 VPS → ChatGPT 全断), 改为
    //   专用 VPS-Hop 组, 默认选中实测可达节点, 主选择组随便怎么切都不影响 ChatGPT 链路。
    "dialer-proxy": "VPS-Hop",
  });

  // 3) 公司内网域名直连：订阅最后的 MATCH 兜底会把 *.cyou-inc.com 送去代理节点，
  //    节点在公网连不到 10.x 内网，mihomo 拨号失败后给浏览器回 502。放最前面优先直连。
  config.rules = config.rules || [];
  config.rules.unshift(
    "DOMAIN-SUFFIX,cyou-inc.com,DIRECT",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR6,fc00::/7,DIRECT,no-resolve",
    "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "PROCESS-NAME,ChatGPT.exe,VPS-ChatGPT",
    "PROCESS-NAME,Codex.exe,VPS-ChatGPT",
    "PROCESS-NAME,codex.exe,VPS-ChatGPT",
    "DOMAIN-SUFFIX,chatgpt.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,chatgpt.site,VPS-ChatGPT",
    "DOMAIN-SUFFIX,chatgpt-team.site,VPS-ChatGPT",
    "DOMAIN-SUFFIX,openai.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,oaistatic.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,oaistatsig.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,oaiusercontent.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,sora.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,openaiapi-site.azureedge.net,VPS-ChatGPT",
    "DOMAIN-SUFFIX,auth0.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,livekit.cloud,VPS-ChatGPT",
    "DOMAIN-SUFFIX,challenges.cloudflare.com,VPS-ChatGPT",
    "DOMAIN-SUFFIX,featuregates.org,VPS-ChatGPT",
    "DOMAIN-SUFFIX,statsig.com,VPS-ChatGPT"
  );

  return config;
}
