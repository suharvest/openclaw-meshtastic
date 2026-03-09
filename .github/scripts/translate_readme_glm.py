#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "README.md"
TARGET = ROOT / "README.zh-CN.md"
API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
MODEL = os.environ.get("GLM_MODEL", "glm-4-flash")


def _strip_markdown_fence(text: str) -> str:
    stripped = text.strip()
    match = re.match(r"^```(?:markdown|md)?\n([\s\S]*?)\n```$", stripped, re.IGNORECASE)
    if match:
        return match.group(1).strip() + "\n"
    return text


def _extract_code_blocks(md: str) -> list[str]:
    """Extract all fenced code blocks (``` ... ```) from markdown."""
    return re.findall(r"^```[^\n]*\n[\s\S]*?^```", md, re.MULTILINE)


def _extract_headings(md: str) -> list[str]:
    """Extract all ## level headings from markdown."""
    return re.findall(r"^(#{2,})\s+(.+)$", md, re.MULTILINE)


def _github_anchor(heading_text: str) -> str:
    """Generate GitHub-compatible anchor from heading text."""
    anchor = heading_text.strip().lower()
    anchor = re.sub(r"[^\w\s\u4e00-\u9fff-]", "", anchor)
    anchor = re.sub(r"\s+", "-", anchor)
    return anchor


def _extract_toc_links(md: str) -> list[str]:
    """Extract all TOC anchor links from markdown like [text](#anchor)."""
    toc_section = re.search(
        r"^##\s+.*(?:目录|Table of Contents).*\n([\s\S]*?)(?=\n##\s)",
        md,
        re.MULTILINE,
    )
    if not toc_section:
        return []
    return re.findall(r"\[.*?\]\(#([\w\u4e00-\u9fff-]+)\)", toc_section.group(1))


def _validate_translation(source: str, translated: str) -> list[str]:
    """Validate translated output against source. Returns list of error messages."""
    errors: list[str] = []

    # 1. Basic sanity: must start with a heading and not be too short
    if not translated.strip().startswith("#"):
        errors.append("Translation does not start with a heading (#)")
    if len(translated) < len(source) * 0.3:
        errors.append(
            f"Translation suspiciously short ({len(translated)} chars vs "
            f"source {len(source)} chars — under 30%)",
        )

    # 2. Code block integrity: count and content must match source exactly
    source_blocks = _extract_code_blocks(source)
    translated_blocks = _extract_code_blocks(translated)
    if len(source_blocks) != len(translated_blocks):
        errors.append(
            f"Code block count mismatch: source has {len(source_blocks)}, "
            f"translation has {len(translated_blocks)}",
        )
    else:
        for i, (src_block, trans_block) in enumerate(
            zip(source_blocks, translated_blocks)
        ):
            if src_block != trans_block:
                # Extract first line (language tag) for identification
                first_line = src_block.split("\n", 1)[0]
                errors.append(
                    f"Code block {i + 1} ({first_line}) was modified in translation"
                )

    # 3. Heading completeness: every ## heading in source should have a translated counterpart
    source_headings = _extract_headings(source)
    translated_headings = _extract_headings(translated)
    if len(source_headings) != len(translated_headings):
        errors.append(
            f"Heading count mismatch: source has {len(source_headings)}, "
            f"translation has {len(translated_headings)}",
        )

    # 4. TOC anchor integrity: each TOC link must match a real heading anchor
    toc_links = _extract_toc_links(translated)
    heading_anchors = {_github_anchor(text) for _, text in translated_headings}
    for link in toc_links:
        if link not in heading_anchors:
            errors.append(f"TOC link #{link} does not match any heading anchor")

    # 5. Reference-style links preserved
    source_refs = set(re.findall(r"^\[[\w-]+\]:\s+", source, re.MULTILINE))
    translated_refs = set(re.findall(r"^\[[\w-]+\]:\s+", translated, re.MULTILINE))
    missing_refs = source_refs - translated_refs
    if missing_refs:
        errors.append(f"Missing reference-style links: {missing_refs}")

    # 6. HTML blocks preserved (badges, images, etc.)
    source_html = re.findall(r"<(?:p|div|img|a)\b[^>]*>", source, re.IGNORECASE)
    translated_html = re.findall(r"<(?:p|div|img|a)\b[^>]*>", translated, re.IGNORECASE)
    if len(source_html) != len(translated_html):
        errors.append(
            f"HTML tag count mismatch: source has {len(source_html)}, "
            f"translation has {len(translated_html)}",
        )

    return errors


