"""NoneBot2 OneBot v11 真实事件映射；其他 NoneBot 协议需独立映射。"""
from .client import epoch_ms
def normalize_event(bot, event):
    if event.get_type() != "message":
        raise ValueError("需要消息事件")
    segments = list(event.original_message)
    kinds = [str(segment.type) for segment in segments]
    replies = [segment for segment in segments if segment.type == "reply"]
    if len(replies) > 1:
        raise ValueError("多条引用无法唯一核验")
    reply_id = replies[0].data.get("id") if replies else None
    sender, bot_id = str(event.user_id), str(bot.self_id)
    group = getattr(event, "group_id", None)
    return {"framework": "nonebot2", "platform": "onebot-v11", "botId": bot_id,
            "kind": "group" if group else "private", "conversationId": str(group) if group else sender,
            "messageId": str(event.message_id), "senderId": sender,
            "senderName": str(getattr(event.sender, "nickname", "") or ""),
            "timestamp": epoch_ms(event.time, seconds=True),
            "text": "".join(str(s.data.get("text", "")) for s in segments if s.type == "text").strip(),
            "self": sender == bot_id, "quoted": bool(replies),
            "replyTo": str(reply_id) if reply_id is not None else None,
            "forwarded": bool(set(kinds) & {"forward", "node"}),
            "media": [kind for kind in kinds if kind not in ("text", "at", "reply", "forward", "node")]}
