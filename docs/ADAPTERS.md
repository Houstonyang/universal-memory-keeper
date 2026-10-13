# 框架安装与接入

先按README启动核心；所有适配器都需要同一个服务URL与令牌。首次验证使用独立测试话题，不导入旧真实数据。

## AstrBot

复制 `adapters/astrbot/` 目录的全部内容到 AstrBot 的 `data/plugins/astrbot_plugin_universal_memory_keeper/`，包含 `main.py`、`client.py`、`metadata.yaml`、`_conf_schema.json`，然后重启。在插件配置填服务地址与令牌；默认聊天流程使用 `on_llm_request` 自动加经核验记忆。群聊需按该框架的唤醒规则 @机器人；普通未唤醒群消息不采集。

首版明确重置本次请求的历史上下文以保持本人来源边界，不修改聊天数据库。插件的独立LLM调用、自定义Agent链、其他记忆插件再注入等路径需要另行核验。框架API依据 [AstrBot事件](https://docs.astrbot.app/dev/star/resources/astr_message_event.html) 和 [官方LLM钩子源码/文档](https://github.com/AstrBotDevs/AstrBot/blob/master/docs/en/dev/star/guides/listen-message-event.md)。

## NoneBot2 + OneBot v11

复制 `adapters/nonebot2/` 为项目插件目录 `plugins/nonebot_plugin_universal_memory_keeper/`；框架需已安装OneBot v11适配器。设置进程环境变量 `MEMORY_URL`、`MEMORY_TOKEN`，使用常规插件加载。群聊需to_me触发；普通消息只记录明确陈述，不主动闲聊。

NoneBot没有统一AI钩子。在原AI插件调用模型前接入：

```python
from plugins.nonebot_plugin_universal_memory_keeper import memory_for

async def prepare_memory_messages(bot, event):
    result = await memory_for(bot, event)
    if result.get("command"):
        # 自定义接入也尊重精确复述/维护回执，直接回复后结束本轮。
        await bot.send(event, result.get("reply") or "记忆操作完成")
        return None
    # 当前问题 + 已核验数据；旧上下文不能补回禁记内容。
    messages = []
    if result["context"]:
        messages.append({"role": "user", "content": result["context"]})
    messages.append({"role": "user", "content": event.get_plaintext()})
    return messages
# 返回 None 时已回复；否则把 messages 交给已有模型调用。
```

根据实际插件可导入路径调整第一行。其他NoneBot协议如QQ官方adapter不能直接套用OneBot v11事件，需对应事件映射。参考 [NoneBot插件加载](https://nonebot.dev/docs/tutorial/create-plugin) 与 [事件信息](https://nonebot.dev/docs/tutorial/event-data)。

## Koishi 4

把 `adapters/koishi/` 作为本地插件包安装到Koishi项目，注册 `index.mjs` 导出的 `apply` 与 `Config`；在控制台启用并填URL/token。中间件处理私聊和明确呼叫消息，其他消息交给后续插件。

AI插件调用模型前使用：

```javascript
import { memoryFor } from 'koishi-plugin-universal-memory-keeper';
async function prepareMemoryMessages(session) {
  const result = await memoryFor(session);
  if (result.command) {
    await session.send(result.reply || '记忆操作完成');
    return null;
  }
  return [
    ...(result.context ? [{ role: 'user', content: result.context }] : []),
    { role: 'user', content: session.content },
  ];
}
// 返回 null 时已回复；否则把 messages 交给已有模型。
// 位于记忆中间件之后，或给 memoryFor 第二参传服务配置。
```

中间件不会自行调用模型。参考 [Koishi Session API](https://koishi.chat/zh-CN/api/core/session)。

## QQ 官方 SDK

如果已经在AstrBot中运行QQ官方机器人，优先安装AstrBot目录。独立腾讯botpy项目可将 `adapters/qq-official/` 复制为Python包 `universal_memory_qq/`，在**已认证的SDK回调**接入：

```python
from universal_memory_qq.bridge import memory_for

async def on_group_at_message_create(self, message):
    result = await memory_for(message, self.app_id, "group")
    if result["command"]:
        await message.reply(content=result["reply"])
        return
    # result["context"] + 当前问题交给已有模型；按SDK规则回复。
```

`self.app_id` 是示例中的项目配置属性，按已有机器人配置提供真实AppID；本桥不访问或保存AppSecret。C2C回调用 `"private"`，频道回调用 `"channel"`。群成员OpenID、C2C用户OpenID和频道账号身份不同，不做猜测合并。参考 [腾讯botpy Message源码](https://github.com/tencent-connect/botpy/blob/master/botpy/message.py)。Webhook项目需在已有签名核验完成后转换消息对象；本项目不提供未验签公网入口。

## 0.1.1 引用与升级

核心与正在使用的适配器目录需要同时更新，并重启各自进程。沿用原服务令牌和数据目录；不要把真实数据复制到源码仓库。普通问句不再自动记录，相关历史默认按原始时间从近到远，明确问最初才从最早版本开始。记录和查询规则见 [版本记录](../CHANGELOG.md)。

AstrBot 从原链 `Reply.id` 读取引用 ID，转发 Node/Nodes 不作为本人授权，字段依据 [AstrBot 消息组件源码](https://github.com/AstrBotDevs/AstrBot/blob/master/astrbot/core/message/components.py)。NoneBot OneBot v11 从原 `reply` 段的 `data.id` 读取，依据 [OneBot 适配器消息源码](https://github.com/nonebot/adapter-onebot/blob/master/nonebot/adapters/onebot/v11/message.py)。Koishi 读取 `session.quote.id` 或原 quote 元素 ID，多个值不一致时拒绝猜测，依据 [Session API](https://koishi.chat/zh-CN/api/core/session) 和 [消息元素](https://koishi.chat/zh-CN/guide/basic/element)。腾讯 botpy 读取字典或 SDK 引用对象的 `message_id`；空 SDK 引用对象不能按对象真假判断，依据 [botpy 消息对象源码](https://github.com/tencent-connect/botpy/blob/master/botpy/message.py)。

引用目标需要已经存在于核心当前范围的来源库。引用消息自身仍不执行本人写入或遗忘；引用其他成员时原作者也不会变成当前发送者。实际引用可核验的纯文字消息并单独发“只复述原句”，核心返回 `command: true`，入口直接发送 `reply` 并结束。来源不可用则明确说明无法核验，不用最近一条记忆替代。

适配器没有自动捕获全部发出消息。若宿主需要引用机器人旧回复，应由已认证接入代码把**实际发送成功且有平台原 ID/时间**的机器人消息提交到 `/v1/turn`，使用真实会话范围和 `self: true`；不能提交尚未发送的模型草稿。没有这种来源就保持无法核验。适配器也尚未自动订阅平台撤回事件。

## 联调验收

按顺序实测：本人明确记忆 → 查询原ID/时间 → 更新后只查到新值 → A禁记但B仍能查本人同值 → 历史不能绕过禁记 → 重提不解锁 → 本人解锁 → 重新查原来源。引用/转发/媒体不可作为授权。还要验证服务停止、错误令牌与平台原消息撤回，不把错误当作空库或成功回复。

0.1.1 另需实测：同话题一个月前/一周前/昨日记录 → 默认最近与明确最初 → 带引号的相近话题及空结果 → 指定截止日期 → “我的事项是什么”不会写入 → 真实引用已记录的本人、其他成员与机器人原句 → 只复述原句不附加编号 → 未记录/撤回来源明确拒绝。使用两位自愿参与的成员和隔离话题记录结果；这些步骤尚未在真实框架完成。
