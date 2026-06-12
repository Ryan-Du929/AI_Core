#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
knowledge_agent.py - Agent v1.0
======================================
: team knowledge base, lessons learned, document index & search

Core features (v1.0):
  - FTS5 full-text search (zero dependency, SQLite built-in)
  - Auto-save Lessons Learned -> knowledge/lessons/
  - Knowledge base statistics
  - Review (stale marking + notification)
  - Rule-based classification
  - Extract knowledge from text content

Usage:
    from shared.agents import KnowledgeAgent
    agent = KnowledgeAgent()
    agent.reindex()
    result = agent.process({"type": "search", "content": "auto backup"})
"""

import sys
import os
import re
import sqlite3
import glob
import hashlib
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_base import BaseAgent, AgentResponse


CATEGORY_RULES = {
    "lessons":      ["lesson", "lesson", "learn", "error", "mistake", "avoid"],
    "skills":       ["skill", "howto", "method", "process", "sop", "SOP", "tech"],
    "templates":    ["template", "template", "format"],
    "archive":      ["archive", "old", "deprecated"],
    "general":      [],
}

CATEGORY_NAMES = {
    "lessons":   "Lessons Learned",
    "skills":    "Skills & Process",
    "templates": "Templates",
    "archive":   "Archive",
    "general":   "General",
}


class KnowledgeAgent(BaseAgent):
    """Knowledge Management Agent - knowledge base, lessons, document search"""
    NAME = "knowledge_agent"
    ROLE = "知識管理師"
    VERSION = "1.0"
    DESCRIPTION = "Team knowledge base management, lessons learned, document index & search"

    DEFAULT_CONFIG = {
        "knowledge_root": os.path.join(
            "/home/node/.openclaw/workspace-your", "knowledge"
        ),
        "db_path": os.path.join(
            "/home/node/.openclaw/workspace-your", "shared", "knowledge_index.db"
        ),
        "search_result_limit": 5,
        "review_interval_days": 30,
        "enable_fulltext_index": True,
    }

    def __init__(self, **kwargs):
        super().__init__(name=self.NAME, role=self.ROLE, **kwargs)
        self.config.update(self.DEFAULT_CONFIG)
        self._db_conn = None
        self._init_db()
        self._log(" v1.0 init (FTS5 search engine ready)")

    # === Database ===

    def _init_db(self):
        db_path = self.config["db_path"]
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._db_conn = sqlite3.connect(db_path)
        self._db_conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
            USING fts5(
                title, content, category, filepath,
                tokenize='unicode61'
            )
        """)
        self._db_conn.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_meta (
                filepath TEXT PRIMARY KEY,
                file_hash TEXT,
                filesize INTEGER,
                mtime TEXT,
                indexed_at TEXT,
                category TEXT
            )
        """)
        self._db_conn.commit()

    def _close_db(self):
        if self._db_conn:
            self._db_conn.close()
            self._db_conn = None

    # === Index ===

    def reindex(self) -> str:
        kroot = self.config["knowledge_root"]
        if not os.path.isdir(kroot):
            return "ERROR: knowledge dir not found: " + kroot

        md_files = glob.glob(os.path.join(kroot, "**", "*.md"), recursive=True)
        updated = 0
        skipped = 0
        errors = []

        for fpath in md_files:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    raw = f.read()
            except Exception as e:
                errors.append("read err: " + fpath + " (" + str(e) + ")")
                continue

            file_hash = hashlib.sha256(raw.encode()).hexdigest()
            file_size = len(raw.encode())
            mtime = datetime.fromtimestamp(os.path.getmtime(fpath), tz=timezone.utc).isoformat()
            relpath = os.path.relpath(fpath, kroot)

            cursor = self._db_conn.execute(
                "SELECT file_hash FROM knowledge_meta WHERE filepath = ?", (relpath,)
            )
            row = cursor.fetchone()
            if row and row[0] == file_hash:
                skipped += 1
                continue

            title = self._parse_title(raw, relpath)
            content_body = self._strip_markdown(raw)
            category = self._classify_by_path(relpath)

            self._db_conn.execute("DELETE FROM knowledge_fts WHERE filepath = ?", (relpath,))
            self._db_conn.execute(
                "INSERT INTO knowledge_fts (title, content, category, filepath) VALUES (?, ?, ?, ?)",
                (title, content_body, category, relpath)
            )
            self._db_conn.execute("""
                INSERT OR REPLACE INTO knowledge_meta
                (filepath, file_hash, filesize, mtime, indexed_at, category)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (relpath, file_hash, file_size, mtime,
                  datetime.now(timezone.utc).isoformat(), category))
            updated += 1

        self._db_conn.commit()
        self._clean_deleted(md_files)

        summary = "Reindex done\n- Files: " + str(len(md_files)) + "\n- Updated: " + str(updated) + "\n- Skipped: " + str(skipped) + "\n- Errors: " + str(len(errors))
        if errors:
            summary += "\n" + "\n".join(errors[:3])
        return summary

    def _clean_deleted(self, current_files: list):
        kroot = self.config["knowledge_root"]
        current_rel = set(os.path.relpath(f, kroot) for f in current_files)
        cursor = self._db_conn.execute("SELECT filepath FROM knowledge_meta")
        for row in cursor.fetchall():
            if row[0] not in current_rel:
                self._db_conn.execute("DELETE FROM knowledge_fts WHERE filepath = ?", (row[0],))
                self._db_conn.execute("DELETE FROM knowledge_meta WHERE filepath = ?", (row[0],))
        self._db_conn.commit()

    def _parse_title(self, raw: str, filepath: str) -> str:
        h1 = re.search(r"^#\s+(.+)$", raw, re.MULTILINE)
        if h1:
            return h1.group(1).strip()
        h2 = re.search(r"^##\s+(.+)$", raw, re.MULTILINE)
        if h2:
            return h2.group(1).strip()
        return os.path.splitext(os.path.basename(filepath))[0]

    def _strip_markdown(self, raw: str) -> str:
        text = re.sub(r"#{1,6}\s+", "", raw)
        text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
        text = re.sub(r"\*(.*?)\*", r"\1", text)
        text = re.sub(r"```[\s\S]*?```", "", text)
        text = re.sub(r"`([^`]+)`", r"\1", text)
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"[-*+]\s+", "", text)
        text = re.sub(r"\|", " ", text)
        text = re.sub(r"---+", "", text)
        return text.strip()

    def _classify_by_path(self, relpath: str) -> str:
        parts = relpath.replace("\\", "/").split("/")
        for part in parts:
            for cat in CATEGORY_RULES:
                if cat in part:
                    return cat
        return "general"

    # === Domain methods ===

    def _handle_search(self, query: str) -> str:
        if not query.strip():
            return "Please provide search keywords"

        limit = self.config["search_result_limit"]
        try:
            words = re.findall(r"[\w\u4e00-\u9fff]+", query)
            fts_query = " OR ".join('"' + w + '"*' for w in words if w.strip())
            if not fts_query:
                return "Search: " + query + " -> no results (empty query)"

            cursor = self._db_conn.execute(
                """SELECT title, category, filepath, snippet(knowledge_fts, 1, '<<', '>>', '...', 32)
                   FROM knowledge_fts
                   WHERE knowledge_fts MATCH ?
                   ORDER BY rank
                   LIMIT ?""",
                (fts_query, limit)
            )
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            return self._fallback_search(query)

        if not rows:
            return self._fallback_search(query)

        lines = ["Search: " + query + " - " + str(len(rows)) + " results:\n"]
        for i, (title, category, filepath, snippet) in enumerate(rows, 1):
            cat_name = CATEGORY_NAMES.get(category, "General")
            lines.append(str(i) + ". " + title)
            lines.append("   Cat: " + cat_name + " | Path: " + filepath)
            if snippet:
                snippet_clean = snippet.replace("<<", "**").replace(">>", "**")
                lines.append("   ..." + snippet_clean + "...")
            lines.append("")

        return "\n".join(lines)

    def _fallback_search(self, query: str) -> str:
        limit = self.config["search_result_limit"]
        keyword = "%" + query + "%"
        try:
            cursor = self._db_conn.execute(
                """SELECT title, category, filepath
                   FROM knowledge_fts
                   WHERE title LIKE ? OR content LIKE ?
                   LIMIT ?""",
                (keyword, keyword, limit)
            )
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            return "Search: " + query + " -> index not built yet, run reindex() first"

        if not rows:
            return "Search: " + query + " -> no results"

        lines = ["Search: " + query + " (LIKE) - " + str(len(rows)) + " results:\n"]
        for i, (title, category, filepath) in enumerate(rows, 1):
            cat_name = CATEGORY_NAMES.get(category, "General")
            lines.append(str(i) + ". " + title + " (" + cat_name + ") - " + filepath)
        return "\n".join(lines)

    def _handle_extract(self, content: str, source: str) -> str:
        if not content.strip():
            return "Please provide content to save"

        category = self._classify_by_content(content)
        cat_name = CATEGORY_NAMES.get(category, "General")
        title = self._generate_title(content, source)

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        safe_title = re.sub(r"[^\w\u4e00-\u9fff]+", "_", title)[:40]
        fname = date_str + "_" + safe_title + ".md"

        subdirs = {
            "lessons": "lessons",
            "skills": "skills",
            "templates": "templates",
            "archive": "archive",
            "general": "skills",
        }
        target_dir = os.path.join(self.config["knowledge_root"], subdirs.get(category, "skills"))
        os.makedirs(target_dir, exist_ok=True)
        fpath = os.path.join(target_dir, fname)

        md_content = (
            "# " + title + "\n\n"
            "> Date: " + date_str + "\n"
            "> Source: " + (source or "KnowledgeAgent") + "\n"
            "> Category: " + cat_name + "\n\n"
            "---\n\n"
            + content + "\n"
        )
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(md_content)

        self._index_single_file(fpath)

        return (
            "Knowledge saved\n"
            "- Title: " + title + "\n"
            "- Category: " + cat_name + "\n"
            "- Path: " + fpath + "\n"
            "- Size: " + str(len(md_content)) + " chars"
        )

    def _classify_by_content(self, content: str) -> str:
        for category, keywords in CATEGORY_RULES.items():
            if any(kw in content for kw in keywords):
                return category
        return "general"

    def _generate_title(self, content: str, source: str) -> str:
        first_line = content.split("\n")[0].strip()
        first_line = re.sub(r"^#+\s*", "", first_line)
        if len(first_line) > 60:
            first_line = first_line[:57] + "..."
        if first_line:
            return first_line
        return "Knowledge - " + (source or "unknown")

    def _index_single_file(self, fpath: str):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                raw = f.read()
        except Exception:
            return

        kroot = self.config["knowledge_root"]
        relpath = os.path.relpath(fpath, kroot)
        file_hash = hashlib.sha256(raw.encode()).hexdigest()
        title = self._parse_title(raw, relpath)
        content = self._strip_markdown(raw)
        category = self._classify_by_path(relpath)

        self._db_conn.execute("DELETE FROM knowledge_fts WHERE filepath = ?", (relpath,))
        self._db_conn.execute(
            "INSERT INTO knowledge_fts (title, content, category, filepath) VALUES (?, ?, ?, ?)",
            (title, content, category, relpath)
        )
        self._db_conn.execute("""
            INSERT OR REPLACE INTO knowledge_meta
            (filepath, file_hash, filesize, mtime, indexed_at, category)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (relpath, file_hash, os.path.getsize(fpath),
              datetime.fromtimestamp(os.path.getmtime(fpath), tz=timezone.utc).isoformat(),
              datetime.now(timezone.utc).isoformat(), category))
        self._db_conn.commit()

    def _handle_classify(self, content: str) -> str:
        if not content.strip():
            return self._reclassify_all()

        category = self._classify_by_content(content)
        cat_name = CATEGORY_NAMES.get(category, "General")

        matched = [kw for kw in CATEGORY_RULES.get(category, []) if kw in content]

        return (
            "Classification result:\n\n"
            "Content (first 100 chars):\n" + content[:100] + "\n\n"
            "Category: " + cat_name + "\n"
            "Keywords matched: " + (", ".join(matched) if matched else "(none)")
        )

    def _reclassify_all(self) -> str:
        kroot = self.config["knowledge_root"]
        if not os.path.isdir(kroot):
            return "ERROR: knowledge dir not found"

        md_files = glob.glob(os.path.join(kroot, "**", "*.md"), recursive=True)
        changed = 0

        for fpath in md_files:
            relpath = os.path.relpath(fpath, kroot)
            new_cat = self._classify_by_path(relpath)

            cursor = self._db_conn.execute(
                "SELECT category FROM knowledge_meta WHERE filepath = ?", (relpath,)
            )
            row = cursor.fetchone()
            if row and row[0] == new_cat:
                continue

            self._db_conn.execute(
                "UPDATE knowledge_fts SET category = ? WHERE filepath = ?",
                (new_cat, relpath)
            )
            self._db_conn.execute(
                "UPDATE knowledge_meta SET category = ? WHERE filepath = ?",
                (new_cat, relpath)
            )
            changed += 1

        self._db_conn.commit()
        return "Reclassification done: scanned " + str(len(md_files)) + " files, " + str(changed) + " updated"

    def _handle_save_lesson(self, content: str) -> str:
        if not content.strip():
            return "Please provide lesson content"

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        safe_name = re.sub(r"[^\w\u4e00-\u9fff]+", "_", content)[:50]
        fname = date_str + "_" + safe_name + ".md"
        lessons_dir = os.path.join(self.config["knowledge_root"], "lessons")
        os.makedirs(lessons_dir, exist_ok=True)
        fpath = os.path.join(lessons_dir, fname)

        md_content = (
            "# [Category] " + content[:80] + "\n\n"
            "- Date: " + date_str + "\n"
            "- Author: KnowledgeAgent\n"
            "- Related task: \n\n"
            "---\n\n"
            "## Background\n\n(describe the situation)\n\n"
            "## Problem\n\n(describe the problem)\n\n"
            "## Root Cause\n\n(analyze root cause)\n\n"
            "## Solution\n\n(how it was solved)\n\n"
            "## Lesson\n\n" + content + "\n\n"
            "## Action Items\n\n- [ ] (tbd)\n"
        )
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(md_content)

        self._index_single_file(fpath)

        return (
            "Lesson saved:\n"
            "- Title: " + content[:80] + "\n"
            "- Path: " + fpath + "\n"
            "- Size: " + str(len(md_content)) + " chars\n\n"
            "Edit the file to fill in background/problem/solution details."
        )

    def _handle_stats(self) -> str:
        cursor = self._db_conn.execute("""
            SELECT category, COUNT(*) as cnt
            FROM knowledge_meta
            GROUP BY category
            ORDER BY cnt DESC
        """)
        cat_stats = cursor.fetchall()

        cursor = self._db_conn.execute("SELECT COUNT(*) FROM knowledge_meta")
        total = cursor.fetchone()[0]

        cursor = self._db_conn.execute("""
            SELECT filepath, mtime FROM knowledge_meta
            ORDER BY mtime DESC LIMIT 3
        """)
        recent = cursor.fetchall()

        cutoff = (datetime.now(timezone.utc) - timedelta(
            days=self.config["review_interval_days"]
        )).isoformat()
        cursor = self._db_conn.execute(
            "SELECT COUNT(*) FROM knowledge_meta WHERE mtime < ?", (cutoff,)
        )
        stale_count = cursor.fetchone()[0]

        lines = [
            "Knowledge Base Stats\n",
            "Total files: " + str(total) + "\n",
            "Category distribution:"
        ]
        for cat, cnt in cat_stats:
            cat_name = CATEGORY_NAMES.get(cat, cat)
            bar = "#" * cnt + "." * max(0, 10 - cnt)
            lines.append("  " + cat_name + ": " + str(cnt) + " " + bar)

        lines.append("\nRecent updates:")
        for fp, mt in recent:
            lines.append("  - " + fp + " (" + mt[:10] + ")")

        lines.append("\nNeeds review: " + str(stale_count) + " files older than " +
                      str(self.config["review_interval_days"]) + " days")

        if total > 0:
            cursor = self._db_conn.execute("SELECT SUM(filesize) FROM knowledge_meta")
            total_bytes = cursor.fetchone()[0] or 0
            lines.append("\nTotal size: " + str(total_bytes) + " bytes (" +
                          str(round(total_bytes/1024, 1)) + " KB)")

        return "\n".join(lines)

    def _handle_review(self) -> str:
        cutoff = (datetime.now(timezone.utc) - timedelta(
            days=self.config["review_interval_days"]
        )).isoformat()

        cursor = self._db_conn.execute("""
            SELECT knowledge_fts.title, knowledge_meta.category,
                   knowledge_meta.filepath, knowledge_meta.mtime
            FROM knowledge_fts
            JOIN knowledge_meta USING (filepath)
            WHERE knowledge_meta.mtime < ?
            ORDER BY knowledge_meta.mtime ASC
            LIMIT 20
        """, (cutoff,))
        stale = cursor.fetchall()

        if not stale:
            return (
                "Review: all knowledge is up to date (within "
                + str(self.config["review_interval_days"]) + " days) OK"
            )

        lines = [
            "Review: " + str(len(stale)) + " items need attention\n",
            "(older than " + str(self.config["review_interval_days"]) + " days)\n"
        ]
        for title, category, filepath, mtime in stale:
            cat_name = CATEGORY_NAMES.get(category, "")
            days_old = (datetime.now(timezone.utc) - datetime.fromisoformat(mtime)).days
            lines.append(title)
            lines.append("  " + cat_name + " | " + filepath + " | idle " + str(days_old) + " days")

        lines.append(
            "\nFor each item:\n"
            "  - Still valid? Update and re-save\n"
            "  - Outdated? Move to knowledge/archive/\n"
            "  - Invalid? Delete it"
        )

        return "\n".join(lines)

    def _handle_general_knowledge(self, content: str) -> str:
        if not content.strip():
            return (
                "KnowledgeAgent v1.0\n\n"
                "Commands:\n"
                "  search: <query> - full text search\n"
                "  save: <content> - save knowledge\n"
                "  lesson: <lesson> - save lesson learned\n"
                "  stats - knowledge base stats\n"
                "  review - knowledge review\n"
                "  reindex - rebuild index\n"
                "  classify: <text> - test classification"
            )

        if content.startswith("search:") or content.startswith("search"):
            return self._handle_search(content.split(":", 1)[-1].strip())
        elif content.startswith("save:") or content.startswith("save"):
            return self._handle_extract(content.split(":", 1)[-1].strip(), "general")
        elif content.startswith("lesson:") or content.startswith("lesson"):
            return self._handle_save_lesson(content.split(":", 1)[-1].strip())
        elif content.startswith("classify:") or content.startswith("classify"):
            return self._handle_classify(content.split(":", 1)[-1].strip())
        elif content.startswith("reindex"):
            return self.reindex()
        elif content.startswith("stats"):
            return self._handle_stats()
        elif content.startswith("review"):
            return self._handle_review()
        else:
            return self._handle_search(content)

    # === Lifecycle ===

    def on_start(self):
        self._log(" started")
        self._check_index()

    def _check_index(self):
        cursor = self._db_conn.execute("SELECT COUNT(*) FROM knowledge_meta")
        count = cursor.fetchone()[0]
        kroot = self.config["knowledge_root"]
        if os.path.isdir(kroot):
            md_count = len(glob.glob(os.path.join(kroot, "**", "*.md"), recursive=True))
            if count < md_count:
                self._log("index behind, auto-rebuilding...")
                result = self.reindex()
                self._log(result.split("\n")[0])

    def on_stop(self):
        self._close_db()
        self.save_memory()
        self._log(" stopped")

    # === process ===

    def process(self, task: dict) -> dict:
        content = task.get("content", "")
        task_type = task.get("type", "knowledge")
        source = task.get("source", "")

        self.add_conversation("user", "[" + task_type + "] " + content)

        if task_type == "search":
            result = self._handle_search(content)
        elif task_type == "extract":
            result = self._handle_extract(content, source)
        elif task_type == "classify":
            result = self._handle_classify(content)
        elif task_type == "save_lesson":
            result = self._handle_save_lesson(content)
        elif task_type == "stats":
            result = self._handle_stats()
        elif task_type == "review":
            result = self._handle_review()
        else:
            result = self._handle_general_knowledge(content)

        self.add_conversation("assistant", result)

        return AgentResponse(
            content=result,
            status="success",
            embeds=[self.make_embed(
                title="KnowledgeAgent",
                description=result[:200],
                status="info",
            )],
            metadata={
                "agent": self.name,
                "task_type": task_type,
                "source": source or "auto",
            },
        ).to_dict()


if __name__ == "__main__":
    agent = KnowledgeAgent()
    agent.on_start()

    print("\n" + "="*60)
    print("Test 1: reindex")
    print(agent.reindex())

    print("\n" + "="*60)
    print("Test 2: search")
    print(agent._handle_search("backup auto"))

    print("\n" + "="*60)
    print("Test 3: stats")
    print(agent._handle_stats())

    print("\n" + "="*60)
    print("Test 4: save lesson")
    print(agent._handle_save_lesson("test lesson: verify auto-output works"))

    print("\n" + "="*60)
    print("Test 5: classify")
    print(agent._handle_classify("the lesson from this is to avoid large batch changes"))

    print("\n" + "="*60)
    print("Test 6: review")
    print(agent._handle_review())

    print("\n" + "="*60)
    print("Test 7: general command")
    print(agent._handle_general_knowledge("search: backup"))

    agent.on_stop()
    print("\nAll tests done")