def _request_translation(source_markdown: str, api_key: str) -> str:
    glossary = (
        "Mandatory glossary — use these translations exactly:\n"
        "- channel plugin → 频道插件\n"
        "- channel → 频道 (when referring to messaging channels)\n"
        "- group channel → 群组频道\n"
        "- group policy → 群组策略\n"
        "- DM → 私信\n"
        "- access control → 访问控制\n"
        "- allowlist → 白名单\n"
        "- mention gating → @mention 门控\n"
        "- pairing → 配对\n"
        "- node → 节点\n"
        "- gateway → 网关\n"
        "- mesh network → mesh 网络\n"
        "- transport → 传输方式\n"
        "- repository → 仓库\n"
        "- pull request → Pull Request (keep English)\n"
        "- issue → issue (keep English)\n"
        "- broker → broker (keep English, MQTT term)\n"
        "- Serial → Serial (keep English in transport context)\n"
        "- AI Agent → AI Agent (keep English)\n"
        "- MeshClaw → MeshClaw (keep English)\n"
        "- OpenClaw → OpenClaw (keep English)\n"
        "- Meshtastic → Meshtastic (keep English)\n"
        "- LoRa → LoRa (keep English)\n"
        "\nDo-not-translate list (keep exactly as-is in output):\n"
        "- CLI commands: openclaw onboard, openclaw plugins install, "
        "openclaw channels status --probe, openclaw config edit, npm install, git clone\n"
        "- Config keys: transport, serialPort, httpAddress, httpTls, "
        "mqtt.broker, mqtt.port, mqtt.username, mqtt.password, mqtt.topic, "
        "mqtt.publishTopic, mqtt.tls, region, nodeName, dmPolicy, allowFrom, "
        "groupPolicy, channels, textChunkLimit, requireMention, accounts\n"
        "- Config values: serial, http, mqtt, pairing, open, allowlist, disabled, UNSET\n"
        "- Package/path names: @seeed-studio/meshtastic, index.ts, /dev/ttyUSB0, "
        "meshtastic.local, mqtt.meshtastic.org, msh/US/2/json/#\n"
        "- Environment variables: MESHTASTIC_TRANSPORT, MESHTASTIC_SERIAL_PORT, etc.\n"
    )

    system_prompt = (
        "You are a native Simplified Chinese technical writer translating an open-source README. "
        "Write like a Chinese developer writing docs for other Chinese developers — concise, direct, natural. "
        "DO NOT produce literal/mechanical translation. Rephrase for natural Chinese reading flow. "
        "Examples of BAD vs GOOD translations:\n"
        "  BAD:  此存储库是一个 OpenClaw 通道插件，不是一个独立的应用程序。\n"
        "  GOOD: 这是 OpenClaw 的频道插件，不是独立应用。\n"
        "  BAD:  您需要一个正在运行的 OpenClaw 网关（Node.js 22+）才能使用它。\n"
        "  GOOD: 需要先安装并运行 OpenClaw 网关（Node.js 22+）。\n"
        "  BAD:  在提交问题时要包括传输模式、编辑后的配置。\n"
        "  GOOD: 提 issue 时请附上传输方式、配置（隐去密钥）。\n"
        "  BAD:  欢迎拉取请求\n"
        "  GOOD: 欢迎提交 Pull Request\n"
        "Rules:\n"
        "- Use 你 not 您\n"
        "- Omit unnecessary 的、了、一个、进行 — keep sentences tight\n"
        "- Preserve markdown structure exactly: headings, links, tables, inline code, image paths\n"
        "- Do not translate URLs, package names, commands, file paths, env vars\n"
        "- CRITICAL: NEVER translate content inside code fences (```...```). "
        "Copy every fenced code block BYTE-FOR-BYTE from the source, including the opening "
        "language tag and every line inside. This applies to ALL code fences: bash, yaml, "
        "mermaid, and any other language.\n"
        '  BAD:  ```mermaid\\n    子图 mesh ["LoRa mesh 网络"]\\n  ```\n'
        '  GOOD: ```mermaid\\nflowchart LR\\n    subgraph mesh ["LoRa Mesh Network"]\\n  ```\n'
        "  (The GOOD version is identical to the English source — that is the requirement.)\n"
        "- CRITICAL: Table of Contents anchors MUST match the translated heading text. "
        "GitHub generates anchors from heading text, so if you translate '## Prerequisites' to '## 前置要求', "
        "the TOC link must be [前置要求](#前置要求), NOT [前置要求](#prerequisites).\n"
        "- Keep line breaks and section order identical\n"
        "- Return only the translated markdown, no explanation\n\n" + glossary
    )

    payload = {
        "model": MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": "Translate the following README markdown to Simplified Chinese:\n\n"
                + source_markdown,
            },
        ],
    }

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GLM API HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"GLM API request failed: {exc}") from exc

    parsed = json.loads(body)
    choices = parsed.get("choices")
    if not choices:
        raise RuntimeError(f"GLM API returned no choices: {body}")

    content = choices[0].get("message", {}).get("content", "")
    if not content:
        raise RuntimeError(f"GLM API returned empty content: {body}")

    return _strip_markdown_fence(content)


def main() -> int:
    api_key = os.environ.get("GLM_API_KEY")
    if not api_key:
        print("GLM_API_KEY is not set; skipping translation.")
        return 0

    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing source file: {SOURCE}")

    source_markdown = SOURCE.read_text(encoding="utf-8")
    translated = _request_translation(source_markdown, api_key)

    # Validate translation quality
    errors = _validate_translation(source_markdown, translated)
    if errors:
        print("Translation validation warnings:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        # Warnings are non-fatal — still write the file but exit with code 0
        # so the workflow can commit. Errors are logged for visibility.

    TARGET.write_text(translated, encoding="utf-8")

    print(f"Translated {SOURCE.name} -> {TARGET.name} using model {MODEL}.")
    if errors:
        print(f"  ({len(errors)} validation warning(s) — see stderr)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Translation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
