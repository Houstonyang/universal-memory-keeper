"""腾讯 botpy 已认证消息对象的桥；SDK/Webhook 层负责认证和发送。"""
from .client import memory_turn, epoch_ms

def normalize_message(message, app_id, kind):
    if kind not in ("group", "private", "channel"):
        raise ValueError("无效 QQ 官方消息类型")
    author = message.author
    if kind == "group":
        sender = str(author.member_openid)
        conversation = str(message.group_openid)
    elif kind == "private":
        sender = str(author.user_openid)
        conversation = sender
    else:
        sender = str(author.id)
        conversation = str(message.channel_id)
    content = message.content.strip()
    # QQ 的机器人 at 前缀属于本轮地址，不是用户事实内容。
    import re
    content = re.sub(r"^<@!?[\w-]+>\s*", "", content).strip()
    return {"framework": "qq-official", "platform": "qq", "botId": str(app_id), "kind": kind,
            "conversationId": conversation, "messageId": str(message.id), "senderId": sender,
            "senderName": str(getattr(author, "username", "") or ""),
            "timestamp": epoch_ms(message.timestamp), "text": content, "self": bool(getattr(author, "bot", False)),
            "quoted": bool(getattr(message, "message_reference", None)), "forwarded": False,
            "media": ["attachment"] if getattr(message, "attachments", None) else []}

async def memory_for(message, app_id, kind):
    """从现有 botpy 事件回调调用；不实现公网 Webhook 或保存 QQ AppSecret。"""
    return await memory_turn(normalize_message(message, app_id, kind))
