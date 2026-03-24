# LiteLLM + AWS Bedrock 多租户 AI API 网关 — 产品架构文档

**创建日期**: 2026-03-24  
**最后更新**: 2026-03-24（Bedrock 原生 API 支持评估）  
**状态**: 规划中

---

## 一、产品定位与核心价值

### 目标客户（ICP）

| 客户分层 | 典型画像 | 核心需求 | 预估 MRR |
|---------|---------|---------|----------|
| Tier 1 — 中大型企业 | 50-500 人研发团队，多 BU，有合规要求 | 统一管控、成本分摊、审计日志、SSO | $2,000-$10,000 |
| Tier 2 — AI-native 创业公司 ⭐ | 10-50 人，核心产品依赖 LLM | 模型路由、成本优化、高可用、低延迟 | $500-$2,000 |
| Tier 3 — 平台型公司 | 有下游客户，需要分发 AI 能力 | 多级租户、白标 API、细粒度计费 | $5,000-$20,000 |
| Tier 4 — 传统企业 IT | 刚开始探索 AI | 简单接入、预算控制、数据不出域 | $500-$1,500 |

> ⭐ **最佳初期 ICP**：Tier 2（AI-native 创业公司）

### 核心差异化

1. **Bedrock 原生深度集成** — 支持 Provisioned Throughput、Guardrails、Custom Model 等 AWS 独有特性
2. **数据主权** — 可部署在客户自己的 VPC，数据不出域
3. **多租户原生架构** — 架构层面设计，不是 hack 出来的

### 商业模式

**Hybrid（SaaS 控制面 + 客户 VPC 数据面）**
- 平台订阅费 50% + 用量加成 30% + 增值服务 20%

---

## 二、功能需求

### MVP 功能（Phase 1，4-6 周）

| 模块 | 功能 |
|------|------|
| 多租户管理 | 租户 CRUD、数据库行级隔离、基础 RBAC（admin/member） |
| API 密钥 | 创建/撤销、关联租户 |
| 模型访问控制 | 按租户配置可用模型、模型别名映射 |
| 用量统计 | Token 用量记录（input/output）、按 Bedrock 定价算成本 |
| 限流配额 | 按 Key 的 RPM/TPM 限流、月度预算硬上限 |
| 日志 | 请求/响应日志（脱敏）、基础 Dashboard |
| 高可用 | 多 AZ 部署（2 AZ 起步）、健康检查 + 自动恢复 |
| 管理控制台 | Web UI 管理租户/Key/模型/用量 |

### Phase 2 新增（8-12 周）

密钥自动轮换、精细权限、账单生成（Stripe 集成）、高级限流（滑动窗口）、
告警系统（Webhook/飞书）、负载均衡 + 模型降级、Prompt 缓存、PII 检测、SSO（SAML/OIDC）

### Phase 3 高级特性

多级租户、A/B 测试框架、Prompt 版本管理、多云支持（Azure OpenAI / GCP Vertex）、白标方案

---

## 附：Bedrock 原生 API 格式支持评估

### 背景

LiteLLM 原生已支持调用 Bedrock 上的所有模型，并提供 OpenAI 兼容接口（覆盖 90% 用户需求）。
部分客户（已有大量 Bedrock 代码、需要用 Bedrock 特有参数）希望直接使用 **Bedrock 原生 API 格式**（`InvokeModel` / `InvokeModelWithResponseStream`）访问网关。

### LiteLLM 对 Bedrock 的原生支持范围

| 能力 | 支持情况 |
|------|---------|
| 调用 Bedrock 模型（Claude/Llama/Titan/Mistral 等）| ✅ 原生支持 |
| OpenAI 格式自动转换为 Bedrock 格式 | ✅ |
| Streaming 流式响应 | ✅ |
| Prompt Caching | ✅ |
| Bedrock Guardrails 集成 | ✅ |
| 跨 Region 路由（Cross-Region Inference）| ✅ |
| **客户用 Bedrock 原生格式调用网关** | ❌ 需额外开发 |
| Bedrock Managed Prompts | ❌ 需额外开发 |
| SageMaker 自定义模型 | ❌ 需额外开发 |

### 工作量拆解

