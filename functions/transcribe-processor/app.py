import json
import os
import boto3
from datetime import datetime
from typing import Dict, Any

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
transcribe_client = boto3.client('transcribe')
bedrock_client = boto3.client('bedrock-runtime')

AUDIO_BUCKET = os.environ['AUDIO_BUCKET']
DYNAMODB_TABLE = os.environ['DYNAMODB_TABLE']
table = dynamodb.Table(DYNAMODB_TABLE)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    处理 AWS Transcribe 完成事件
    
    EventBridge 触发:
    - 当 Transcribe 任务完成时
    - 下载转录结果
    - 调用 Bedrock 生成摘要
    - 更新 DynamoDB
    """
    try:
        print(f'Received event: {json.dumps(event)}')
        
        # 从 EventBridge 事件中提取信息
        detail = event['detail']
        job_name = detail['TranscriptionJobName']
        status = detail['TranscriptionJobStatus']
        
        # 提取 task_id
        task_id = job_name.replace('transcribe-', '')
        
        print(f'Processing task {task_id}, status: {status}')
        
        if status == 'COMPLETED':
            # 处理成功的转录
            process_completed_transcription(task_id, job_name)
        elif status == 'FAILED':
            # 处理失败的转录
            process_failed_transcription(task_id, job_name)
        
        return {'statusCode': 200, 'body': json.dumps({'message': 'Processed'})}
        
    except Exception as e:
        print(f'Error processing transcription: {str(e)}')
        raise


def process_completed_transcription(task_id: str, job_name: str) -> None:
    """处理成功的转录"""
    try:
        # 获取转录任务详情
        job_details = transcribe_client.get_transcription_job(
            TranscriptionJobName=job_name
        )
        
        transcript_uri = job_details['TranscriptionJob']['Transcript']['TranscriptFileUri']
        
        # 从 S3 下载转录结果
        # URI 格式: https://s3.region.amazonaws.com/bucket/key 或 https://bucket.s3.region.amazonaws.com/key
        # 或直接是 HTTPS URL，需要用 requests 下载
        print(f'Transcript URI: {transcript_uri}')
        
        # 直接通过 HTTPS 下载（Transcribe 输出是公开可访问的 HTTPS URL）
        import urllib.request
        with urllib.request.urlopen(transcript_uri) as response:
            transcript_data = json.loads(response.read().decode('utf-8'))
        
        # 提取转录文本
        transcription_text = format_transcription(transcript_data)
        
        # 生成 AI 摘要
        summary_text = generate_summary(transcription_text)
        
        # 更新 DynamoDB
        table.update_item(
            Key={'task_id': task_id},
            UpdateExpression='SET #status = :status, transcription_text = :text, summary_text = :summary, updated_at = :now',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'completed',
                ':text': transcription_text,
                ':summary': summary_text,
                ':now': datetime.utcnow().isoformat()
            }
        )
        
        print(f'Task {task_id} completed successfully')
        
    except Exception as e:
        print(f'Error processing completed transcription: {str(e)}')
        import traceback
        traceback.print_exc()
        # 更新为失败状态
        table.update_item(
            Key={'task_id': task_id},
            UpdateExpression='SET #status = :status, error_message = :error, updated_at = :now',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'failed',
                ':error': str(e),
                ':now': datetime.utcnow().isoformat()
            }
        )
        raise


def process_failed_transcription(task_id: str, job_name: str) -> None:
    """处理失败的转录"""
    try:
        # 获取失败原因
        job_details = transcribe_client.get_transcription_job(
            TranscriptionJobName=job_name
        )
        
        failure_reason = job_details['TranscriptionJob'].get('FailureReason', 'Unknown error')
        
        # 更新 DynamoDB
        table.update_item(
            Key={'task_id': task_id},
            UpdateExpression='SET #status = :status, error_message = :error, updated_at = :now',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'failed',
                ':error': failure_reason,
                ':now': datetime.utcnow().isoformat()
            }
        )
        
        print(f'Task {task_id} failed: {failure_reason}')
        
    except Exception as e:
        print(f'Error processing failed transcription: {str(e)}')
        raise


def format_transcription(transcript_data: Dict[str, Any]) -> str:
    """
    格式化转录文本，添加说话人标签
    """
    results = transcript_data['results']
    
    # 检查是否有说话人标签
    if 'speaker_labels' in results:
        return format_with_speakers(results)
    else:
        # 没有说话人标签，返回纯文本
        return results['transcripts'][0]['transcript']


def format_with_speakers(results: Dict[str, Any]) -> str:
    """格式化带说话人标签的转录文本"""
    import re
    
    speaker_labels = results['speaker_labels']['segments']
    items = results['items']
    
    # 构建说话人映射
    speaker_map = {}
    for segment in speaker_labels:
        speaker = segment['speaker_label']
        for item in segment['items']:
            start_time = item['start_time']
            speaker_map[start_time] = speaker
    
    # 组织文本
    formatted_text = []
    current_speaker = None
    current_text = []
    
    for item in items:
        if item['type'] == 'pronunciation':
            start_time = item['start_time']
            speaker = speaker_map.get(start_time, 'spk_0')
            content = item['alternatives'][0]['content']
            
            if speaker != current_speaker:
                if current_text:
                    # 智能连接：去除中文之间的空格
                    text = smart_join(current_text)
                    formatted_text.append(f'**{current_speaker}**: {text}')
                current_speaker = speaker
                current_text = [content]
            else:
                current_text.append(content)
        elif item['type'] == 'punctuation' and current_text:
            current_text[-1] += item['alternatives'][0]['content']
    
    # 添加最后一段
    if current_text:
        text = smart_join(current_text)
        formatted_text.append(f'**{current_speaker}**: {text}')
    
    return '\n\n'.join(formatted_text)


def smart_join(words: list) -> str:
    """
    智能连接词语：
    - 中文之间不加空格
    - 中英文之间保留空格
    - 数字和中文之间不加空格
    """
    import re
    
    if not words:
        return ''
    
    result = words[0]
    
    for i in range(1, len(words)):
        prev = words[i-1]
        curr = words[i]
        
        # 判断是否需要空格
        # 如果前一个词的最后一个字符是中文，且当前词的第一个字符也是中文，不加空格
        prev_is_chinese = bool(re.search(r'[\u4e00-\u9fff]$', prev))
        curr_is_chinese = bool(re.search(r'^[\u4e00-\u9fff]', curr))
        
        # 如果前一个词以标点结尾，不加空格
        prev_is_punct = bool(re.search(r'[，。！？、；：]$', prev))
        
        if (prev_is_chinese and curr_is_chinese) or prev_is_punct:
            result += curr
        else:
            result += ' ' + curr
    
    return result


def generate_summary(text: str) -> str:
    """
    使用 AWS Bedrock 生成摘要
    """
    try:
        prompt = f"""以下是一段音频转录的文本，请对其进行总结，提炼关键信息和要点：

{text}

请提供：
1. 主要话题
2. 核心要点（3-5条）
3. 重要信息总结
"""
        
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2000,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        })
        
        response = bedrock_client.invoke_model(
            modelId='anthropic.claude-3-haiku-20240307-v1:0',
            body=body
        )
        
        response_body = json.loads(response['body'].read())
        summary = response_body['content'][0]['text']
        
        return summary
        
    except Exception as e:
        print(f'Error generating summary: {str(e)}')
        return f'摘要生成失败: {str(e)}'
