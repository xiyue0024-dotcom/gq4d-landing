# GARUDA QUANTUM 4D — 落地页与进线拦截

印尼市场广告落地页 + WhatsApp 进线拦截系统。前端静态页采集信号，后端做名单比对与评分判定，账号仅在判定通过时下发。

## 结构

```
index.html                     落地页（前端探针、问卷、跳转判定）
apps-script/落地页拦截/
  src/1_Config.gs              配置、表头、通用工具
  src/2_Gate.gs                入口、编排、日志、账号下发
  src/3_Risk.gs                名单、信号、评分、短窗聚集
  src/4_Admin.gs               管理端读写
  src/管理端.html              管理页
cloudflare/
  ip-echo-worker.js            边缘网关：/ip 与 /api/gate
  wrangler.toml                Worker 配置（不含密钥）
变更对照.md                    改动记录与契约
风险评估与加固清单.md          威胁模型与加固方案
部署配置.md                    部署标识与变量（不含密钥）
```

## 判定流程

1. 前端采集设备、指纹、IP/ASN、行为与 Fingerprint 信号；
2. 点击 CTA 时请求判定（JSONP 直连 Apps Script，或经 Worker 代理）；
3. 后端执行：硬拒项 → 评分（≥60 拒）→ 放行；
4. 放行才返回 WhatsApp 号码，拒绝统一返回「网络繁忙」。

## 部署要点

- Apps Script：`clasp push`，脚本属性见 `部署配置.md`；
- Worker：`wrangler deploy`，密钥用 `wrangler secret put GATE_SECRET`，不入库；
- 前端：`CONFIG.gateMode` 决定走 `jsonp` 还是 `worker`。

## 安全约定

- 不提交任何密钥、`.gate-secret.txt`、`.clasprc.json`；
- `Daftar Hitam` 为只读共享表，本系统不写入；
- 日志含号码等个人信息，保留 90 天，访问需授权。
