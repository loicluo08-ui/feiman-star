#!/usr/bin/env python3
"""采集live chat输出（拼接chunk流），存全文供质量评估"""
import json, sys, time, urllib.request

BASE = "https://sufve.com/api/invest/chat"

def collect(question: str, style: str = "balanced", timeout: int = 110):
    payload = json.dumps({
        "messages": [{"role": "user", "content": {"type": "text", "text": question}}],
        "style": style,
    }).encode()
    req = urllib.request.Request(BASE, data=payload, headers={"Content-Type": "application/json"})
    t0 = time.time()
    ttfb = None
    chunks, statuses, patches, errors = [], [], [], []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line or not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "chunk":
                if ttfb is None: ttfb = time.time() - t0
                chunks.append(ev.get("text", ""))
            elif t == "status":
                statuses.append(ev.get("text", ""))
            elif t == "patch":
                patches.append(ev.get("text", ""))
            elif t == "error":
                errors.append(ev.get("message", ""))
    full = "".join(chunks)
    return {
        "question": question, "style": style,
        "ttfb": round(ttfb, 1) if ttfb else None,
        "total_s": round(time.time() - t0, 1),
        "statuses": statuses, "patches": patches, "errors": errors,
        "full": full, "chars": len(full),
    }

if __name__ == "__main__":
    q = sys.argv[1]
    style = sys.argv[2] if len(sys.argv) > 2 else "balanced"
    r = collect(q, style)
    print(json.dumps(r, ensure_ascii=False, indent=1))
