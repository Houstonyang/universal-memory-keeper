"""AstrBot 事件、本人维护命令和默认 LLM 请求钩子。"""
from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.star import Context, Star, register
from astrbot.api.provider import ProviderRequest
from .client import memory_turn, epoch_ms

def normalize_event(event):
    obj = event.message_obj
    chain = obj.message
    if not isinstance(chain, list):
        raise ValueError("消息链缺失")
    kinds = [type(part).__name__.lower() for part in chain]
    sender = str(event.get_sender_id())
    bot = str(event.get_self_id())
    # 原始消息链中的 Plain 文本不会被其他命令插件重写后的 message_str 冒充。
    text = "".join(part.text for part in chain if type(part).__name__.lower() == "plain").strip()
    private = event.is_private_chat()
    return {"framework": "astrbot", "platform": str(event.get_platform_id()), "botId": bot,
            "kind": "private" if private else "group", "conversationId": sender if private else str(event.get_group_id()),
            "messageId": str(obj.message_id), "senderId": sender, "senderName": str(event.get_sender_name()),
            "timestamp": epoch_ms(obj.timestamp, seconds=True), "text": text, "self": sender == bot,
            "quoted": "reply" in kinds, "forwarded": "forward" in kinds,
            "media": [kind for kind in kinds if kind not in ("plain", "at", "atall", "reply", "forward")]}

@register("universal_memory_keeper", "Houstonyang", "来源记忆、版本、本人遗忘与解锁", "0.1.0")
class UniversalMemoryKeeper(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config

    async def retrieve(self, event):
        # 缓存属于当前事件，避免多个钩子重复维护；不跨事件保留权限。
        result = event.get_extra("universal_memory_keeper")
        if result is None:
            result = await memory_turn(normalize_event(event), self.config.get("url"), self.config.get("token"))
            event.set_extra("universal_memory_keeper", result)
        return result

    @filter.event_message_type(filter.EventMessageType.ALL)
    async def on_message(self, event: AstrMessageEvent):
        # 普通群聊天只有唤醒时采集，避免插件监听器本身唤醒所有群消息。
        if not event.is_at_or_wake_command and not event.is_private_chat():
            return
        try:
            result = await self.retrieve(event)
            if result.get("command"):
                yield event.plain_result(result.get("reply") or "记忆操作完成")
                event.stop_event()
        except Exception:
            logger.warning("Universal Memory Keeper: 事件核验或服务请求失败")
            yield event.plain_result("记忆核验失败，本轮已停止处理。请检查记忆服务和原消息信息。")
            event.stop_event()

    @filter.on_llm_request()
    async def before_llm(self, event: AstrMessageEvent, req: ProviderRequest):
        result = await self.retrieve(event)
        # 每轮只用已核验记忆和当前问题，避免群内旧上下文串人或禁记后从历史恢复。
        # 不删除 AstrBot 的聊天数据库；仅重置本次请求的上下文。
        req.contexts = []
        if hasattr(req, "conversation"):
            req.conversation = None
        if result.get("context"):
            from astrbot.core.agent.message import TextPart
            if hasattr(req, "extra_user_content_parts"):
                req.extra_user_content_parts.append(TextPart(text=result["context"]))
            else:
                req.contexts.append({"role": "user", "content": result["context"]})

    @filter.command("memory")
    async def memory_command(self, event: AstrMessageEvent):
        # 注册命令让群聊唤醒阶段识别 /memory；仍从未经改写的 Plain 原文授权。
        try:
            result = await self.retrieve(event)
            yield event.plain_result(result.get("reply") or "用法：/memory search|history|note|forget|unlock|status")
        except Exception:
            yield event.plain_result("记忆服务或原消息核验失败，请检查配置。")
        event.stop_event()
