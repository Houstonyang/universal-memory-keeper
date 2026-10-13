"""合成 SDK 事件验证 Python 映射与 AstrBot 钩子；不等同于真实框架联调。"""
import importlib.util
import pathlib
import sys
import types
import unittest
import asyncio
ROOT = pathlib.Path(__file__).resolve().parents[1]

def load(package, folder, file):
    if package not in sys.modules:
        module = types.ModuleType(package)
        module.__path__ = [str(ROOT / "adapters" / folder)]
        sys.modules[package] = module
    spec = importlib.util.spec_from_file_location(package + "." + file, ROOT / "adapters" / folder / (file + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def astrbot_stub():
    modules = {name: types.ModuleType(name) for name in ("astrbot", "astrbot.api", "astrbot.api.event", "astrbot.api.star", "astrbot.api.provider", "astrbot.core", "astrbot.core.agent", "astrbot.core.agent.message")}
    class Filter:
        class EventMessageType:
            ALL = 1
        def event_message_type(self, *args):
            return lambda fn: fn
        def on_llm_request(self):
            return lambda fn: fn
        def command(self, *args):
            return lambda fn: fn
    modules["astrbot.api"].AstrBotConfig = dict
    modules["astrbot.api"].logger = types.SimpleNamespace(warning=lambda _: None)
    modules["astrbot.api.event"].filter = Filter()
    modules["astrbot.api.event"].AstrMessageEvent = object
    modules["astrbot.api.star"].Context = object
    modules["astrbot.api.star"].Star = type("Star", (), {"__init__": lambda self, _: None})
    modules["astrbot.api.star"].register = lambda *args: lambda cls: cls
    modules["astrbot.api.provider"].ProviderRequest = object
    modules["astrbot.core.agent.message"].TextPart = lambda **kwargs: types.SimpleNamespace(**kwargs)
    sys.modules.update(modules)

class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nb = load("nb_fixture", "nonebot2", "normalize")
        cls.qq = load("qq_fixture", "qq-official", "bridge")
        astrbot_stub()
        cls.astr = load("astr_fixture", "astrbot", "main")

    def test_nonebot_preserves_original_chain(self):
        segment = types.SimpleNamespace(type="text", data={"text": "原文"})
        reply = types.SimpleNamespace(type="reply", data={"id": 123})
        event = types.SimpleNamespace(get_type=lambda: "message", original_message=[reply, segment], message_id=-234,
                                     user_id=123456, time=1790812800, group_id=234567,
                                     sender=types.SimpleNamespace(nickname="Fixture"))
        result = self.nb.normalize_event(types.SimpleNamespace(self_id=345678), event)
        self.assertEqual(result["timestamp"], 1790812800000)
        self.assertEqual(result["messageId"], "-234")
        self.assertTrue(result["quoted"])
        self.assertEqual(result["replyTo"], "123")
        self.assertEqual(result["text"], "原文")

    def test_nonebot_forward_and_media(self):
        for kind, key in (("forward", "forwarded"), ("image", "media")):
            event = types.SimpleNamespace(get_type=lambda: "message", original_message=[types.SimpleNamespace(type=kind, data={})],
                                         message_id=1, user_id=123456, time=1790812800, group_id=None, sender=types.SimpleNamespace(nickname=""))
            self.assertTrue(self.nb.normalize_event(types.SimpleNamespace(self_id=345678), event)[key])

    def qq_message(self):
        return types.SimpleNamespace(author=types.SimpleNamespace(member_openid="member-uuid", user_openid="user-uuid", id="channel-user", username=""),
                                     group_openid="group-uuid", channel_id="channel-uuid", id="message-uuid",
                                     timestamp="2026-10-01T10:00:00+08:00", content="<@bot> 我的饮料偏好是茶", attachments=[], message_reference=None)

    def test_qq_group_openid(self):
        result = self.qq.normalize_message(self.qq_message(), "app-uuid", "group")
        self.assertEqual(result["senderId"], "member-uuid")
        self.assertEqual(result["conversationId"], "group-uuid")
        self.assertEqual(result["timestamp"], 1790820000000)
        self.assertEqual(result["text"], "我的饮料偏好是茶")

    def test_qq_private_openid(self):
        result = self.qq.normalize_message(self.qq_message(), "app", "private")
        self.assertEqual(result["senderId"], result["conversationId"])

    def test_qq_channel(self):
        result = self.qq.normalize_message(self.qq_message(), "app", "channel")
        self.assertEqual(result["conversationId"], "channel-uuid")
        self.assertEqual(result["senderId"], "channel-user")

    def test_qq_quote_attachment(self):
        message = self.qq_message()
        message.attachments = ["image"]
        message.message_reference = {"message_id": "old"}
        result = self.qq.normalize_message(message, "app", "group")
        self.assertTrue(result["quoted"])
        self.assertEqual(result["replyTo"], "old")
        self.assertEqual(result["media"], ["attachment"])

    def test_nonebot_signed_reply_id_is_preserved(self):
        event = types.SimpleNamespace(get_type=lambda: "message", original_message=[types.SimpleNamespace(type="reply", data={"id": -123})],
                                     message_id=-234, user_id=123456, time=1790812800, group_id=234567,
                                     sender=types.SimpleNamespace(nickname=""))
        result = self.nb.normalize_event(types.SimpleNamespace(self_id=345678), event)
        self.assertEqual(result["replyTo"], "-123")

    def test_nonebot_multiple_replies_are_not_guessed(self):
        event = types.SimpleNamespace(get_type=lambda: "message", original_message=[types.SimpleNamespace(type="reply", data={"id": i}) for i in (1, 2)])
        with self.assertRaisesRegex(ValueError, "引用"):
            self.nb.normalize_event(types.SimpleNamespace(self_id=345678), event)

    def test_qq_empty_sdk_reference_object_is_not_a_quote(self):
        message = self.qq_message()
        message.message_reference = types.SimpleNamespace(message_id=None)
        result = self.qq.normalize_message(message, "app", "channel")
        self.assertFalse(result["quoted"])
        self.assertIsNone(result["replyTo"])

    def test_qq_sdk_reference_object_preserves_id(self):
        message = self.qq_message()
        message.message_reference = types.SimpleNamespace(message_id="source-uuid")
        result = self.qq.normalize_message(message, "app", "channel")
        self.assertTrue(result["quoted"])
        self.assertEqual(result["replyTo"], "source-uuid")

    def test_qq_rejects_naive_time(self):
        message = self.qq_message()
        message.timestamp = "2026-10-01T10:00:00"
        with self.assertRaises(ValueError):
            self.qq.normalize_message(message, "app", "group")

    def astr_event(self, chain):
        return types.SimpleNamespace(message_obj=types.SimpleNamespace(message=chain, timestamp=1790812800, message_id="astr-uuid"),
                                     get_sender_id=lambda: "A", get_self_id=lambda: "bot", get_sender_name=lambda: "", get_platform_id=lambda: "platform-1",
                                     get_group_id=lambda: "group", is_private_chat=lambda: False)

    def test_astrbot_plain_original(self):
        plain = type("Plain", (), {"text": "原句"})()
        event = self.astr_event([plain])
        event.message_str = "其他插件修改后的内容"
        result = self.astr.normalize_event(event)
        self.assertEqual(result["text"], "原句")
        self.assertEqual(result["timestamp"], 1790812800000)
        self.assertEqual(result["platform"], "platform-1")

    def test_astrbot_reply_forward_media(self):
        result = self.astr.normalize_event(self.astr_event([type("Reply", (), {})(), type("Forward", (), {})(), type("Image", (), {})()]))
        self.assertTrue(result["quoted"])
        self.assertTrue(result["forwarded"])
        self.assertEqual(result["media"], ["image"])

    def test_astrbot_reply_id_and_plain_body_have_separate_sources(self):
        reply = type("Reply", (), {"id": -123, "message_str": "不要把引用正文拼成本轮请求"})()
        plain = type("Plain", (), {"text": "只复述原句"})()
        result = self.astr.normalize_event(self.astr_event([reply, plain]))
        self.assertEqual(result["replyTo"], "-123")
        self.assertEqual(result["text"], "只复述原句")

    def test_astrbot_multiple_replies_are_not_guessed(self):
        with self.assertRaisesRegex(ValueError, "引用"):
            self.astr.normalize_event(self.astr_event([type("Reply", (), {"id": i})() for i in (1, 2)]))

    def test_astrbot_nodes_are_forwarded_not_personal_text(self):
        for kind in ("Node", "Nodes"):
            result = self.astr.normalize_event(self.astr_event([type(kind, (), {})()]))
            self.assertTrue(result["forwarded"])

    def test_astrbot_hook_uses_verified_context(self):
        plugin = self.astr.UniversalMemoryKeeper(object(), {})
        async def retrieve(_):
            return {"context": "verified", "activeBans": []}
        plugin.retrieve = retrieve
        req = types.SimpleNamespace(contexts=[{"role": "assistant", "content": "旧断言"}], conversation=object(), extra_user_content_parts=[])
        asyncio.run(plugin.before_llm(object(), req))
        self.assertEqual(req.contexts, [])
        self.assertIsNone(req.conversation)
        self.assertEqual(req.extra_user_content_parts[0].text, "verified")

    def test_astrbot_hook_failure_does_not_silently_claim_empty(self):
        plugin = self.astr.UniversalMemoryKeeper(object(), {})
        async def retrieve(_):
            raise RuntimeError("unavailable")
        plugin.retrieve = retrieve
        with self.assertRaises(RuntimeError):
            asyncio.run(plugin.before_llm(object(), types.SimpleNamespace(contexts=[])))

    def test_astrbot_hook_accepts_uninitialized_extra_parts(self):
        plugin = self.astr.UniversalMemoryKeeper(object(), {})
        async def retrieve(_):
            return {"context": "引用来源已核验"}
        plugin.retrieve = retrieve
        req = types.SimpleNamespace(contexts=[], extra_user_content_parts=None)
        asyncio.run(plugin.before_llm(object(), req))
        self.assertEqual(req.extra_user_content_parts[0].text, "引用来源已核验")

    def test_astrbot_exact_quote_command_stops_before_model(self):
        plugin = self.astr.UniversalMemoryKeeper(object(), {})
        async def retrieve(_):
            return {"command": True, "reply": "青竹"}
        plugin.retrieve = retrieve
        stopped = []
        event = types.SimpleNamespace(is_at_or_wake_command=True, is_private_chat=lambda: False,
                                      plain_result=lambda text: text, stop_event=lambda: stopped.append(True))
        async def responses():
            return [value async for value in plugin.on_message(event)]
        self.assertEqual(asyncio.run(responses()), ["青竹"])
        self.assertEqual(stopped, [True])

    def test_missing_source_time_cannot_be_synthesized(self):
        event = self.astr_event([type("Plain", (), {"text": "原文"})()])
        event.message_obj.timestamp = None
        with self.assertRaises((TypeError, ValueError)):
            self.astr.normalize_event(event)

    def test_python_client_against_real_http_service(self):
        import os, socket, subprocess, tempfile, time, shutil
        client = load("http_fixture", "qq-official", "client")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        token = "test-only-token-1234567890-python"
        with tempfile.TemporaryDirectory(prefix="memory-python-http-") as data:
            env = dict(os.environ, MEMORY_TOKEN=token, MEMORY_PORT=str(port), MEMORY_DATA_DIR=data)
            proc = subprocess.Popen([shutil.which("node") or "node", str(ROOT / "server.mjs")], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                for _ in range(50):
                    with socket.socket() as sock:
                        if sock.connect_ex(("127.0.0.1", port)) == 0:
                            break
                    if proc.poll() is not None:
                        self.fail("本地记忆服务未启动")
                    time.sleep(0.05)
                event = {"framework": "python-http", "platform": "qq", "botId": "fixture-bot", "kind": "group", "conversationId": "fixture-group",
                         "senderId": "fixture-user", "messageId": "first", "timestamp": 1790812800000, "text": "我的饮料偏好是绿茶",
                         "self": False, "quoted": False, "forwarded": False, "media": []}
                url = "http://127.0.0.1:" + str(port)
                asyncio.run(client.memory_turn(event, url, token))
                result = asyncio.run(client.memory_turn(dict(event, messageId="second", text="饮料偏好"), url, token))
                self.assertEqual(result["hits"][0]["messageId"], "first")
                self.assertEqual(asyncio.run(client.memory_turn(dict(event, messageId="question", text="我的饮料偏好是什么"), url, token))["hits"][0]["messageId"], "first")
                asyncio.run(client.memory_turn(dict(event, messageId="bot-source", senderId="fixture-bot", self=True, text="青竹"), url, token))
                quoted = asyncio.run(client.memory_turn(dict(event, messageId="quote-question", quoted=True, replyTo="bot-source", text="只复述原句"), url, token))
                self.assertTrue(quoted["command"])
                self.assertEqual(quoted["reply"], "青竹")
                self.assertEqual(quoted["quote"]["source"]["senderId"], "fixture-bot")
                with self.assertRaises(Exception):
                    asyncio.run(client.memory_turn(dict(event, messageId="third"), url, "wrong-token-1234567890-python"))
            finally:
                proc.terminate()
                proc.communicate(timeout=5)

if __name__ == "__main__":
    unittest.main()
