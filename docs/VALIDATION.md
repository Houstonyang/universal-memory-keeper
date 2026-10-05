# 验证范围

0.1.0首版：30项Node测试通过；13项Python检查通过（12项合成SDK事件/钩子检查、1项Python客户端连接实际环回HTTP服务）。公开代码另做JavaScript/Python语法核验与发布文件扫描。

Node检查覆盖身份元组隔离、UUID/OpenID、本人事实版本、history状态、A/B同文隔离、遗忘/解锁、幂等、原ID冲突、伪造来源、引用/转发/媒体、磁盘重载、损坏文件、核心撤回、过期、北京时间、路径隔离、Koishi映射以及实际环回HTTP认证接入。

Python检查覆盖NoneBot原消息链、转发和媒体；腾讯SDK群/C2C/频道身份、带时区原时间、引用与附件；AstrBot原消息链、来源标记、请求上下文核验与异常。AstrBot导入使用API桩，未运行真实AstrBot；其余映射也使用合成SDK对象。

不把语法或API桩测试称为真实平台兼容测试。AstrBot/NoneBot/Koishi/tencent botpy实际安装、SDK发QQ及模型生成验证待完成。没有授权替用户向QQ群发送联调消息；本次只做隔离本地验证。
