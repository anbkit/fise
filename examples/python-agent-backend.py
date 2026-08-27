from __future__ import annotations

import json
import sys

from fise import Fise
from fise_profile import profile


fise = Fise(profile)
session_id = "client_session_agent_7f4a"
user_id = "user_42"
stream_id = "agent_stream_1042"
sequence = 3
context = [session_id, user_id, "agent-stream", "v2", stream_id, sequence]
event = {
    "type": "tool.result",
    "name": "lookupOrder",
    "result": {"orderId": "order_1042", "status": "ready"},
}
frame = {
    "streamId": stream_id,
    "sequence": sequence,
    "data": fise.encrypt(event, context),
}

if "--json" in sys.argv:
    print(json.dumps(frame, ensure_ascii=False, separators=(",", ":")))
else:
    assert type(frame["data"]) is str
    assert fise.decrypt(frame["data"], context) == event
    print("PASS python-agent-backend: produced one JSON-safe agent event")
