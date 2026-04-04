# 🎵 Audio Summary - Serverless 音频转录与摘要服务

完全基于 AWS Serverless 架构的音频转录和 AI 摘要生成服务。上传音频文件，自动转录为文本并生成智能摘要。

## 🏗️ 架构

```
用户浏览器
    ↓
CloudFront (CDN + HTTPS 静态前端)
    ↓
API Gateway (REST API + Cognito 认证)
    ↓
Lambda 函数
    ├── upload-handler: 处理上传（生成 S3 预签名 URL）
    ├── start-transcribe: 启动转录任务
    ├── task-query: 查询任务状态
    ├── get-audio-url: 获取音频播放链接
    └── transcribe-processor: 处理转录结果 + AI 摘要
    ↓
AWS 服务
    ├── S3: 音频文件存储
    ├── DynamoDB: 任务记录
    ├── AWS Transcribe: 语音转文本
    ├── EventBridge: 事件驱动
    └── AWS Bedrock (Claude): AI 摘要生成
```

## ✨ 特性

- ✅ **完全 Serverless** — 零运维，按需自动扩展
- ✅ **按需付费** — 不使用不花钱
- ✅ **Cognito 认证** — 用户注册/登录，JWT 鉴权
- ✅ **多格式支持** — mp3, mp4, wav, m4a, flac, ogg, webm
- ✅ **说话人识别** — 自动区分最多 10 个说话人
- ✅ **AI 智能摘要** — Bedrock Claude 自动提炼要点
- ✅ **用户数据隔离** — 每个用户只能看到自己的任务
- ✅ **Web 音频播放器** — 内置播放器，支持变速/进度拖拽
- ✅ **IaC** — 全部资源用 AWS SAM 模板定义，一键部署

## 📦 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | HTML + JavaScript + Cognito SDK |
| API | API Gateway + Lambda (Python 3.12) |
| 认证 | AWS Cognito |
| 存储 | S3 + DynamoDB |
| 转录 | AWS Transcribe |
| AI 摘要 | AWS Bedrock (Claude 3 Haiku) |
| CDN | CloudFront |
| IaC | AWS SAM |

## 🚀 快速部署

### 前置要求

1. AWS 账号（需开通 Bedrock Claude 模型访问权限）
2. [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) 已安装并配置
3. [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) 已安装
4. Docker（SAM build 需要）

### 一键部署

```bash
git clone https://github.com/cn-ljh/audio-summary.git
cd audio-summary
./deploy.sh
```

部署脚本会自动：
1. 检查依赖（AWS CLI, SAM CLI）
2. 构建 Lambda 函数
3. 部署所有 AWS 资源（S3, DynamoDB, Cognito, API Gateway, Lambda, CloudFront）
4. 更新前端配置并上传到 CloudFront
5. 输出访问地址和配置信息

### 手动部署

```bash
# 1. 构建
sam build --use-container

# 2. 首次部署（交互式）
sam deploy --guided

# 3. 后续部署
sam deploy
```

### 部署后配置

#### 1. 创建测试用户

```bash
# 从 CloudFormation Outputs 获取 User Pool ID
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

# 创建用户
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username your-email@example.com \
  --user-attributes Name=email,Value=your-email@example.com Name=name,Value=YourName \
  --temporary-password 'TempPass123!' \
  --region us-west-2

# 设置永久密码（跳过首次登录强制修改）
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username your-email@example.com \
  --password 'YourPassword123!' \
  --permanent \
  --region us-west-2
```

#### 2. 更新前端配置（如果手动部署）

如果使用 `sam deploy --guided` 手动部署，需要手动更新 `frontend/index.html` 中的配置：

```javascript
const COGNITO_CONFIG = {
    region: 'us-west-2',                          // 你的部署区域
    userPoolId: 'us-west-2_xxxxxxxx',             // CloudFormation Output: UserPoolId
    clientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx'         // CloudFormation Output: UserPoolClientId
};

const API_BASE_URL = 'https://xxxxx.execute-api.us-west-2.amazonaws.com/prod';  // CloudFormation Output: ApiEndpoint
```

然后上传前端到 S3 并刷新 CloudFront：

```bash
FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucket`].OutputValue' \
  --output text)

