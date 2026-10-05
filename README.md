# Universal Memory Keeper

通用机器人记忆核心及框架适配器，**0.1.0 首版**。从 QQ Agent Memory Keeper 1.0.8 的来源策略抽取，核心不依赖 QQ Agent 配置、数字 QQ 号或宿主文件路径。

提供本地 HTTP 服务和 Node 模块入口，Python 与 Node 机器人可共享同一核心。支持原消息来源、本人事实、新旧版本、遗忘禁记、本人解锁、过期和会话隔离。

## 支持范围

| 框架 | 本仓库提供 | 安装后的自动能力 | 验证情况 |
| --- | --- | --- | --- |
| AstrBot | 插件入口、配置、消息映射、默认 LLM 请求钩子 | 本人陈述记录、命令、答前本人事实召回 | 合成事件与钩子测试；真实框架/QQ 联调待完成 |
| NoneBot2 + OneBot v11 | 可加载插件、协议映射、`memory_for()` | 记录和命令；AI 插件需调用 `memory_for()` | 合成协议事件测试；真实联调待完成 |
| Koishi 4 | 中间件、配置、`memoryFor()` | 记录和命令；AI 插件需调用 `memoryFor()` | 合成会话映射测试；真实联调待完成 |
| QQ 官方机器人 | 腾讯 botpy 群、C2C、频道消息桥 | 在现有 SDK 回调调用 `memory_for()` | 合成 OpenID、时区与引用事件测试；真实联调待完成 |
| QQ Agent | 本轮真实存档行的桥接接口 | 需在宿主钩子接入；现有专用插件可继续使用 | 合成存档映射测试 |

这不是“下载后自动兼容任何机器人”的单一插件。AstrBot 插件、NoneBot 插件和 Koishi 插件的目录不同；没有统一 AI 钩子的框架还需在其 AI 插件中接一处调用。QQ 官方平台是协议，AstrBot 的 QQ 官方适配器可以先走 AstrBot 路线。

## 启动核心

Node.js >=20；核心与服务无第三方 npm 依赖。第一次启动，在 PowerShell 中运行：

```powershell
cd D:\universal-memory-keeper
$env:MEMORY_TOKEN = node -p 'require("node:crypto").randomBytes(32).toString("hex")'
# 将生成的令牌填到框架插件配置；此命令只生成你本机使用的凭证。
node server.mjs
```

默认监听 `127.0.0.1:8765`，数据写在本项目的 `data/`。重启服务时使用**同一个令牌**；可用启动脚本设置环境变量，但不要提交含令牌的脚本。可选变量：`MEMORY_PORT`、`MEMORY_DATA_DIR`。容器内插件访问宿主需要自行配置地址与安全转发，不能把容器自身的 127.0.0.1 当成宿主。

核心采用单进程、每会话 JSON 原子写入。单文件上限64MiB；大群长期运行或多进程部署需要替换存储接口。不要让多个进程同时写同一数据目录。

## 使用

每个已接入框架都使用同样的维护命令：

```text
我的饮料偏好是绿茶
我的饮料偏好改为红茶
/memory search 饮料偏好
/memory history 饮料偏好
/memory note 工作安排 | 我的工作安排是周三下午开会
/memory forget 饮料偏好
/memory unlock 饮料偏好
/memory status
```

自动记忆仅识别明确的“我的事项是/改为某值”陈述；其他事实需用 `note` 指令，仍以本条本人原文为依据。自然中文的明确遗忘/解锁也可识别；“忘记这件事”等模糊指代不会执行。默认检索只返回当前发送者的核验事实，历史模式不会绕过禁记。

遗忘停止本核心的召回和再记忆，**不物理删除原消息**。解锁后重新开放仍有效的旧事实；期间重提不会自动解除禁记或写入新事实。没有文本明确日期时不猜过期时间；日期截止和检索日界用北京时间。

## 安装适配器

详细步骤与 AI 接口例子见 [框架安装](docs/ADAPTERS.md)。整个 AstrBot 插件目录包含入口、配置和独立客户端，复制到 AstrBot `data/plugins/astrbot_plugin_universal_memory_keeper/` 后重启加载；不要将仓库根目录当成 AstrBot 插件。

AstrBot 首版在默认 LLM 请求钩子中**每轮清空本次请求旧上下文**，仅保留当前问题与经核验的本人记忆。这样群成员旧回答和禁记话题不会从框架历史直接补回；代价是普通多轮闲聊上下文减少。聊天数据库不会由插件删除。其他 AI 插件若另行注入旧记忆、人设事实或工具结果，需要自行执行相同来源政策；本版不保证拦截任意模型措辞、其他插件注入或自定义调用链。

## 验证与源码

```powershell
node --test tests/core.test.mjs tests/http.test.mjs
python -B tests/test_adapters.py
```

本仓库31项 Node 核心/HTTP/映射测试及13项 Python 检查（12项合成适配器检查、1项真实环回HTTP客户端检查）。测试不发真实 QQ 消息、不调用模型、不读取真实聊天。专用版原有180项检查不能直接当作通用版或其他框架的验证结果。

源码入口、信任边界和存储契约见 [源码说明](docs/SOURCE-GUIDE.md)，实际验证记录见 [验证范围](docs/VALIDATION.md)。核心公开方法也可用于程序内接入，适配器是已认证事件与核心之间的桥。

本仓库不包含 QQ Agent 主程序、真实聊天、真实记忆库、账号配置或 API 密钥。运行时数据和环境文件被 `.gitignore` 排除。

## 来源与许可证

MIT；保留 [Kondius/qq-agent](https://github.com/Kondius/qq-agent) 上游版权。来源策略抽取自专用插件，通用身份契约、HTTP 桥和框架适配器为本次新增。各框架本身遵循其各自许可证。
