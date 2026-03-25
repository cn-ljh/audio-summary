import json
import os
import boto3
from typing import Dict, Any
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
DYNAMODB_TABLE = os.environ['DYNAMODB_TABLE']
table = dynamodb.Table(DYNAMODB_TABLE)


class DecimalEncoder(json.JSONEncoder):
    """处理 DynamoDB Decimal 类型"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    查询任务状态和结果
    
    支持两种请求:
    1. GET /task/{task_id} - 查询单个任务
    2. GET /tasks - 查询用户的所有任务
    """
    try:
        # 从 Cognito 获取用户信息
        user_id = event['requestContext']['authorizer']['claims']['sub']
        
        # 判断是查询单个任务还是列表
        path = event['path']
        
        if '/task/' in path:
            # 查询单个任务
            task_id = event['pathParameters']['task_id']
            return get_task(task_id, user_id)
        else:
            # 查询任务列表
            query_params = event.get('queryStringParameters') or {}
            return list_tasks(user_id, query_params)
            
    except Exception as e:
        print(f'Error: {str(e)}')
        return error_response(500, f'服务器错误: {str(e)}')


def get_task(task_id: str, user_id: str) -> Dict[str, Any]:
    """查询单个任务"""
    response = table.get_item(Key={'task_id': task_id})
    
    if 'Item' not in response:
        return error_response(404, '任务不存在')
    
    task = response['Item']
    
    # 验证用户权限
    if task['user_id'] != user_id:
        return error_response(403, '无权访问此任务')
    
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps(task, cls=DecimalEncoder)
    }


def list_tasks(user_id: str, query_params: Dict[str, str]) -> Dict[str, Any]:
    """查询用户的所有任务"""
    limit = int(query_params.get('limit', 50))
    last_key = query_params.get('last_key')
    
    # 使用 GSI 按用户查询
    query_params = {
        'IndexName': 'user-index',
        'KeyConditionExpression': '#user_id = :user_id',
        'ExpressionAttributeNames': {'#user_id': 'user_id'},
        'ExpressionAttributeValues': {':user_id': user_id},
        'Limit': limit,
        'ScanIndexForward': False  # 按创建时间降序
    }
    
    if last_key:
        query_params['ExclusiveStartKey'] = json.loads(last_key)
    
    response = table.query(**query_params)
    
    tasks = response.get('Items', [])
    next_key = response.get('LastEvaluatedKey')
    
    result = {
        'tasks': tasks,
        'count': len(tasks)
    }
    
    if next_key:
        result['next_key'] = json.dumps(next_key, cls=DecimalEncoder)
    
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps(result, cls=DecimalEncoder)
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
