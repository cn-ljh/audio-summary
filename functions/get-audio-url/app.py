import json
import os
import boto3
from botocore.exceptions import ClientError
from typing import Dict, Any

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
DYNAMODB_TABLE = os.environ['DYNAMODB_TABLE']
AUDIO_BUCKET = os.environ['AUDIO_BUCKET']
table = dynamodb.Table(DYNAMODB_TABLE)

PRESIGNED_URL_EXPIRY = 3600  # 1 小时


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    生成 S3 音频文件的 presigned URL

    GET /task/{task_id}/audio-url
    返回有效期 1 小时的临时访问链接
    """
    try:
        # 从 Cognito 获取用户信息
        user_id = event['requestContext']['authorizer']['claims']['sub']

        task_id = event['pathParameters']['task_id']

        # 查询任务信息
        response = table.get_item(Key={'task_id': task_id})

        if 'Item' not in response:
            return error_response(404, '任务不存在')

        task = response['Item']

        # 验证用户权限
        if task['user_id'] != user_id:
            return error_response(403, '无权访问此任务')

        # 获取 S3 key
        s3_key = task.get('s3_key')
        if not s3_key:
            # 兼容旧数据：通过 audio_filename 构建路径
            audio_filename = task.get('audio_filename')
            if not audio_filename:
                return error_response(404, '该任务没有关联的音频文件')
            s3_key = f'audio/{task_id}/{audio_filename}'

        # 生成 presigned URL
        try:
            presigned_url = s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': AUDIO_BUCKET,
                    'Key': s3_key,
                },
                ExpiresIn=PRESIGNED_URL_EXPIRY
            )
        except ClientError as e:
            print(f'S3 presigned URL 生成失败: {str(e)}')
            return error_response(500, 'S3 URL 生成失败')

        return {
            'statusCode': 200,
            'headers': cors_headers(),
            'body': json.dumps({
                'url': presigned_url,
                'expires_in': PRESIGNED_URL_EXPIRY,
                'filename': task.get('audio_filename', ''),
                's3_key': s3_key
            })
        }

    except Exception as e:
        print(f'Error: {str(e)}')
        return error_response(500, f'服务器错误: {str(e)}')


def cors_headers() -> Dict[str, str]:
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }


def error_response(status_code: int, message: str) -> Dict[str, Any]:
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps({'error': message})
    }