aws s3 sync frontend/ s3://$FRONTEND_BUCKET/ --delete
```

## 📁 目录结构

```
audio-summary/
├── template.yaml                # SAM 主模板（包含所有资源定义）
├── samconfig.toml              # SAM 部署配置
├── deploy.sh                   # 一键部署脚本
├── cloudfront-template.yaml    # CloudFront 独立模板（可选）
├── functions/
│   ├── upload/                 # 文件上传处理
│   │   ├── app.py
│   │   └── requirements.txt
│   ├── start-transcribe/       # 启动转录任务
│   │   ├── app.py
│   │   └── requirements.txt
│   ├── task-query/             # 任务查询
│   │   ├── app.py
│   │   └── requirements.txt
│   ├── get-audio-url/          # 获取音频播放 URL
│   │   └── app.py
│   └── transcribe-processor/   # 转录结果处理 + AI 摘要
│       ├── app.py
│       └── requirements.txt
└── frontend/
    ├── index.html              # 主页面
    ├── auth.js                 # Cognito 认证逻辑
    ├── app.js                  # 应用逻辑 + 音频播放器
    └── style.css               # 样式
```

## 🔧 Lambda 函数说明

| 函数 | 触发方式 | 功能 | 超时 | 内存 |
|------|---------|------|------|------|
| upload-handler | API Gateway POST /upload | 生成 S3 预签名 URL，文件由前端直传 S3 | 60s | 512MB |
| start-transcribe | API Gateway POST /start-transcribe | 启动 AWS Transcribe 任务 | 300s | 512MB |
| task-query | API Gateway GET /task/{id}, /tasks | 查询任务状态和列表 | 300s | 512MB |
| get-audio-url | API Gateway GET /task/{id}/audio-url | 生成音频预签名播放 URL | 300s | 512MB |
| transcribe-processor | EventBridge (Transcribe 完成) | 处理转录结果 + 调用 Bedrock 摘要 | 900s | 1024MB |

## 🔐 安全设计

- **API Gateway** — 所有端点通过 Cognito JWT Token 认证
- **Lambda** — 最小权限 IAM 角色，无硬编码凭证
- **DynamoDB** — 用户数据通过 GSI + 代码层面严格隔离
- **S3** — 私有桶 + OAI，文件通过临时预签名 URL 访问
- **CloudFront** — 强制 HTTPS，OAI 访问 S3
- **X-Ray** — 全链路追踪

## 💰 成本估算

以每月 1000 次转录（平均 5 分钟音频）为例：

| 服务 | 估算成本 |
|------|---------|
| Lambda | ~$1-2 |
| API Gateway | ~$3.50 |
| S3 | ~$2-5 |
| DynamoDB | ~$1-3 |
| AWS Transcribe | ~$60 |
| Bedrock (Claude) | ~$0.50 |
| CloudFront | ~$1-2 |
| **总计** | **~$70-80/月** |

> 💡 Transcribe 是最大成本项。实际成本取决于使用量。低频使用时月费可能只有几美元。

## 📊 API 文档

### POST /upload

请求上传预签名 URL。前端通过返回的 presigned URL 将文件直传 S3，支持最大 5GB 文件。

```bash
curl -X POST $API_ENDPOINT/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "audio.mp3", "file_size": 12345678}'
```

### POST /start-transcribe

启动转录任务。

```bash
curl -X POST $API_ENDPOINT/start-transcribe \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task_id": "uuid"}'
```

### GET /tasks

查询用户的所有任务。

```bash
curl $API_ENDPOINT/tasks -H "Authorization: Bearer $TOKEN"
```

### GET /task/{task_id}

查询单个任务详情（含转录文本和 AI 摘要）。

### GET /task/{task_id}/audio-url

获取音频文件的临时播放链接（有效期 1 小时）。

## 🗑️ 清理资源

```bash
# 删除整个 Stack
sam delete --stack-name audio-transcribe-serverless --region us-west-2

# ⚠️ 非空 S3 Bucket 需手动删除
aws s3 rm s3://YOUR_AUDIO_BUCKET --recursive
aws s3 rb s3://YOUR_AUDIO_BUCKET

aws s3 rm s3://YOUR_FRONTEND_BUCKET --recursive
aws s3 rb s3://YOUR_FRONTEND_BUCKET
```

## 🐛 故障排查

```bash
# 查看 Lambda 日志
sam logs -n UploadFunction --tail
sam logs -n TranscribeProcessorFunction --tail

# 查看 CloudFormation 输出
aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --query 'Stacks[0].Outputs'
```

## 📄 License

MIT
