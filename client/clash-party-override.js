// Clash Party (Mihomo Party) 覆写脚本：ChatGPT 流量走自建 VPS，其余保持原有订阅行为
// 用法：Clash Party → 覆写 → 新建 → JavaScript → 导入本文件 → 应用到你的机场订阅
function main(config) {
  // 先放行公司内网，再识别桌面进程，覆盖第三方资源和公网 IP 请求。
  config["find-process-mode"] = "always";
  // 1) 注入自建 VPS 节点
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
      "short-id": "4ea0c2144409a72b"
    }
  });

  // 2) 公司内网域名直连：订阅最后的 MATCH,BoostNet 兜底会把 *.cyou-inc.com 送去代理节点，
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
