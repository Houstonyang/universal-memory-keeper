"""可加载的 NoneBot2 插件；AI 插件通过 memory_for() 读取本次核验上下文。"""
from nonebot import on_message
from nonebot.adapters.onebot.v11 import Bot, MessageEvent
from nonebot.rule import to_me
from .normalize import normalize_event
from .client import memory_turn

async def memory_for(bot: Bot, event: MessageEvent):
    return await memory_turn(normalize_event(bot, event))

memory = on_message(rule=to_me(), priority=2, block=False)

@memory.handle()
async def handle(bot: Bot, event: MessageEvent):
    try:
        result = await memory_for(bot, event)
    except Exception:
        await memory.finish("记忆服务或来源核验失败，请检查配置。")
        return
    if result.get("command"):
        await memory.finish(result.get("reply") or "记忆操作完成")
    # NoneBot 没有统一的 LLM 请求钩子，AI 插件需调用上面的 memory_for。
