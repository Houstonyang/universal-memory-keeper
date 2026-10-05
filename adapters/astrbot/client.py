"""标准库异步 HTTP 桥；令牌不写入日志，错误不伪装成空记忆。"""
import asyncio
import json
import os
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

async def memory_turn(event, url=None, token=None):
    url = (url or os.environ.get("MEMORY_URL", "http://127.0.0.1:8765")).rstrip("/")
    token = token or os.environ.get("MEMORY_TOKEN", "")
    if urlsplit(url).scheme not in ("http", "https") or len(token) < 24:
        raise ValueError("请配置记忆服务地址和至少24字符的令牌")
    def request():
        req = Request(url + "/v1/turn", data=json.dumps({"event": event}).encode(),
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
        with urlopen(req, timeout=5) as response:
            return json.load(response)
    return await asyncio.to_thread(request)

def epoch_ms(value, *, seconds=False):
    """不生成当前时间替代原始时间。平台字符串需带时区。"""
    from datetime import datetime
    if isinstance(value, str) and not value.replace(".", "", 1).isdigit():
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("原消息时间缺少时区")
        return int(parsed.timestamp() * 1000)
    result = int(float(value) * (1000 if seconds else 1))
    if result <= 0:
        raise ValueError("原消息时间无效")
    return result