| 子任务 | 工作量 | 说明 |
|--------|--------|------|
| Bedrock 原生 API 路由层 | 3-5 天 | 解析 `application/x-amz-json-1.1` 格式，识别模型 ARN，做请求透传 |
| SigV4 签名适配 | 2-3 天 | 处理客户侧 AWS SigV4 签名验证，或提供签名代理模式 |
| 多租户权限绑定 | 1-2 天 | 原生格式调用也需走租户 API Key 验证和配额限流 |
| 测试 + 文档 | 2-3 天 | |
| **合计** | **约 2 周** | |

### 建议

- **MVP / Phase 1**：仅支持 OpenAI 兼容接口，覆盖绝大多数场景
- **Phase 2**：加入 Bedrock 原生 API 格式支持，面向企业老客户迁移场景
- 参考实现：[AWS 官方 Guidance](https://github.com/aws-solutions-library-samples/guidance-for-multi-provider-generative-ai-gateway-on-aws) 已有类似实现，可借鉴

---

## 三、AWS 架构设计

### 整体架构图

```
Client (OpenAI SDK)
  → CloudFront (WAF + DDoS + TLS)
    → ALB (Path routing)
      ├── /v1/* → ECS Fargate — LiteLLM Proxy (Data Plane)
      └── /admin/* → ECS Fargate — Control Plane (Admin API + Web Console)

数据层：
  ECS Fargate
    ├── ElastiCache Redis (限流计数器 / Key 缓存 / Prompt 缓存)
    └── Aurora Serverless v2 PostgreSQL (核心数据存储)

调用层：
  LiteLLM → Amazon Bedrock
    (Claude 3/4 / Llama 3 / Titan / Mistral 等)

可观测性：
  CloudWatch Logs → Kinesis Firehose → S3 → Athena
  X-Ray (请求链路追踪)
```

### 关键组件选型

| 组件 | 选型 | 理由 |
|------|------|------|
| **计算层** | ECS Fargate | 无服务器运维，自动扩缩，LiteLLM 是 CPU-bound |
| **API 入口** | CloudFront + ALB | ALB 原生支持 WebSocket/SSE 流式；API Gateway 有 30s 超时限制不适用 |
| **核心数据库** | **Aurora Serverless v2 PostgreSQL** ✅ | 按 ACU 计费，冷启动成本低，自动扩缩，完全兼容 PostgreSQL / LiteLLM |
| **缓存** | ElastiCache Redis | API Key 验证缓存、限流计数器、租户配置缓存、Prompt 缓存 |
| **可观测性** | CloudWatch + X-Ray + Kinesis → S3 → Athena | 全链路追踪；长期日志用 Athena SQL 分析 |

### ECS Fargate 配置

- 每实例规格：2 vCPU / 4 GB Memory
- **起步：2 个 AZ**（MVP 阶段）
- 最小实例数：2（每 AZ 各 1 个）
- 自动扩缩：CPU 利用率目标 60%
- 扩展策略：Phase 2 可扩展至 3 AZ

### Aurora Serverless v2 配置

- 引擎：Aurora PostgreSQL（兼容 PostgreSQL 15+）
- **最小 ACU：0.5**（低流量时几乎零成本）
- **最大 ACU：16**（MVP 阶段上限，后期可调整）
- Multi-AZ：开启（Writer + Reader 跨 AZ）
- 存储：自动扩展，起步 10 GB

**数据库表结构（核心表）**：

| 表名 | 职责 |
|------|------|
| `tenants` | 租户元数据、配置 |
| `tenant_members` | 租户成员关系 |
| `api_keys` | 虚拟 API Key（hash 存储） |
| `model_configs` | 模型路由配置 |
| `tenant_model_access` | 租户可访问模型映射 |
| `usage_logs` | Token 用量记录（按月分区） |
| `audit_logs` | 操作审计（按月分区） |

### ElastiCache Redis 缓存策略

| 用途 | Key 模式 | TTL |
|------|---------|-----|
| API Key 验证缓存 | `key:{hash}` | 5 min |
| 限流计数器 | `ratelimit:{key}:{window}` | 窗口时长 |
| 租户配置缓存 | `tenant:{id}:config` | 10 min |
| Prompt 缓存 | `prompt:{hash}` | 可配置 |
| 模型健康状态 | `model:{name}:status` | 30s |

---

## 四、多租户隔离设计

| 维度 | MVP 方案 | 企业级升级 |
|------|---------|-----------|
| 数据隔离 | Shared DB + Row-Level Security（tenant_id） | 独立 DB Schema（大客户） |
| 网络隔离 | Shared VPC + 安全组隔离 | 独立 VPC（Phase 2） |
| Bedrock IAM | Shared Role + 动态 Tag 策略（`aws:RequestTag`）| Per-tenant IAM Role（Phase 2） |
| 成本归因 | AWS Cost Explorer 自定义 Tag（`tenant_id`）+ 应用层 Token 级精确计算 | 两层互补 |

---

## 五、关键技术挑战

### 1. LiteLLM 多租户
- ✅ 原生支持 Virtual Keys + Teams
- ⚠️ 企业级权限/计费/审计需要自研 Control Plane 包装层

### 2. Bedrock Quota 管理
- 每 Region 模型有 TPS 限制（Claude 3.5 Sonnet ≈ 50 TPS）
- 解决：多 Region 路由 + 跨账号 Bedrock 访问

### 3. 流式响应（Streaming SSE）
- ALB 原生支持 SSE，无需额外配置
- Redis 不缓存流式响应，仅缓存完整响应
- CloudFront 对流式请求禁用缓存

### 4. 高可用与扩缩容
- Fargate ECS Service: min=2（MVP），max=20
- Aurora Serverless v2 自动扩缩（0.5~16 ACU）
- Phase 2：增加数据库 Reader 实例分流查询

---

## 六、产品路线图

```
Phase 1 MVP（0-6周）
  核心代理 + 多租户 + API Key + 基础限流 + 用量统计 + Web Console
  部署：2 AZ，Aurora Serverless v2

Phase 2（7-18周）
  计费系统 + 告警 + Prompt 缓存 + SSO + 高级限流 + 多 Region
  扩展：3 AZ，Per-tenant IAM Role

Phase 3（19周+）
  多级租户 + 白标 + 多云 + A/B 测试 + AWS Marketplace 上架
```

---

## 七、成本估算（MVP，100 租户，日均 10 万请求）

| 资源 | 规格 | 月费用 |
|------|------|-------|
| ECS Fargate | 2 实例 × 2vCPU/4GB，2 AZ | ~$120 |
| Aurora Serverless v2 | 0.5~4 ACU，低流量为主 | ~$50-100 |
| ElastiCache Redis | cache.r6g.large | ~$120 |
| ALB | 按请求量 | ~$50 |
| CloudFront | 100K req/day | ~$30 |
| CloudWatch + X-Ray | 基础监控 | ~$50 |
| **基础设施小计** | | **~$420-470/月** |

> Bedrock 模型调用成本另算，需转嫁给租户。

### LiteLLM 开源 vs Enterprise

| 维度 | 开源版（免费）| Enterprise（$20k+/年）|
|------|-------------|----------------------|
| 核心代理 | ✅ | ✅ |
| Virtual Keys / Teams | ✅ | ✅ |
| SSO / SAML | ❌ 需自研 | ✅ |
| 细粒度审计 | ❌ | ✅ |
| 合规报告 | ❌ | ✅ |
| **建议** | **MVP 及 Phase 2 使用** | **Phase 3 或企业客户再评估** |

---

## 八、架构决策记录（ADR）

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-03-24 | ECS Fargate 从 2 AZ 起步（非 3 AZ）| MVP 阶段降低成本，后期扩展至 3 AZ |
| 2026-03-24 | 数据库使用 Aurora Serverless v2（非 RDS PostgreSQL）| 按需计费，低流量成本更低（$50 vs $240）；自动扩缩更灵活 |
| 2026-03-24 | API 入口用 CloudFront + ALB（非 API Gateway）| API Gateway 30s 超时限制，不适合长 LLM 响应；ALB 原生支持 SSE |
| 2026-03-24 | Bedrock 原生 API 格式支持推迟到 Phase 2 | MVP 聚焦 OpenAI 兼容接口；原生格式约 2 周工作量，价值有限 |

---

*文档持续更新中，每次架构决策需记录到 ADR 表格*
