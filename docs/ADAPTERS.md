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
result = await memory_for(bot, event)
# 本轮用当前问题 + 已核验数据构建消息，旧上下文不能自行补回禁记内容。
messages = []
if result["context"]:
    messages.append({"role": "user", "content": result["context"]})
messages.append({"role": "user", "content": event.get_plaintext()})
# 将messages传给你现有的模型调用。这里不替你选择模型或API密钥。
```

根据实际插件可导入路径调整第一行。其他NoneBot协议如QQ官方adapter不能直接套用OneBot v11事件，需对应事件映射。参考 [NoneBot插件加载](https://nonebot.dev/docs/tutorial/create-plugin) 与 [事件信息](https://nonebot.dev/docs/tutorial/event-data)。

## Koishi 4

把 `adapters/koishi/` 作为本地插件包安装到Koishi项目，注册 `index.mjs` 导出的 `apply` 与 `Config`；在控制台启用并填URL/token。中间件处理私聊和明确呼叫消息，其他消息交给后续插件。

AI插件调用模型前使用：

```javascript
import { memoryFor } from 'koishi-plugin-universal-memory-keeper';
const result = await memoryFor(session);
const messages = [
  ...(result.context ? [{ role: 'user', content: result.context }] : []),
  { role: 'user', content: session.content },
];
// 把messages交给现有模型；需要位于记忆中间件之后，或给memoryFor第二参传服务配置。
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

## QQ Agent

当前正在运行的1.0.8专用插件不需要换成通用版。通用仓库提供 `memoryForEntry(chatKey,originalRow,botId,config)` 程序接口，在宿主本轮真实触发钩子调用，随后把`context`交给模型；这不是可直接放入plugins目录的替代插件。专用插件的完整宿主适配保留在另一个私密仓库。

## 联调验收

按顺序实测：本人明确记忆 → 查询原ID/时间 → 更新后只查到新值 → A禁记但B仍能查本人同值 → 历史不能绕过禁记 → 重提不解锁 → 本人解锁 → 重新查原来源。引用/转发/媒体不可作为授权。还要验证服务停止、错误令牌与平台原消息撤回，不把错误当作空库或成功回复。
