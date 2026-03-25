import json
import os
import uuid
import boto3
import base64
from datetime import datetime
from typing import Dict, Any

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

AUDIO_BUCKET = os.environ['AUDIO_BUCKET']
DYNAMODB_TABLE = os.environ['DYNAMODB_TABLE']
table = dynamodb.Table(DYNAMODB_TABLE)

ALLOWED_EXTENSIONS = {'mp3', 'mp4', 'wav', 'm4a', 'flac', 'ogg', 'webm'}

# 文件大小限制：如果超过 8MB，返回预签名 URL；否则直接上传
DIRECT_UPLOAD_LIMIT = 8 * 1024 * 1024  # 8MB


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    支持两种上传模式：
    1. 小文件（<8MB）：直接 Base64 上传
    2. 大文件（>=8MB）：返回 S3 预签名 URL
    """
    try:
        # 从 Cognito 获取用户信息
        user_id = event['requestContext']['authorizer']['claims']['sub']
        user_email = event['requestContext']['authorizer']['claims'].get('email', '')
        
        # 解析请求体
        body = json.loads(event['body'])
        filename = body.get('filename')
        file_size = body.get('file_size', 0)  # 客户端提供的文件大小（可选）
        file_content_base64 = body.get('file_content')  # Base64 编码的文件内容（可选）
        
        if not filename:
            return error_response(400, '缺少文件名')
        
        # 验证文件扩展名
        ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
        if ext not in ALLOWED_EXTENSIONS:
            return error_response(400, f'不支持的文件格式: {ext}')
        
        # 生成任务 ID 和 S3 key
        task_id = str(uuid.uuid4())
        s3_key = f'audio/{task_id}/{filename}'
        
        # 判断上传模式
        if file_content_base64:
            # 模式 1: 直接上传（小文件）
            try:
                file_content = base64.b64decode(file_content_base64)
            except Exception as e:
                return error_response(400, f'文件内容解码失败: {str(e)}')
            
            # 上传到 S3
            s3_client.put_object(
                Bucket=AUDIO_BUCKET,
                Key=s3_key,
                Body=file_content,
                ContentType=f'audio/{ext}'
            )
            
            # 创建 DynamoDB 记录
            create_task_record(task_id, user_id, user_email, filename, len(file_content), s3_key, 'pending')
            
            return success_response({
                'task_id': task_id,
                's3_key': s3_key,
                'status': 'pending',
                'message': '文件上传成功，准备开始转录'
            })
        
        else:
            # 模式 2: 预签名 URL（大文件）
            upload_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': AUDIO_BUCKET,
                    'Key': s3_key,
                    'ContentType': f'audio/{ext}'
                },
                ExpiresIn=3600  # 1小时
            )
            
            # 创建 DynamoDB 记录（状态为 pending_upload）
            create_task_record(task_id, user_id, user_email, filename, file_size, s3_key, 'pending_upload')
            
            return success_response({
                'task_id': task_id,
                'upload_url': upload_url,
                'status': 'pending_upload',
                'message': '请使用返回的 URL 上传文件'
            })
        
    except Exception as e:
        print(f'Error: {str(e)}')
        return error_response(500, f'服务器错误: {str(e)}')


def create_task_record(task_id: str, user_id: str, user_email: str, filename: str, 
                       file_size: int, s3_key: str, status: str) -> None:
    """创建 DynamoDB 任务记录"""
    now = datetime.utcnow().isoformat()
    
    task_item = {
        'task_id': task_id,
        'user_id': user_id,
        'user_email': user_email,
        'audio_filename': filename,
        'file_size': file_size,
        's3_key': s3_key,
        's3_uri': f's3://{AUDIO_BUCKET}/{s3_key}',
        'transcribe_job_name': f'transcribe-{task_id}',
        'status': status,
        'transcription_text': '',
        'summary_text': '',
        'created_at': now,
        'updated_at': now
    }
    
    table.put_item(Item=task_item)


def success_response(data: Dict[str, Any]) -> Dict[str, Any]:
    """成功响应"""
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps(data, ensure_ascii=False)
    }


def cors_headers() -> Dict[str, str]:
    """CORS headers"""
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }


def error_response(status_code: int, message: str) -> Dict[str, Any]:
    """错误响应"""
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps({'error': message})
    }
