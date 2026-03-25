#!/bin/bash
# 一键部署 Serverless 音频转录服务

set -e

echo "🚀 开始部署 Audio Transcribe Serverless Service"
echo "================================================"
echo ""

# 检查依赖
echo "🔍 检查依赖..."
command -v sam >/dev/null 2>&1 || { echo "❌ 需要安装 AWS SAM CLI"; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "❌ 需要安装 AWS CLI"; exit 1; }

# 确认 AWS 凭证
aws sts get-caller-identity >/dev/null 2>&1 || {
    echo "❌ AWS 凭证未配置"
    echo "请运行: aws configure"
    exit 1
}

echo "✅ 依赖检查通过"
echo ""

# 构建
echo "📦 构建 Lambda 函数..."
sam build --use-container

echo ""
echo "✅ 构建完成"
echo ""

# 部署
echo "🚀 部署到 AWS..."
echo "   - 区域: us-west-2"
echo "   - 环境: prod"
echo ""

sam deploy \
  --stack-name audio-transcribe-serverless \
  --capabilities CAPABILITY_IAM \
  --region us-west-2 \
  --parameter-overrides Stage=prod \
  --resolve-s3 \
  --no-confirm-changeset

echo ""
echo "✅ 部署完成！"
echo ""

# 获取输出
echo "📋 获取部署信息..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --region us-west-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --region us-west-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontURL`].OutputValue' \
  --output text)

USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --region us-west-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name audio-transcribe-serverless \
  --region us-west-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text)

echo ""
echo "✅ 部署信息:"
echo "-----------------------------------"
echo "API 端点: $API_ENDPOINT"
echo "CloudFront URL: https://$CLOUDFRONT_URL"
echo "User Pool ID: $USER_POOL_ID"
echo "Client ID: $CLIENT_ID"
echo ""

# 保存配置
cat > deployment-info.json << EOF
{
  "apiEndpoint": "$API_ENDPOINT",
  "cloudFrontUrl": "https://$CLOUDFRONT_URL",
  "userPoolId": "$USER_POOL_ID",
  "clientId": "$CLIENT_ID",
  "region": "us-west-2",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "✅ 配置已保存到: deployment-info.json"
echo ""

# 部署前端
if [ -d "frontend" ]; then
    echo "📤 部署前端..."
    FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
      --stack-name audio-transcribe-serverless \
      --region us-west-2 \
      --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucket`].OutputValue' \
      --output text 2>/dev/null || echo "")
    
    if [ -n "$FRONTEND_BUCKET" ]; then
        # 更新前端配置（替换占位符为实际部署值）
        sed -e "s|YOUR_REGION|us-west-2|g" \
            -e "s|YOUR_USER_POOL_ID|$USER_POOL_ID|g" \
            -e "s|YOUR_CLIENT_ID|$CLIENT_ID|g" \
            -e "s|YOUR_API_ENDPOINT|$API_ENDPOINT|g" \
            frontend/index.html > frontend/index.html.tmp
        mv frontend/index.html.tmp frontend/index.html
        
        # 上传到 S3
        aws s3 sync frontend/ s3://$FRONTEND_BUCKET/ --delete --region us-west-2
        
        # 刷新 CloudFront
        DISTRIBUTION_ID=$(aws cloudfront list-distributions \
          --query "DistributionList.Items[?Origins.Items[0].DomainName=='$FRONTEND_BUCKET.s3.us-west-2.amazonaws.com'].Id" \
          --output text 2>/dev/null || echo "")
        
        if [ -n "$DISTRIBUTION_ID" ]; then
            aws cloudfront create-invalidation \
              --distribution-id "$DISTRIBUTION_ID" \
              --paths "/*" >/dev/null 2>&1
            echo "✅ 前端部署完成"
        fi
    fi
fi

echo ""
echo "🎉 部署完成！"
echo ""
echo "📝 下一步:"
echo "1. 访问 CloudFront URL: https://$CLOUDFRONT_URL"
echo "2. 创建测试用户:"
echo "   aws cognito-idp admin-create-user \\"
echo "     --user-pool-id $USER_POOL_ID \\"
echo "     --username test@example.com \\"
echo "     --user-attributes Name=email,Value=test@example.com \\"
echo "     --temporary-password 'TempPass123!' \\"
echo "     --region us-west-2"
echo ""
echo "3. 测试 API:"
echo "   curl $API_ENDPOINT/health"
