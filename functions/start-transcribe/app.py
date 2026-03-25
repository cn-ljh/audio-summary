import json
import os
import boto3
from datetime import datetime
from typing import Dict, Any

dynamodb = boto3.resource('dynamodb')
transcribe_client = boto3.client('transcribe')

AUDIO_BUCKET = os.environ['AUDIO_BUCKET']
DYNAMODB_TABLE = os.environ['DYNAMODB_TABLE']
table = dynamodb.Table(DYNAMODB_TABLE)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    启动 AWS Transcribe 任务
    """
    try:
        # 从 Cognito 获取用户信息
        user_id = event['requestContext']['authorizer']['claims']['sub']
        
        # 解析请求体
        body = json.loads(event['body'])
        task_id = body.get('task_id')
        
        if not task_id:
            return error_response(400, '缺少 task_id')
        
        # 获取任务信息
        response = table.get_item(Key={'task_id': task_id})
        
        if 'Item' not in response:
            return error_response(404, '任务不存在')
        
        task = response['Item']
        
        # 验证用户权限
        if task['user_id'] != user_id:
            return error_response(403, '无权访问此任务')
        
        # 启动转录任务
        start_transcription(task_id, task['s3_uri'], task['audio_filename'])
        
        return {
            'statusCode': 200,
            'headers': cors_headers(),
            'body': json.dumps({
                'task_id': task_id,
                'status': 'transcribing',
                'message': '转录任务已启动'
            })
        }
        
    except Exception as e:
        print(f'Error: {str(e)}')
        return error_response(500, f'服务器错误: {str(e)}')


def start_transcription(task_id: str, s3_uri: str, filename: str) -> None:
    """
    启动 AWS Transcribe 任务
    """
    job_name = f'transcribe-{task_id}'
    media_format = filename.rsplit('.', 1)[1].lower()
    
    # 媒体格式映射
    format_map = {
        'mp4': 'mp4',
        'm4a': 'mp4',
        'wav': 'wav',
        'flac': 'flac',
        'ogg': 'ogg',
        'webm': 'webm',
        'mp3': 'mp3'
    }
    
    transcribe_client.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={'MediaFileUri': s3_uri},
        MediaFormat=format_map.get(media_format, 'mp3'),
        LanguageCode='zh-CN',
        Settings={
            'ShowSpeakerLabels': True,
            'MaxSpeakerLabels': 10
        }
    )
    
    # 更新任务状态
    table.update_item(
        Key={'task_id': task_id},
        UpdateExpression='SET #status = :status, updated_at = :now',
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues={
            ':status': 'transcribing',
            ':now': datetime.utcnow().isoformat()
        }
    )


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
